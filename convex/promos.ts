/**
 * Promo codes.
 *
 * Paystack has no native coupon system, so codes live here. Two kinds:
 *
 *   comp     — grants Pro free for `compDays`, no payment. Redeeming writes a
 *              `subscriptions` row (source: "promo") and the app immediately
 *              gets a Pro license that expires when the comp period ends.
 *
 *   discount — checkout runs against `introPlanCode` (a cheaper Paystack plan
 *              you create with invoice_limit = introCycles). After those cycles
 *              the subscription rolls over to `revertPlanCode` (normal price)
 *              using the customer's saved card. See convex/http.ts (rollover)
 *              and convex/licensing.ts (cycle countdown).
 *
 * Redemptions are one-per-(code, email): a user can't burn a code twice, and a
 * code's `maxRedemptions` caps total uses.
 */

import { query, mutation, action, internalQuery, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

export function normalizeCode(code: string): string {
    return code.trim().toUpperCase()
}

type PromoDoc = {
    code: string
    kind: 'comp' | 'discount'
    description?: string
    active: boolean
    expiresAt?: string | null
    maxRedemptions?: number | null
    timesRedeemed: number
    compDays?: number
    introPlanCode?: string
    introCycles?: number
    revertPlanCode?: string
}

/** Pure validity check independent of the calling user. */
function evaluatePromo(promo: PromoDoc | null, nowMs: number): { ok: boolean; reason?: string } {
    if (!promo) return { ok: false, reason: 'Code not found' }
    if (!promo.active) return { ok: false, reason: 'Code is no longer active' }
    if (promo.expiresAt && new Date(promo.expiresAt).getTime() <= nowMs) {
        return { ok: false, reason: 'Code has expired' }
    }
    if (
        promo.maxRedemptions != null &&
        promo.timesRedeemed >= promo.maxRedemptions
    ) {
        return { ok: false, reason: 'Code has reached its redemption limit' }
    }
    if (promo.kind === 'comp' && !promo.compDays) {
        return { ok: false, reason: 'Code is misconfigured' }
    }
    if (promo.kind === 'discount' && (!promo.introPlanCode || !promo.introCycles)) {
        return { ok: false, reason: 'Code is misconfigured' }
    }
    return { ok: true }
}

// --- internal data access ---------------------------------------------------

export const getPromoByCode = internalQuery({
    args: { code: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query('promoCodes')
            .withIndex('by_code', (q) => q.eq('code', normalizeCode(args.code)))
            .unique()
    },
})

/**
 * Atomically record a redemption. Idempotent per (code, email): a repeat by the
 * same user does NOT consume another slot. Throws if the code is full. Returns
 * whether this user had already redeemed it.
 */
export const recordRedemption = internalMutation({
    args: { code: v.string(), email: v.string(), kind: v.string() },
    handler: async (ctx, args) => {
        const code = normalizeCode(args.code)
        const email = args.email.toLowerCase()

        const existing = await ctx.db
            .query('promoRedemptions')
            .withIndex('by_code_email', (q) => q.eq('code', code).eq('email', email))
            .unique()
        if (existing) return { alreadyRedeemed: true }

        const promo = await ctx.db
            .query('promoCodes')
            .withIndex('by_code', (q) => q.eq('code', code))
            .unique()
        if (!promo) throw new Error('Code not found')
        if (promo.maxRedemptions != null && promo.timesRedeemed >= promo.maxRedemptions) {
            throw new Error('Code has reached its redemption limit')
        }

        const now = new Date().toISOString()
        await ctx.db.insert('promoRedemptions', { code, email, kind: args.kind, redeemedAt: now })
        await ctx.db.patch(promo._id, {
            timesRedeemed: promo.timesRedeemed + 1,
            updatedAt: now,
        })
        return { alreadyRedeemed: false }
    },
})

// --- public: validate + redeem ---------------------------------------------

/**
 * Validate a code for the signed-in user. Returns a sanitized result (never
 * leaks plan codes). Used by the promo input before checkout/redeem.
 */
export const validatePromo = query({
    args: { code: v.string() },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity()
        if (!identity?.email) return { valid: false, reason: 'Sign in to use a promo code' }

        const code = normalizeCode(args.code)
        const promo = await ctx.db
            .query('promoCodes')
            .withIndex('by_code', (q) => q.eq('code', code))
            .unique()

        const verdict = evaluatePromo(promo, Date.now())
        if (!verdict.ok || !promo) return { valid: false, reason: verdict.reason }

        // comp is strictly one-shot per user. discount is re-entrant (a user may
        // re-open checkout if a payment failed), so we don't block it here.
        if (promo.kind === 'comp') {
            const already = await ctx.db
                .query('promoRedemptions')
                .withIndex('by_code_email', (q) =>
                    q.eq('code', code).eq('email', identity.email!.toLowerCase())
                )
                .unique()
            if (already) return { valid: false, reason: 'You have already used this code' }
        }

        return {
            valid: true,
            kind: promo.kind,
            description: promo.description,
            compDays: promo.kind === 'comp' ? promo.compDays : undefined,
            introCycles: promo.kind === 'discount' ? promo.introCycles : undefined,
        }
    },
})

/**
 * Redeem a comp code: grant Pro free for `compDays`, no payment. Discount codes
 * are NOT redeemed here — they go through paystack.initializeProCheckout.
 */
export const redeemComp = action({
    args: { code: v.string() },
    handler: async (ctx, args): Promise<{ success: boolean; expiresAt: string }> => {
        const identity = await ctx.auth.getUserIdentity()
        if (!identity?.email) throw new Error('Not authenticated')
        const email = identity.email.toLowerCase()

        const promo = await ctx.runQuery(internal.promos.getPromoByCode, { code: args.code })
        const verdict = evaluatePromo(promo, Date.now())
        if (!verdict.ok || !promo) throw new Error(verdict.reason ?? 'Invalid code')
        if (promo.kind !== 'comp') {
            throw new Error('This code is applied at checkout, not redeemed directly')
        }

        // Reserve the slot first (throws if full / returns alreadyRedeemed).
        const { alreadyRedeemed } = await ctx.runMutation(internal.promos.recordRedemption, {
            code: args.code,
            email,
            kind: 'comp',
        })
        if (alreadyRedeemed) throw new Error('You have already used this code')

        const expiresAt = await ctx.runMutation(internal.licensing.grantCompSubscription, {
            email,
            compDays: promo.compDays!,
            promoCode: normalizeCode(args.code),
        })

        return { success: true, expiresAt }
    },
})

// --- manage codes -----------------------------------------------------------
//
// Two ways in:
//   * Internal (`createPromoCode`/`setPromoActive`/`listPromoCodes`) — for the
//     operator via `npx convex run …` / the Convex dashboard (no user identity).
//   * Public, superadmin-gated (`admin*`) — for the in-app Promo Codes admin
//     panel. Both share the same `*Impl` bodies below.

const createPromoArgs = {
    code: v.string(),
    kind: v.union(v.literal('comp'), v.literal('discount')),
    description: v.optional(v.string()),
    expiresAt: v.optional(v.union(v.string(), v.null())),
    maxRedemptions: v.optional(v.union(v.number(), v.null())),
    compDays: v.optional(v.number()),
    introPlanCode: v.optional(v.string()),
    introCycles: v.optional(v.number()),
    revertPlanCode: v.optional(v.string()),
}

type CreatePromoArgs = {
    code: string
    kind: 'comp' | 'discount'
    description?: string
    expiresAt?: string | null
    maxRedemptions?: number | null
    compDays?: number
    introPlanCode?: string
    introCycles?: number
    revertPlanCode?: string
}

async function createPromoImpl(db: any, args: CreatePromoArgs) {
    const code = normalizeCode(args.code)

    const existing = await db
        .query('promoCodes')
        .withIndex('by_code', (q: any) => q.eq('code', code))
        .unique()
    if (existing) throw new Error('A code with that name already exists')

    if (args.kind === 'comp' && !args.compDays) {
        throw new Error('comp codes require compDays')
    }
    if (args.kind === 'discount' && (!args.introPlanCode || !args.introCycles)) {
        throw new Error('discount codes require introPlanCode and introCycles')
    }

    const now = new Date().toISOString()
    return await db.insert('promoCodes', {
        code,
        kind: args.kind,
        description: args.description,
        active: true,
        expiresAt: args.expiresAt ?? null,
        maxRedemptions: args.maxRedemptions ?? null,
        timesRedeemed: 0,
        compDays: args.compDays,
        introPlanCode: args.introPlanCode,
        introCycles: args.introCycles,
        revertPlanCode: args.revertPlanCode,
        createdAt: now,
        updatedAt: now,
    })
}

async function setPromoActiveImpl(db: any, code: string, active: boolean) {
    const promo = await db
        .query('promoCodes')
        .withIndex('by_code', (q: any) => q.eq('code', normalizeCode(code)))
        .unique()
    if (!promo) throw new Error('Code not found')
    await db.patch(promo._id, { active, updatedAt: new Date().toISOString() })
    return true
}

/** Throws unless the caller is a signed-in superadmin. */
async function requireSuperadmin(ctx: any) {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity?.email) throw new Error('Not authenticated')
    const email: string = identity.email
    const user =
        (await ctx.db
            .query('users')
            .withIndex('by_email', (q: any) => q.eq('email', email.toLowerCase()))
            .unique()) ??
        (await ctx.db
            .query('users')
            .withIndex('by_email', (q: any) => q.eq('email', email))
            .unique())
    if (!user || user.role !== 'superadmin') throw new Error('Superadmin only')
    return user
}

// Internal (operator / CLI)
export const createPromoCode = internalMutation({
    args: createPromoArgs,
    handler: (ctx, args) => createPromoImpl(ctx.db, args),
})

export const setPromoActive = internalMutation({
    args: { code: v.string(), active: v.boolean() },
    handler: (ctx, args) => setPromoActiveImpl(ctx.db, args.code, args.active),
})

export const listPromoCodes = internalQuery({
    args: {},
    handler: async (ctx) => ctx.db.query('promoCodes').collect(),
})

// Public, superadmin-gated (in-app admin panel)
export const adminCreatePromoCode = mutation({
    args: createPromoArgs,
    handler: async (ctx, args) => {
        await requireSuperadmin(ctx)
        return createPromoImpl(ctx.db, args)
    },
})

export const adminSetPromoActive = mutation({
    args: { code: v.string(), active: v.boolean() },
    handler: async (ctx, args) => {
        await requireSuperadmin(ctx)
        return setPromoActiveImpl(ctx.db, args.code, args.active)
    },
})

export const adminListPromoCodes = query({
    args: {},
    handler: async (ctx) => {
        await requireSuperadmin(ctx)
        return ctx.db.query('promoCodes').collect()
    },
})
