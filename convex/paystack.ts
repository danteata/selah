/**
 * Paystack server-side operations.
 *
 * These run on Convex with the Paystack *secret* key, which must NEVER ship in
 * the desktop/web client. The old client-side PaystackAdapter
 * (src/services/payments) talked to Paystack directly with the secret key —
 * that's the security hole these actions close. The frontend now calls these
 * authenticated Convex functions instead.
 *
 * Required env on the Convex deployment:
 *   npx convex env set PAYSTACK_SECRET_KEY   sk_live_or_test_xxx
 *   npx convex env set PAYSTACK_PRO_PLAN_CODE PLN_xxx       # monthly Pro plan
 *   npx convex env set PAYSTACK_CALLBACK_URL  https://app.example.com/billing/return  # optional default
 */

import { action, query } from './_generated/server'
import { internal, api } from './_generated/api'
import { v } from 'convex/values'
import { normalizeCode } from './promos'
import { getEffectiveSubscription, churchIsPro, countTeamMembers, PLAN_LIMITS } from './entitlements'

const PAYSTACK_API = 'https://api.paystack.co'

function secretKey(): string {
    const key = process.env.PAYSTACK_SECRET_KEY
    if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured on this deployment.')
    return key
}

async function paystack<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: Record<string, unknown>
): Promise<T> {
    const res = await fetch(`${PAYSTACK_API}${endpoint}`, {
        method,
        headers: {
            Authorization: `Bearer ${secretKey()}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    const data = (await res.json()) as { status: boolean; message?: string; data: T }
    if (!res.ok || !data.status) {
        throw new Error(data.message || `Paystack error (${res.status})`)
    }
    return data.data
}

/**
 * Start a Pro subscription checkout for the signed-in user.
 *
 * Initializing a transaction with a `plan` makes Paystack auto-create the
 * subscription on first successful charge; the resulting webhooks
 * (`subscription.create`, `charge.success`) sync our `subscriptions` table.
 * Returns the hosted authorization URL to open in a browser.
 */
export const initializeProCheckout = action({
    args: { callbackUrl: v.optional(v.string()), promoCode: v.optional(v.string()) },
    handler: async (
        ctx,
        args
    ): Promise<{ authorizationUrl: string; reference: string; accessCode: string }> => {
        const identity = await ctx.auth.getUserIdentity()
        if (!identity?.email) throw new Error('Not authenticated')
        const email = identity.email.toLowerCase()

        // Billing is per-church: only a church admin can subscribe, and the
        // payment is tagged with their churchId so the webhook attaches Pro to
        // the whole church (every member inherits it).
        const me = await ctx.runQuery(api.users.getCurrentUser, { clerkId: identity.subject })
        if (!me) throw new Error('User not found')
        if (me.role !== 'admin' && me.role !== 'superadmin') {
            throw new Error('Only a church admin can manage the subscription.')
        }
        const churchId = me.churchId

        const normalPlan = process.env.PAYSTACK_PRO_PLAN_CODE
        if (!normalPlan) throw new Error('PAYSTACK_PRO_PLAN_CODE is not configured on this deployment.')

        // Default: full-price Pro. A "discount" promo swaps in its cheaper intro
        // plan and records the intent so the webhook can roll over to normal
        // pricing once the discounted cycles are used up.
        let planCode = normalPlan
        let appliedPromo: string | undefined
        if (args.promoCode) {
            const promo = await ctx.runQuery(internal.promos.getPromoByCode, { code: args.promoCode })
            const nowMs = Date.now()
            if (!promo || !promo.active) throw new Error('Invalid or inactive promo code')
            if (promo.expiresAt && new Date(promo.expiresAt).getTime() <= nowMs) {
                throw new Error('Code has expired')
            }
            if (promo.maxRedemptions != null && promo.timesRedeemed >= promo.maxRedemptions) {
                throw new Error('Code has reached its redemption limit')
            }
            if (promo.kind !== 'discount') {
                throw new Error('This code is redeemed directly, not at checkout')
            }
            if (!promo.introPlanCode || !promo.introCycles) throw new Error('Code is misconfigured')

            const revertPlanCode = promo.revertPlanCode ?? normalPlan
            planCode = promo.introPlanCode
            appliedPromo = normalizeCode(args.promoCode)

            // Reserve the redemption (idempotent per user) and persist the intro
            // intent before checkout, so the rollover bookkeeping survives even
            // if the webhook can't echo our metadata.
            await ctx.runMutation(internal.promos.recordRedemption, {
                code: args.promoCode,
                email,
                kind: 'discount',
            })
            await ctx.runMutation(internal.licensing.preparePromoSubscription, {
                email,
                promoCode: appliedPromo,
                introPlanCode: promo.introPlanCode,
                introCycles: promo.introCycles,
                revertPlanCode,
            })
        }

        // Paystack's /transaction/initialize requires `amount` (and a matching
        // `currency`) even when a `plan` is supplied — omitting it fails with
        // "Invalid Amount Sent". Billing still follows the plan; we just fetch
        // the plan's own amount/currency so the initialize matches it exactly
        // (this also stays correct for cheaper intro/discount plans).
        const planDetails = await paystack<{ amount: number; currency: string }>(
            `/plan/${planCode}`
        )

        const data = await paystack<{
            authorization_url: string
            access_code: string
            reference: string
        }>('/transaction/initialize', 'POST', {
            email: identity.email,
            plan: planCode,
            amount: planDetails.amount,
            currency: planDetails.currency,
            callback_url: args.callbackUrl ?? process.env.PAYSTACK_CALLBACK_URL,
            // Echoed back on the webhook so we can resolve the church/user reliably.
            metadata: { email, plan: 'pro', promoCode: appliedPromo, churchId },
        })

        return {
            authorizationUrl: data.authorization_url,
            reference: data.reference,
            accessCode: data.access_code,
        }
    },
})

/**
 * Get a Paystack-hosted "manage subscription" link for the signed-in user, so
 * they can update their card or cancel without us ever holding an email token.
 */
export const getSubscriptionManageLink = action({
    args: {},
    handler: async (ctx): Promise<{ link: string | null }> => {
        const identity = await ctx.auth.getUserIdentity()
        if (!identity?.email) throw new Error('Not authenticated')

        const sub = await ctx.runQuery(internal.licensing.getEffectiveSubscriptionByEmail, {
            email: identity.email.toLowerCase(),
        })
        if (!sub?.paystackSubscriptionCode) return { link: null }

        const data = await paystack<{ link: string }>(
            `/subscription/${sub.paystackSubscriptionCode}/manage/link`,
            'GET'
        )
        return { link: data.link }
    },
})

/**
 * Read the current user's subscription row. Used by the web client (and as a
 * cross-check on desktop) to render plan/billing status. Returns null when the
 * user has no subscription on file (i.e. free).
 */
export const getMySubscription = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity()
        if (!identity?.email) return null
        // Resolve entitlement through the user's CHURCH (with a legacy
        // per-email fallback), so invited members inherit the church's plan.
        const user = await ctx.db
            .query('users')
            .withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.subject))
            .unique()
        return await getEffectiveSubscription(ctx, {
            churchId: user?.churchId ?? null,
            email: identity.email,
        })
    },
})

/**
 * Church billing summary for the team-management UI: the authoritative plan,
 * the team-size cap for that plan, and how full the team is. The client uses
 * this to gate the "Invite Member" action and to warn a church that has more
 * members than its (possibly downgraded) plan now allows. Single source of
 * truth so the cap never drifts from the server's enforcement (assertTeamMemberLimit).
 */
export const getMyChurchBilling = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity()
        if (!identity?.email) return null
        const user = await ctx.db
            .query('users')
            .withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.subject))
            .unique()
        const churchId = user?.churchId ?? null

        const pro = churchId ? await churchIsPro(ctx, churchId) : false
        const plan: 'free' | 'pro' = pro ? 'pro' : 'free'
        const maxTeamMembers = PLAN_LIMITS[plan].maxTeamMembers
        const memberCount = churchId ? await countTeamMembers(ctx, churchId) : 0

        // Pending *email* invites also claim a future seat, so count them toward
        // the gate — otherwise an admin could send invites that only bounce at
        // accept time. The persistent link/join code is not a seat, so exclude
        // non-email invites.
        let pendingInvites = 0
        if (churchId) {
            const invites = await ctx.db
                .query('invitations')
                .withIndex('by_church', (q) => q.eq('churchId', churchId))
                .collect()
            pendingInvites = invites.filter((i) => i.status === 'pending' && i.type === 'email').length
        }

        const projected = memberCount + pendingInvites
        return {
            plan,
            maxTeamMembers,
            memberCount,
            pendingInvites,
            // Can the admin send another invite without exceeding the cap?
            canAddMember: projected < maxTeamMembers,
            // Church already over its plan cap (e.g. was Pro with 5, downgraded to free=1).
            overCap: memberCount > maxTeamMembers,
            isAdmin: user?.role === 'admin' || user?.role === 'superadmin',
        }
    },
})
