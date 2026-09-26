/**
 * Offline license issuance.
 *
 * Selah's desktop app verifies entitlements completely offline by checking an
 * Ed25519 signature over a small JSON payload. This module is the *only* place
 * that holds the private signing key (`LICENSE_SIGNING_KEY`, an env var on the
 * Convex deployment) and turns a subscription row into a signed license file.
 *
 * Flow:
 *   Paystack webhook ──▶ applyPaystackEvent (writes `subscriptions`)
 *   App GET /license  ──▶ getSubscriptionForEmail ──▶ buildLicense + signPayload
 *
 * The license file ships the *exact bytes* that were signed (base64 in
 * `payload_b64`), so the client never re-serializes the payload — there is no
 * canonical-JSON mismatch to worry about. The client base64-decodes those
 * bytes, verifies the signature over them, and only then parses the JSON.
 *
 * Key management:
 *   - Generate a keypair with `node scripts/gen-license-keys.mjs`.
 *   - `npx convex env set LICENSE_SIGNING_KEY <seed-hex>` (32-byte seed, hex).
 *   - Bake the matching public key into the Tauri app (src-tauri/src/license.rs).
 *   - Rotate by bumping LICENSE_KEY_ID and shipping an app that trusts both keys.
 */

import { internalAction, internalQuery, internalMutation, mutation, type MutationCtx } from './_generated/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { getEffectiveSubscription, getChurchSubscription } from './entitlements'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

// @noble/ed25519 v3 needs the synchronous SHA-512 wired up before sign/verify.
ed.hashes.sha512 = sha512

/** Bump when the payload shape changes in a non-additive way. */
export const LICENSE_VERSION = 1
/** Identifies which signing key produced a license; bump on key rotation. */
export const LICENSE_KEY_ID = 'k1'
/** Default offline grace window applied when a subscription has none set. */
export const DEFAULT_GRACE_PERIOD_DAYS = 14
/** Length of the card-free Pro trial granted on first sign-in. */
export const TRIAL_DAYS = 14

export type Plan = 'free' | 'pro'

export interface LicensePayload {
    /** Payload schema version. */
    v: number
    /** Signing key id, so the client can pick the right public key. */
    key_id: string
    /** Stable id for this license (audit / future revocation list). */
    license_id: string
    /** Selah user id if known, else the email (the app keys off email anyway). */
    user_id: string
    email: string
    plan: Plan
    /** Subscription status at issue time (informational for the UI). */
    status: string
    /** ISO 8601 instant the license was minted. Also used for anti-rollback. */
    issued_at: string
    /** ISO 8601 end of the paid period. Null for free (never expires). */
    expires_at: string | null
    /** Days the app keeps working past `expires_at` while it can't reach us. */
    grace_period_days: number
}

export interface LicenseFile {
    alg: 'ed25519'
    key_id: string
    /** base64 of the exact UTF-8 JSON bytes that were signed. */
    payload_b64: string
    /** base64 of the Ed25519 signature over those bytes. */
    signature: string
}

// --- base64 (runtime-agnostic; avoids depending on btoa/Buffer) -------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i]
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
        const triple = (b0 << 16) | (b1 << 8) | b2
        out += B64[(triple >> 18) & 0x3f]
        out += B64[(triple >> 12) & 0x3f]
        out += i + 1 < bytes.length ? B64[(triple >> 6) & 0x3f] : '='
        out += i + 2 < bytes.length ? B64[triple & 0x3f] : '='
    }
    return out
}

// --- signing ----------------------------------------------------------------

function getSigningSeed(): Uint8Array {
    const hex = process.env.LICENSE_SIGNING_KEY
    if (!hex) {
        throw new Error(
            'LICENSE_SIGNING_KEY is not configured. Run scripts/gen-license-keys.mjs ' +
            'and `npx convex env set LICENSE_SIGNING_KEY <seed-hex>`.'
        )
    }
    const seed = ed.etc.hexToBytes(hex.trim())
    if (seed.length !== 32) {
        throw new Error(`LICENSE_SIGNING_KEY must be a 32-byte hex seed (got ${seed.length} bytes).`)
    }
    return seed
}

/** Sign a payload, returning a self-contained license file. */
export function signPayload(payload: LicensePayload): LicenseFile {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
    const signature = ed.sign(payloadBytes, getSigningSeed())
    return {
        alg: 'ed25519',
        key_id: payload.key_id,
        payload_b64: bytesToBase64(payloadBytes),
        signature: bytesToBase64(signature),
    }
}

/** True when a subscription should currently confer the Pro plan. */
export function isProActive(sub: SubscriptionRow | null, now: Date): boolean {
    if (!sub || sub.plan !== 'pro') return false
    if (sub.status === 'cancelled') return false
    if (!sub.currentPeriodEnd) return sub.status === 'active'
    // Still within the paid period (the client adds its own grace on top).
    return new Date(sub.currentPeriodEnd).getTime() > now.getTime()
}

/**
 * Build the license payload for a user, given their subscription row (or null).
 * Downgrades to `free` whenever Pro isn't currently active.
 */
export function buildLicense(args: {
    email: string
    userId?: string | null
    subscription: SubscriptionRow | null
    nowIso: string
}): LicensePayload {
    const now = new Date(args.nowIso)
    const pro = isProActive(args.subscription, now)
    const sub = args.subscription
    return {
        v: LICENSE_VERSION,
        key_id: LICENSE_KEY_ID,
        license_id: `lic_${args.email}_${args.nowIso}`,
        user_id: args.userId ?? sub?.userId ?? args.email,
        email: args.email,
        plan: pro ? 'pro' : 'free',
        status: sub?.status ?? 'none',
        issued_at: args.nowIso,
        expires_at: pro ? (sub?.currentPeriodEnd ?? null) : null,
        grace_period_days: sub?.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS,
    }
}

// --- subscription row type (mirrors schema.ts) ------------------------------

export interface SubscriptionRow {
    email: string
    userId?: string
    churchId?: string
    plan: Plan
    status: 'trialing' | 'active' | 'non-renewing' | 'attention' | 'past_due' | 'cancelled'
    paystackCustomerCode?: string
    paystackSubscriptionCode?: string
    paystackPlanCode?: string
    source?: 'paystack' | 'promo' | 'trial'
    currentPeriodEnd: string | null
    gracePeriodDays: number
    lastEventAt?: string
    lastChargeAt?: string
    createdAt: string
    updatedAt: string
}

// --- data access ------------------------------------------------------------

/** Look up a subscription by (lowercased) email. Legacy per-email lookup. */
export const getSubscriptionForEmail = internalQuery({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase()
        return await ctx.db
            .query('subscriptions')
            .withIndex('by_email', (q) => q.eq('email', email))
            .unique()
    },
})

/**
 * Church-aware subscription lookup used by GET /license and the manage link:
 * resolve the user (by email) → their church's governing subscription, with a
 * legacy per-email fallback. This is what makes invited members inherit the
 * church's plan on desktop too.
 */
export const getEffectiveSubscriptionByEmail = internalQuery({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase()
        // `.first()`: a duplicated user row made `.unique()` throw, blocking
        // checkout and licence issuance for that person entirely.
        const user = await ctx.db
            .query('users')
            .withIndex('by_email', (q) => q.eq('email', email))
            .first()
        return await getEffectiveSubscription(ctx, { churchId: user?.churchId ?? null, email })
    },
})

/**
 * Upsert a subscription from a normalized Paystack webhook event.
 *
 * Matching order: by Paystack subscription code (most precise), then by email.
 * We never *downgrade the period* here — `currentPeriodEnd` only moves forward,
 * so a late/out-of-order webhook can't shorten a user's paid time. Status and
 * plan are updated to reflect the latest event.
 */
export const applyPaystackEvent = internalMutation({
    args: {
        email: v.string(),
        status: v.union(
            v.literal('active'),
            v.literal('non-renewing'),
            v.literal('attention'),
            v.literal('past_due'),
            v.literal('cancelled')
        ),
        plan: v.union(v.literal('free'), v.literal('pro')),
        paystackCustomerCode: v.optional(v.string()),
        paystackSubscriptionCode: v.optional(v.string()),
        paystackPlanCode: v.optional(v.string()),
        currentPeriodEnd: v.optional(v.union(v.string(), v.null())),
        chargedAt: v.optional(v.string()),
        // Saved card token, only present on charge.success — needed to start the
        // normal-priced subscription when an intro discount rolls over.
        authorizationCode: v.optional(v.string()),
        // True only for charge.success, so we count exactly one discounted cycle
        // per charge (invoice.* events for the same charge don't double-count).
        isCharge: v.optional(v.boolean()),
        eventAt: v.string(),
        // Identifies the delivery; a key seen before makes this a no-op.
        // Optional only so a caller without one still works (unguarded).
        eventKey: v.optional(v.string()),
        eventType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase()

        // Check and record in the same transaction as the update itself, so
        // two concurrent deliveries of one event can't both get through: the
        // second conflicts on the key read and retries into the duplicate path.
        if (args.eventKey) {
            const seen = await ctx.db
                .query('paystackEvents')
                .withIndex('by_key', (q) => q.eq('key', args.eventKey!))
                .first()
            if (seen) {
                console.log(`[licensing] ignoring redelivered Paystack event ${args.eventKey}`)
                return { id: null, rollover: null, duplicate: true }
            }
            await ctx.db.insert('paystackEvents', {
                key: args.eventKey,
                event: args.eventType ?? 'unknown',
                receivedAt: Date.now(),
            })
        }

        // Prefer matching on the subscription code; fall back to email.
        let existing = null
        if (args.paystackSubscriptionCode) {
            existing = await ctx.db
                .query('subscriptions')
                .withIndex('by_subscription_code', (q) =>
                    q.eq('paystackSubscriptionCode', args.paystackSubscriptionCode)
                )
                .unique()
        }
        if (!existing) {
            // `.first()`: a duplicated row made `.unique()` throw, and a throw
            // here fails the webhook — which Paystack then retries forever.
            existing = await ctx.db
                .query('subscriptions')
                .withIndex('by_email', (q) => q.eq('email', email))
                .first()
        }

        // Period only ever moves forward.
        const incomingEnd = args.currentPeriodEnd ?? null
        const mergedEnd = (() => {
            if (!existing?.currentPeriodEnd) return incomingEnd
            if (!incomingEnd) return existing.currentPeriodEnd
            return new Date(incomingEnd) > new Date(existing.currentPeriodEnd)
                ? incomingEnd
                : existing.currentPeriodEnd
        })()

        // A discount checkout that has now been paid for: its intro plan is
        // what this event is about, so the discount starts here.
        const pending = existing?.pendingPromo
        const promoTakesEffect = !!pending && args.paystackPlanCode === pending.introPlanCode
        const promoFields = promoTakesEffect
            ? { promoCode: pending!.promoCode, revertPlanCode: pending!.revertPlanCode, pendingPromo: undefined }
            : {}
        const revertPlanCode = promoTakesEffect ? pending!.revertPlanCode : existing?.revertPlanCode

        // Intro-discount countdown: spend one discounted cycle per charge. When
        // the last one is spent and a revert plan is set, signal the caller to
        // start the normal-priced subscription off the saved card.
        let introCyclesRemaining = promoTakesEffect ? pending!.introCycles : (existing?.introCyclesRemaining ?? null)
        let rollover:
            | {
                  customerCode?: string
                  authorizationCode?: string
                  revertPlanCode: string
                  startDate: string | null
              }
            | null = null
        if (args.isCharge && introCyclesRemaining != null && introCyclesRemaining > 0) {
            introCyclesRemaining -= 1
            if (introCyclesRemaining <= 0 && revertPlanCode) {
                rollover = {
                    customerCode: args.paystackCustomerCode ?? existing?.paystackCustomerCode,
                    authorizationCode:
                        args.authorizationCode ?? existing?.paystackAuthorizationCode,
                    revertPlanCode,
                    startDate: mergedEnd,
                }
            }
        }

        // Resolve the church this subscription entitles: keep an existing
        // churchId, else the payer's church (by email). This is what makes the
        // whole church inherit Pro.
        const userByEmail = await ctx.db
            .query('users')
            .withIndex('by_email', (q) => q.eq('email', email))
            .first()
        const churchId = existing?.churchId ?? userByEmail?.churchId ?? undefined

        // Paystack doesn't promise delivery order, and `eventAt` is its own
        // timestamp for the event. One older than the last applied must not
        // overwrite the status — a late "payment failed" landing after the
        // success that followed it left a paying church marked past-due. The
        // period end still only moves forward, and a late charge still counts.
        const now = args.eventAt
        const isStale = !!existing?.lastEventAt && now < existing.lastEventAt
        const patch = {
            email,
            churchId,
            plan: isStale ? existing!.plan : args.plan,
            status: isStale ? existing!.status : args.status,
            paystackCustomerCode: args.paystackCustomerCode ?? existing?.paystackCustomerCode,
            paystackSubscriptionCode:
                args.paystackSubscriptionCode ?? existing?.paystackSubscriptionCode,
            paystackPlanCode: args.paystackPlanCode ?? existing?.paystackPlanCode,
            paystackAuthorizationCode:
                args.authorizationCode ?? existing?.paystackAuthorizationCode,
            currentPeriodEnd: mergedEnd,
            gracePeriodDays: existing?.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS,
            introCyclesRemaining,
            ...promoFields,
            lastEventAt: isStale ? existing!.lastEventAt : now,
            lastChargeAt: args.chargedAt ?? existing?.lastChargeAt,
            updatedAt: new Date().toISOString(),
        }

        // Scheduled in this transaction, so a recorded event always has its
        // rollover queued — never one without the other.
        if (rollover?.customerCode && rollover.authorizationCode) {
            await ctx.scheduler.runAfter(0, internal.licensing.startRollover, {
                email,
                customerCode: rollover.customerCode,
                authorizationCode: rollover.authorizationCode,
                revertPlanCode: rollover.revertPlanCode,
                startDate: rollover.startDate ?? null,
                attempt: 0,
            })
        }

        if (existing) {
            await ctx.db.patch(existing._id, patch)
            return { id: existing._id, rollover, duplicate: false }
        }

        const id = await ctx.db.insert('subscriptions', {
            ...patch,
            source: 'paystack' as const,
            userId: userByEmail?._id,
            createdAt: now,
        })
        return { id, rollover, duplicate: false }
    },
})

/**
 * Grant comped Pro (no payment) for `days`, via a promo. Idempotent-ish: an
 * existing row is extended only if the comp window is longer than what's there.
 * Returns the new `expires_at` (ISO).
 */
export const grantCompSubscription = internalMutation({
    args: { email: v.string(), compDays: v.number(), promoCode: v.string() },
    handler: async (ctx, args): Promise<string> => {
        // Comped Pro MUST be time-boxed — never grant an undated Pro (an
        // undated Pro license is entitled forever offline). See the licensing
        // header note on expiry.
        if (!Number.isFinite(args.compDays) || args.compDays <= 0) {
            throw new Error('Comped Pro requires a positive duration (compDays); undated comps are not allowed.')
        }
        const email = args.email.toLowerCase()
        const now = new Date()
        const expires = new Date(now.getTime() + args.compDays * 24 * 60 * 60 * 1000)
        const expiresIso = expires.toISOString()
        const nowIso = now.toISOString()

        const existing = await ctx.db
            .query('subscriptions')
            .withIndex('by_email', (q) => q.eq('email', email))
            .unique()

        const user = await ctx.db
            .query('users')
            .withIndex('by_email', (q) => q.eq('email', email))
            .unique()
        const churchId = existing?.churchId ?? user?.churchId ?? undefined

        // Don't shorten an existing longer paid/comp period.
        const periodEnd =
            existing?.currentPeriodEnd && new Date(existing.currentPeriodEnd) > expires
                ? existing.currentPeriodEnd
                : expiresIso

        if (existing) {
            await ctx.db.patch(existing._id, {
                churchId,
                plan: 'pro',
                status: 'active',
                source: 'promo',
                promoCode: args.promoCode,
                currentPeriodEnd: periodEnd,
                gracePeriodDays: existing.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS,
                lastEventAt: nowIso,
                updatedAt: nowIso,
            })
            return periodEnd
        }

        await ctx.db.insert('subscriptions', {
            email,
            churchId,
            userId: user?._id,
            plan: 'pro',
            status: 'active',
            source: 'promo',
            promoCode: args.promoCode,
            currentPeriodEnd: periodEnd,
            gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
            lastEventAt: nowIso,
            createdAt: nowIso,
            updatedAt: nowIso,
        })
        return periodEnd
    },
})

/**
 * Pre-create a pending subscription row for a discount-promo checkout, so the
 * intro plan, revert plan, and cycle count are persisted before any webhook
 * (which can't reliably carry our metadata). Status stays "attention" until the
 * first charge.success flips it active.
 */
export const preparePromoSubscription = internalMutation({
    args: {
        email: v.string(),
        promoCode: v.string(),
        introPlanCode: v.string(),
        introCycles: v.number(),
        revertPlanCode: v.string(),
    },
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase()
        const nowIso = new Date().toISOString()
        const existing = await ctx.db
            .query('subscriptions')
            .withIndex('by_email', (q) => q.eq('email', email))
            .unique()

        const pendingPromo = {
            promoCode: args.promoCode,
            introPlanCode: args.introPlanCode,
            introCycles: args.introCycles,
            revertPlanCode: args.revertPlanCode,
        }

        // Only the intent is recorded; nothing about the live subscription
        // changes until the discounted plan is actually paid for (see
        // applyPaystackEvent).
        if (existing) {
            await ctx.db.patch(existing._id, { pendingPromo, updatedAt: nowIso })
            return existing._id
        }

        const user = await ctx.db
            .query('users')
            .withIndex('by_email', (q) => q.eq('email', email))
            .unique()

        return await ctx.db.insert('subscriptions', {
            email,
            userId: user?._id,
            plan: 'free',
            status: 'attention',
            source: 'paystack',
            currentPeriodEnd: null,
            gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
            pendingPromo,
            lastEventAt: nowIso,
            createdAt: nowIso,
            updatedAt: nowIso,
        })
    },
})

/**
 * Finish an intro→normal rollover after the webhook has created the new
 * normal-priced subscription on Paystack. Points the row at the new plan and
 * clears the intro/discount bookkeeping.
 */
export const finalizeRollover = internalMutation({
    args: { email: v.string(), newSubscriptionCode: v.string(), planCode: v.string() },
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase()
        const existing = await ctx.db
            .query('subscriptions')
            .withIndex('by_email', (q) => q.eq('email', email))
            .unique()
        if (!existing) return
        await ctx.db.patch(existing._id, {
            status: 'active',
            paystackSubscriptionCode: args.newSubscriptionCode,
            paystackPlanCode: args.planCode,
            introCyclesRemaining: null,
            revertPlanCode: undefined,
            promoCode: undefined,
            updatedAt: new Date().toISOString(),
        })
    },
})

// How often to try starting the normal-priced subscription, and how long to
// wait between tries (1m, 5m, 30m, 2h, 6h).
const ROLLOVER_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]

/** Whether a row's intro→normal rollover has already happened. */
export const rolloverDone = internalQuery({
    args: { email: v.string(), revertPlanCode: v.string() },
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query('subscriptions')
            .withIndex('by_email', (q) => q.eq('email', args.email.toLowerCase()))
            .first()
        return !row || (row.paystackPlanCode === args.revertPlanCode && row.introCyclesRemaining == null)
    },
})

/**
 * Start the normal-priced subscription once an intro discount is used up.
 *
 * Scheduled from the webhook rather than run inside it. Inline, a failure was
 * swallowed (so as not to fail the webhook) and never retried, leaving the
 * customer silently unbilled after the discount. Now it retries with backoff,
 * and checks first that an earlier attempt hasn't already succeeded.
 */
export const startRollover = internalAction({
    args: {
        email: v.string(),
        customerCode: v.string(),
        authorizationCode: v.string(),
        revertPlanCode: v.string(),
        startDate: v.union(v.string(), v.null()),
        attempt: v.number(),
    },
    handler: async (ctx, args) => {
        if (await ctx.runQuery(internal.licensing.rolloverDone, { email: args.email, revertPlanCode: args.revertPlanCode })) {
            return { status: 'already-done' as const }
        }

        const secret = process.env.PAYSTACK_SECRET_KEY
        let failure: string
        if (!secret) {
            failure = 'PAYSTACK_SECRET_KEY is not configured'
        } else {
            try {
                const res = await fetch('https://api.paystack.co/subscription', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customer: args.customerCode,
                        plan: args.revertPlanCode,
                        authorization: args.authorizationCode,
                        // Begin right when the discounted period ends (omit to start now).
                        ...(args.startDate ? { start_date: args.startDate } : {}),
                    }),
                })
                const body = (await res.json()) as { status: boolean; message?: string; data?: { subscription_code: string } }
                if (res.ok && body.status && body.data?.subscription_code) {
                    await ctx.runMutation(internal.licensing.finalizeRollover, {
                        email: args.email,
                        newSubscriptionCode: body.data.subscription_code,
                        planCode: args.revertPlanCode,
                    })
                    return { status: 'started' as const }
                }
                failure = body.message || `Paystack returned ${res.status}`
            } catch (err) {
                failure = err instanceof Error ? err.message : String(err)
            }
        }

        const delay = ROLLOVER_RETRY_DELAYS_MS[args.attempt]
        if (delay === undefined) {
            console.error(`[licensing] rollover for ${args.email} failed for good: ${failure}`)
            return { status: 'failed' as const }
        }
        console.warn(`[licensing] rollover for ${args.email} failed (attempt ${args.attempt + 1}): ${failure}; retrying`)
        await ctx.scheduler.runAfter(delay, internal.licensing.startRollover, { ...args, attempt: args.attempt + 1 })
        return { status: 'retrying' as const }
    },
})

// --- free trial -------------------------------------------------------------

/**
 * Grant the card-free 14-day Pro trial, but ONLY to an email that has never had
 * a subscription row. Because trial rows are never deleted (an expired trial
 * lingers with `status: 'trialing'` and a past `currentPeriodEnd`), the mere
 * existence of a row means the user has already trialed, is paying, or was
 * comped — so this is safe to call idempotently on every sign-in.
 *
 * A plain helper (not a Convex function) so it can run inside any mutation's
 * transaction — `upsertUser` calls it at signup, and `ensureTrial` calls it for
 * every subsequent sign-in.
 */
export async function maybeStartTrial(
    ctx: MutationCtx,
    args: { email: string; userId?: string | null; churchId?: string | null }
): Promise<void> {
    const email = args.email.toLowerCase()

    // Deliberately not `.unique()`. Nothing enforces one row per email, and a
    // historical clerkId bug left real deployments with duplicates — where
    // `.unique()` throws on its very first query, so the trial is never granted
    // and the account is stuck that way forever. A duplicate should degrade the
    // lookup, not disable trial provisioning outright.
    //
    // `upsertUser` heals duplicates on sign-in, so this is the belt to its
    // braces: pick the row carrying a church (the one that determines whether a
    // trial is owed at all), else the oldest, which is the row other tables are
    // most likely to reference.
    const userRows = await ctx.db
        .query('users')
        .withIndex('by_email', (q) => q.eq('email', email))
        .collect()

    if (userRows.length > 1) {
        console.warn(
            `[licensing] ${userRows.length} users rows share ${email} ` +
                `(${userRows.map((row) => row._id).join(', ')}); using the best match`
        )
    }

    const userRow =
        userRows.find((row) => row.churchId) ??
        userRows.sort((a, b) => a._creationTime - b._creationTime)[0]

    const churchId = args.churchId ?? userRow?.churchId ?? undefined

    // The trial is ONE per church: if the church already has any subscription
    // (trial/paid/comp/expired), an invited member inherits it rather than
    // starting a fresh trial of their own.
    if (churchId) {
        const churchSub = await getChurchSubscription(ctx, churchId)
        if (churchSub) return
    }

    // `.first()`, not `.unique()`, for the reason given above: duplicates must
    // not throw. The gate is only "has this email ever had a subscription", and
    // more than one row answers that just as well as exactly one — whereas a
    // throw here would hand the account a *second* trial on the next attempt.
    const existing = await ctx.db
        .query('subscriptions')
        .withIndex('by_email', (q) => q.eq('email', email))
        .first()
    if (existing) {
        // Backfill churchId onto a legacy per-email row so it becomes the
        // church's subscription (and future members inherit it).
        if (churchId && !existing.churchId) {
            await ctx.db.patch(existing._id, { churchId, updatedAt: new Date().toISOString() })
        }
        return
    }

    const now = new Date()
    const nowIso = now.toISOString()
    const end = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    await ctx.db.insert('subscriptions', {
        email,
        churchId,
        userId: args.userId ?? userRow?._id ?? undefined,
        plan: 'pro',
        status: 'trialing',
        source: 'trial',
        currentPeriodEnd: end,
        gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
        lastEventAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
    })
}

/**
 * Public entry point the client calls once per sign-in to make sure the trial
 * clock has been started for the current user. Idempotent (see maybeStartTrial).
 */
export const ensureTrial = mutation({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity()
        if (!identity?.email) return
        await maybeStartTrial(ctx, { email: identity.email })
    },
})

// Paystack retries a delivery for up to 72 hours; keep a comfortable margin
// beyond that, then forget the key.
const PAYSTACK_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** Delete processed-event keys past retention, a batch at a time. */
export const prunePaystackEvents = internalMutation({
    args: {},
    handler: async (ctx) => {
        const BATCH = 500
        const cutoff = Date.now() - PAYSTACK_EVENT_RETENTION_MS
        const old = await ctx.db
            .query('paystackEvents')
            .withIndex('by_received_at', (q) => q.lt('receivedAt', cutoff))
            .take(BATCH)
        for (const row of old) {
            await ctx.db.delete(row._id)
        }
        if (old.length === BATCH) {
            await ctx.scheduler.runAfter(0, internal.licensing.prunePaystackEvents, {})
        }
        return { deleted: old.length }
    },
})
