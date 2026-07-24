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

import { internalQuery, internalMutation, mutation, type MutationCtx } from './_generated/server'
import { v } from 'convex/values'
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
        const user = await ctx.db
            .query('users')
            .withIndex('by_email', (q) => q.eq('email', email))
            .unique()
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
    },
    handler: async (ctx, args) => {
        const email = args.email.toLowerCase()

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
            existing = await ctx.db
                .query('subscriptions')
                .withIndex('by_email', (q) => q.eq('email', email))
                .unique()
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

        // Intro-discount countdown: spend one discounted cycle per charge. When
        // the last one is spent and a revert plan is set, signal the caller to
        // start the normal-priced subscription off the saved card.
        let introCyclesRemaining = existing?.introCyclesRemaining ?? null
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
            if (introCyclesRemaining <= 0 && existing?.revertPlanCode) {
                rollover = {
                    customerCode: args.paystackCustomerCode ?? existing.paystackCustomerCode,
                    authorizationCode:
                        args.authorizationCode ?? existing.paystackAuthorizationCode,
                    revertPlanCode: existing.revertPlanCode,
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
            .unique()
        const churchId = existing?.churchId ?? userByEmail?.churchId ?? undefined

        const now = args.eventAt
        const patch = {
            email,
            churchId,
            plan: args.plan,
            status: args.status,
            paystackCustomerCode: args.paystackCustomerCode ?? existing?.paystackCustomerCode,
            paystackSubscriptionCode:
                args.paystackSubscriptionCode ?? existing?.paystackSubscriptionCode,
            paystackPlanCode: args.paystackPlanCode ?? existing?.paystackPlanCode,
            paystackAuthorizationCode:
                args.authorizationCode ?? existing?.paystackAuthorizationCode,
            currentPeriodEnd: mergedEnd,
            gracePeriodDays: existing?.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS,
            introCyclesRemaining,
            lastEventAt: now,
            lastChargeAt: args.chargedAt ?? existing?.lastChargeAt,
            updatedAt: now,
        }

        if (existing) {
            await ctx.db.patch(existing._id, patch)
            return { id: existing._id, rollover }
        }

        const id = await ctx.db.insert('subscriptions', {
            ...patch,
            source: 'paystack' as const,
            userId: userByEmail?._id,
            createdAt: now,
        })
        return { id, rollover }
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

        const fields = {
            plan: 'pro' as const,
            status: 'attention' as const,
            source: 'paystack' as const,
            promoCode: args.promoCode,
            paystackPlanCode: args.introPlanCode,
            revertPlanCode: args.revertPlanCode,
            introCyclesRemaining: args.introCycles,
            updatedAt: nowIso,
        }

        if (existing) {
            await ctx.db.patch(existing._id, fields)
            return existing._id
        }

        const user = await ctx.db
            .query('users')
            .withIndex('by_email', (q) => q.eq('email', email))
            .unique()

        return await ctx.db.insert('subscriptions', {
            email,
            userId: user?._id,
            currentPeriodEnd: null,
            gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
            lastEventAt: nowIso,
            createdAt: nowIso,
            ...fields,
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

    const userRow = await ctx.db
        .query('users')
        .withIndex('by_email', (q) => q.eq('email', email))
        .unique()
    const churchId = args.churchId ?? userRow?.churchId ?? undefined

    // The trial is ONE per church: if the church already has any subscription
    // (trial/paid/comp/expired), an invited member inherits it rather than
    // starting a fresh trial of their own.
    if (churchId) {
        const churchSub = await getChurchSubscription(ctx, churchId)
        if (churchSub) return
    }

    const existing = await ctx.db
        .query('subscriptions')
        .withIndex('by_email', (q) => q.eq('email', email))
        .unique()
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
