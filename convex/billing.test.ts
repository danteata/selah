/// <reference types="vite/client" />
/** Paystack webhook handling (licensing.applyPaystackEvent) and checkout guards. */
import { convexTest } from 'convex-test'
import { describe, it, expect } from 'vitest'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const email = 'admin@church.org'
const base = {
    email,
    plan: 'pro' as const,
    paystackCustomerCode: 'CUS_1',
    paystackSubscriptionCode: 'SUB_1',
    paystackPlanCode: 'PLN_normal',
    currentPeriodEnd: '2027-01-01T00:00:00.000Z',
}

async function subscriptionRow(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => await ctx.db.query('subscriptions').first())
}

describe('applyPaystackEvent', () => {
    it('applies a redelivered event only once', async () => {
        const t = convexTest(schema, modules)
        await t.run(async (ctx) => {
            await ctx.db.insert('subscriptions', {
                email, plan: 'pro', status: 'active', source: 'paystack', currentPeriodEnd: null,
                gracePeriodDays: 14, introCyclesRemaining: 3, revertPlanCode: 'PLN_normal',
                createdAt: '', updatedAt: '',
            })
        })
        const charge = { ...base, status: 'active' as const, isCharge: true, eventAt: '2026-09-01T00:00:00.000Z', eventKey: 'charge.success:1:success' }

        const first = await t.mutation(internal.licensing.applyPaystackEvent, charge)
        const again = await t.mutation(internal.licensing.applyPaystackEvent, charge)

        expect(first.duplicate).toBe(false)
        expect(again.duplicate).toBe(true)
        // One discounted cycle spent, not two.
        expect((await subscriptionRow(t))?.introCyclesRemaining).toBe(2)
    })

    it('does not let an older event overwrite a newer status', async () => {
        const t = convexTest(schema, modules)
        await t.mutation(internal.licensing.applyPaystackEvent, {
            ...base, status: 'active', eventAt: '2026-09-02T00:00:00.000Z', eventKey: 'invoice.update:9:success',
        })
        // A "payment failed" from before that success, delivered late.
        await t.mutation(internal.licensing.applyPaystackEvent, {
            ...base, status: 'past_due', eventAt: '2026-09-01T00:00:00.000Z', eventKey: 'invoice.payment_failed:9:failed',
        })
        expect((await subscriptionRow(t))?.status).toBe('active')
    })

    it('starts a discount only once its intro plan is paid for', async () => {
        const t = convexTest(schema, modules)
        await t.run(async (ctx) => {
            await ctx.db.insert('subscriptions', {
                email, plan: 'pro', status: 'active', source: 'paystack', currentPeriodEnd: null,
                gracePeriodDays: 14, paystackPlanCode: 'PLN_normal', createdAt: '', updatedAt: '',
            })
        })
        await t.mutation(internal.licensing.preparePromoSubscription, {
            email, promoCode: 'HALF', introPlanCode: 'PLN_intro', introCycles: 2, revertPlanCode: 'PLN_normal',
        })
        // Nothing about the live subscription changes before payment.
        let row = await subscriptionRow(t)
        expect(row?.introCyclesRemaining).toBeUndefined()
        expect(row?.pendingPromo?.introPlanCode).toBe('PLN_intro')

        // A charge on the existing full-price plan must not spend intro cycles.
        await t.mutation(internal.licensing.applyPaystackEvent, {
            ...base, status: 'active', isCharge: true, eventAt: '2026-09-01T00:00:00.000Z', eventKey: 'charge.success:2:success',
        })
        row = await subscriptionRow(t)
        expect(row?.introCyclesRemaining ?? null).toBeNull()

        // The intro plan is charged: now the discount starts (1 of 2 spent).
        await t.mutation(internal.licensing.applyPaystackEvent, {
            ...base, paystackPlanCode: 'PLN_intro', status: 'active', isCharge: true,
            eventAt: '2026-09-02T00:00:00.000Z', eventKey: 'charge.success:3:success',
        })
        row = await subscriptionRow(t)
        expect(row?.introCyclesRemaining).toBe(1)
        expect(row?.pendingPromo).toBeUndefined()
    })

    it('queues the full-price rollover when the last discounted cycle is spent', async () => {
        const t = convexTest(schema, modules)
        await t.run(async (ctx) => {
            await ctx.db.insert('subscriptions', {
                email, plan: 'pro', status: 'active', source: 'paystack', currentPeriodEnd: null,
                gracePeriodDays: 14, introCyclesRemaining: 1, revertPlanCode: 'PLN_normal',
                paystackCustomerCode: 'CUS_1', paystackAuthorizationCode: 'AUTH_1',
                createdAt: '', updatedAt: '',
            })
        })
        await t.mutation(internal.licensing.applyPaystackEvent, {
            ...base, paystackPlanCode: 'PLN_intro', status: 'active', isCharge: true,
            eventAt: '2026-09-01T00:00:00.000Z', eventKey: 'charge.success:4:success',
        })

        const scheduled = await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
        expect(scheduled.map((job) => job.name)).toContain('licensing:startRollover')
    })
})

describe('the church a subscription entitles', () => {
    /** A payer now in church B whose subscription row still names church A. */
    async function movedPayer() {
        const t = convexTest(schema, modules)
        await t.run(async (ctx) => {
            await ctx.db.insert('users', {
                fullname: 'Sam', email, role: 'superadmin', avatar: '', theme: '', churchId: 'church_b', createdAt: '', updatedAt: '',
            })
            await ctx.db.insert('subscriptions', {
                email, churchId: 'church_a', plan: 'free', status: 'cancelled', source: 'paystack', currentPeriodEnd: null,
                gracePeriodDays: 14, createdAt: '', updatedAt: '',
            })
        })
        return t
    }
    const charge = { ...base, status: 'active' as const, isCharge: true, eventAt: '2026-10-01T00:00:00.000Z' }

    it('is the church the checkout was for, not the one the row named before', async () => {
        const t = await movedPayer()
        await t.mutation(internal.licensing.applyPaystackEvent, { ...charge, checkoutChurchId: 'church_b', eventKey: 'k1' })
        expect((await subscriptionRow(t))?.churchId).toBe('church_b')
    })

    it("isn't a church the payer doesn't belong to", async () => {
        const t = await movedPayer()
        await t.mutation(internal.licensing.applyPaystackEvent, { ...charge, checkoutChurchId: 'church_c', eventKey: 'k2' })
        expect((await subscriptionRow(t))?.churchId).toBe('church_a')
    })

    it("stays put for events that don't say (renewals, invoices)", async () => {
        const t = await movedPayer()
        await t.mutation(internal.licensing.applyPaystackEvent, { ...charge, eventKey: 'k3' })
        expect((await subscriptionRow(t))?.churchId).toBe('church_a')
    })

    it('is the redeemer’s church now for a comp code', async () => {
        const t = await movedPayer()
        await t.mutation(internal.licensing.grantCompSubscription, { email, compDays: 30, promoCode: 'FREE30' })
        expect((await subscriptionRow(t))?.churchId).toBe('church_b')
    })
})
