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

/**
 * Move template favourites from the legacy `templates.favoritedBy` user lists
 * into `templateFavorites`, one row per church (or per user without a church).
 * The old lists mixed every church's users on the shared system templates, so
 * any favourite anywhere showed as a favourite for everyone. Idempotent: an
 * existing row is never duplicated. The old lists are left in place for
 * clients from before the move, which still read them; nothing new writes
 * them, so they can be dropped once those clients are gone. Run it once: a
 * second run would bring back a favourite removed since from its old list.
 *
 *   npx convex run migrations:migrateTemplateFavorites
 */
export const migrateTemplateFavorites = internalMutation({
    args: {},
    handler: async (ctx) => {
        const templates = await ctx.db.query('templates').take(2000)
        let moved = 0
        let skipped = 0
        const nowIso = new Date().toISOString()

        for (const template of templates) {
            const userIds = template.favoritedBy ?? []
            if (userIds.length === 0) continue

            for (const userId of userIds) {
                const userDocId = ctx.db.normalizeId('users', userId)
                const user = userDocId ? await ctx.db.get(userDocId) : null
                if (!user) {
                    skipped++
                    continue
                }
                const scope = user.churchId || user._id
                const existing = await ctx.db
                    .query('templateFavorites')
                    .withIndex('by_scope_and_template', (q) => q.eq('scope', scope).eq('templateId', template._id))
                    .first()
                if (existing) continue
                await ctx.db.insert('templateFavorites', {
                    scope,
                    templateId: template._id,
                    userId: user._id,
                    createdAt: nowIso,
                })
                moved++
            }
        }

        return { moved, skipped }
    },
})

/**
 * Give each custom template the church it belongs to: its creator's church.
 * Templates used to be matched to a church through their creator at read
 * time; they're now read by `churchId`, so one without it is visible only to
 * its creator until this runs. Idempotent: templates that have a churchId, and
 * system templates (no creator), are skipped.
 *
 *   npx convex run migrations:backfillTemplateChurchIds
 */
export const backfillTemplateChurchIds = internalMutation({
    args: {},
    handler: async (ctx) => {
        const templates = await ctx.db.query('templates').take(5000)
        let updated = 0
        let churchless = 0
        for (const template of templates) {
            if (!template.createdBy || template.churchId) continue
            const creatorId = ctx.db.normalizeId('users', template.createdBy)
            const creator = creatorId ? await ctx.db.get(creatorId) : null
            if (creator?.churchId) {
                await ctx.db.patch(template._id, { churchId: creator.churchId })
                updated++
            } else {
                // The creator has no church (or is gone): it stays theirs alone.
                churchless++
            }
        }
        return { total: templates.length, updated, churchless }
    },
})
