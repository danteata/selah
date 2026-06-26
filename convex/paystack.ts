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
import { internal } from './_generated/api'
import { v } from 'convex/values'
import { normalizeCode } from './promos'

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

        const data = await paystack<{
            authorization_url: string
            access_code: string
            reference: string
        }>('/transaction/initialize', 'POST', {
            email: identity.email,
            plan: planCode,
            callback_url: args.callbackUrl ?? process.env.PAYSTACK_CALLBACK_URL,
            // Echoed back on the webhook so we can resolve the user reliably.
            metadata: { email, plan: 'pro', promoCode: appliedPromo },
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

        const sub = await ctx.runQuery(internal.licensing.getSubscriptionForEmail, {
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
        return await ctx.db
            .query('subscriptions')
            .withIndex('by_email', (q) => q.eq('email', identity.email!.toLowerCase()))
            .unique()
    },
})
