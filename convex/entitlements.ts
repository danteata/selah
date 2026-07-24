/**
 * Church-scoped entitlements — the single source of truth for "is this church
 * on Pro?" and "how big can this church's team be?".
 *
 * Billing is scoped to the CHURCH (the org), not the individual: one active
 * subscription row per church (subscriptions.by_church), and every member
 * inherits it. This module resolves a user's entitlement through their church.
 *
 * During the migration off legacy per-email billing, resolution is HYBRID:
 * a user is Pro if their church is Pro OR (fallback) their own email row is
 * still active. Once all rows carry churchId, the email fallback can be
 * dropped (see MIGRATION note in the plan).
 *
 * These are plain helpers (not registered Convex functions), imported directly
 * by queries/mutations — so there's one implementation and no api indirection.
 */

import type { QueryCtx } from './_generated/server'
import { isProActive, type SubscriptionRow } from './licensing'

/**
 * Per-plan team-size caps (number of Selah user accounts in a church).
 * Collaboration is the paid value: FREE is single-user (solo — inviting a
 * teammate requires Pro), PRO allows a team of up to 5. Also the anti-abuse
 * lever — one paid church can't front for many congregations. Add a higher
 * tier here (e.g. team/church+) if larger/multi-campus churches outgrow 5.
 */
export const PLAN_LIMITS = {
    free: { maxTeamMembers: 1 },
    pro: { maxTeamMembers: 5 },
} as const

export type Plan = keyof typeof PLAN_LIMITS

function toRow(doc: Record<string, unknown> | null): SubscriptionRow | null {
    return (doc as unknown as SubscriptionRow) ?? null
}

/**
 * The church's governing subscription row: the active-Pro row with the
 * furthest-out period end, else the most recently updated row (so a
 * cancelled/expired row is still returned for display), else null.
 */
export async function getChurchSubscription(
    ctx: QueryCtx,
    churchId: string | null | undefined,
): Promise<SubscriptionRow | null> {
    if (!churchId) return null
    const rows = await ctx.db
        .query('subscriptions')
        .withIndex('by_church', (q) => q.eq('churchId', churchId))
        .collect()
    if (rows.length === 0) return null
    const now = new Date()
    const activePro = rows
        .filter((r) => isProActive(toRow(r), now))
        .sort((a, b) => new Date(b.currentPeriodEnd ?? 0).getTime() - new Date(a.currentPeriodEnd ?? 0).getTime())
    if (activePro.length > 0) return toRow(activePro[0])
    const byUpdated = [...rows].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    return toRow(byUpdated[0])
}

/** Is the church currently entitled to Pro? */
export async function churchIsPro(ctx: QueryCtx, churchId: string | null | undefined): Promise<boolean> {
    return isProActive(await getChurchSubscription(ctx, churchId), new Date())
}

/**
 * The effective plan for a user, resolved through their church, with a
 * transitional fallback to their own legacy per-email subscription.
 */
export async function userIsPro(
    ctx: QueryCtx,
    user: { churchId?: string | null; email?: string | null } | null,
): Promise<boolean> {
    if (!user) return false
    if (await churchIsPro(ctx, user.churchId)) return true
    // Transitional fallback: legacy email-keyed row (pre-migration).
    if (user.email) {
        const own = await ctx.db
            .query('subscriptions')
            .withIndex('by_email', (q) => q.eq('email', user.email!.toLowerCase()))
            .unique()
        if (isProActive(toRow(own), new Date())) return true
    }
    return false
}

export async function planForChurch(ctx: QueryCtx, churchId: string | null | undefined): Promise<Plan> {
    return (await churchIsPro(ctx, churchId)) ? 'pro' : 'free'
}

/**
 * The subscription row that governs a user's entitlement, used to build the
 * license and drive the client paywall. Prefers the church's active-Pro row;
 * falls back to the user's own legacy email row (so pre-migration individual
 * subscribers keep Pro); otherwise returns whichever row exists for display.
 */
export async function getEffectiveSubscription(
    ctx: QueryCtx,
    user: { churchId?: string | null; email?: string | null } | null,
): Promise<SubscriptionRow | null> {
    const now = new Date()
    const churchSub = await getChurchSubscription(ctx, user?.churchId)
    if (isProActive(churchSub, now)) return churchSub

    let ownSub: SubscriptionRow | null = null
    if (user?.email) {
        const own = await ctx.db
            .query('subscriptions')
            .withIndex('by_email', (q) => q.eq('email', user.email!.toLowerCase()))
            .unique()
        ownSub = toRow(own)
    }
    if (isProActive(ownSub, now)) return ownSub

    // Neither is Pro — return the church row for display if present, else own.
    return churchSub ?? ownSub
}

/** Count Selah user accounts belonging to a church. */
export async function countTeamMembers(ctx: QueryCtx, churchId: string): Promise<number> {
    const members = await ctx.db
        .query('users')
        .withIndex('by_church', (q) => q.eq('churchId', churchId))
        .collect()
    return members.length
}

/**
 * Throw if adding one more member would exceed the church's plan cap. Call
 * this BEFORE inserting/attaching the new member (accept-invite / join).
 */
export async function assertTeamMemberLimit(ctx: QueryCtx, churchId: string): Promise<void> {
    const plan = await planForChurch(ctx, churchId)
    const cap = PLAN_LIMITS[plan].maxTeamMembers
    const count = await countTeamMembers(ctx, churchId)
    if (count >= cap) {
        throw new Error(
            plan === 'pro'
                ? `This church has reached its Pro plan limit of ${cap} team members.`
                : `The free plan allows up to ${cap} team members. Upgrade to Pro to add more.`,
        )
    }
}
