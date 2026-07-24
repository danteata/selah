/**
 * One-off data migrations. Run with the Convex CLI against the target
 * deployment, e.g.:
 *
 *   npx convex run migrations:backfillSubscriptionChurchIds
 *
 * (Point the CLI at prod with `--prod` when you're ready.)
 */

import { internalMutation } from './_generated/server'
import type { Id } from './_generated/dataModel'

/**
 * Backfill `churchId` on legacy per-email subscription rows so billing becomes
 * church-scoped: resolve each row's church via its linked user (userId, else
 * by email). Idempotent — rows that already have a churchId are skipped, so
 * it's safe to run repeatedly. After this, every member of a church inherits
 * the church's plan and the transitional per-email entitlement fallback can be
 * removed (see convex/entitlements.ts).
 */
export const backfillSubscriptionChurchIds = internalMutation({
    args: {},
    handler: async (ctx) => {
        const subs = await ctx.db.query('subscriptions').collect()
        let updated = 0
        let unresolved = 0
        const nowIso = new Date().toISOString()

        for (const sub of subs) {
            if (sub.churchId) continue

            let churchId: string | undefined
            if (sub.userId) {
                const linked = await ctx.db.get(sub.userId as Id<'users'>)
                churchId = linked?.churchId ?? undefined
            }
            if (!churchId) {
                const byEmail = await ctx.db
                    .query('users')
                    .withIndex('by_email', (q) => q.eq('email', sub.email))
                    .unique()
                churchId = byEmail?.churchId ?? undefined
            }

            if (churchId) {
                await ctx.db.patch(sub._id, { churchId, updatedAt: nowIso })
                updated++
            } else {
                // No resolvable church (e.g. a webhook row that landed before
                // the user ever signed in). Leave it — the per-email fallback
                // still covers it until the user joins a church.
                unresolved++
            }
        }

        return { total: subs.length, updated, unresolved }
    },
})
