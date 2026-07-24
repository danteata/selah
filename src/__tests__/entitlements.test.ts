/**
 * Pure-logic tests for the church-scoped entitlement core.
 *
 * The stateful resolvers (churchIsPro / assertTeamMemberLimit) need a Convex
 * ctx and belong in a convex-test harness (follow-up — none is set up yet).
 * What's testable without a DB is the two pieces everything else is built on:
 * the plan caps and `isProActive`, the single predicate that decides whether a
 * subscription row currently confers Pro.
 */
import { describe, it, expect } from 'vitest'
import { PLAN_LIMITS } from '../../convex/entitlements'
import { isProActive } from '../../convex/licensing'
import type { SubscriptionRow } from '../../convex/licensing'

const NOW = new Date('2026-07-24T00:00:00.000Z')
const FUTURE = '2026-08-24T00:00:00.000Z'
const PAST = '2026-06-24T00:00:00.000Z'

function row(partial: Partial<SubscriptionRow>): SubscriptionRow {
    return { plan: 'pro', status: 'active', ...partial } as unknown as SubscriptionRow
}

describe('PLAN_LIMITS (size caps)', () => {
    it('free is solo (1) and pro is capped at 5', () => {
        expect(PLAN_LIMITS.free.maxTeamMembers).toBe(1)
        expect(PLAN_LIMITS.pro.maxTeamMembers).toBe(5)
    })
})

describe('isProActive', () => {
    it('is false for no subscription', () => {
        expect(isProActive(null, NOW)).toBe(false)
    })

    it('is false for a free-plan row', () => {
        expect(isProActive(row({ plan: 'free' }), NOW)).toBe(false)
    })

    it('is false for a cancelled Pro row even within its period', () => {
        expect(isProActive(row({ status: 'cancelled', currentPeriodEnd: FUTURE }), NOW)).toBe(false)
    })

    it('is true for an active Pro row with no period end', () => {
        expect(isProActive(row({ status: 'active', currentPeriodEnd: undefined }), NOW)).toBe(true)
    })

    it('is true within the paid period', () => {
        expect(isProActive(row({ currentPeriodEnd: FUTURE }), NOW)).toBe(true)
    })

    it('is false once the paid period has lapsed', () => {
        expect(isProActive(row({ currentPeriodEnd: PAST }), NOW)).toBe(false)
    })

    it('treats a trialing Pro row within its period as active (trial = Pro)', () => {
        expect(isProActive(row({ status: 'trialing', currentPeriodEnd: FUTURE }), NOW)).toBe(true)
    })
})
