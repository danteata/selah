/**
 * One-off data migrations. Run with the Convex CLI against the target
 * deployment, e.g.:
 *
 *   npx convex run migrations:backfillSubscriptionChurchIds
 *
 * (Point the CLI at prod with `--prod` when you're ready.)
 */

import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { syncTranscriptSummary } from './transcripts'

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

/** Transcripts per batch: each is read whole, segments and all. */
const TRANSCRIPT_BACKFILL_BATCH = 25

/**
 * Give every transcript its summary row (`transcriptSummaries`), which the
 * saved-transcripts list now reads instead of the transcripts themselves.
 * Transcripts saved since the summaries were added have one already; older
 * ones don't appear in the list until this runs. A batch at a time, each
 * scheduling the next, so a long history never outgrows one transaction.
 * Idempotent: rerunning rewrites the same summaries.
 *
 *   npx convex run migrations:backfillTranscriptSummaries
 */
export const backfillTranscriptSummaries = internalMutation({
    args: { cursor: v.optional(v.union(v.string(), v.null())) },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query('transcripts')
            .paginate({ numItems: TRANSCRIPT_BACKFILL_BATCH, cursor: args.cursor ?? null })
        for (const transcript of page.page) await syncTranscriptSummary(ctx, transcript._id)
        if (!page.isDone) {
            await ctx.scheduler.runAfter(0, internal.migrations.backfillTranscriptSummaries, { cursor: page.continueCursor })
        }
        return { summarized: page.page.length, done: page.isDone }
    },
})

/** Templates per batch: an embedded picture can make one most of a megabyte. */
const TEMPLATE_THUMBNAIL_BATCH = 25

/** The background a template's slide snapshot holds, whichever shape it was saved in. */
function snapshotBackground(slideId: unknown): unknown {
    let snapshot = slideId
    if (typeof snapshot === 'string') {
        try {
            snapshot = JSON.parse(snapshot)
        } catch {
            return undefined
        }
    }
    return snapshot && typeof snapshot === 'object' ? (snapshot as { background?: unknown }).background : undefined
}

/**
 * Drop each template thumbnail that is a second copy of the template's own
 * embedded picture. A picture picked in the browser is embedded in the
 * template as a data URL, and was stored again, whole, as its thumbnail; every
 * device read both copies with the template list each time any template in
 * the church changed. The picker now shows such a template its picture, and
 * new ones get a small thumbnail instead. Idempotent; a batch at a time.
 *
 *   npx convex run migrations:dropDuplicateTemplateThumbnails
 */
export const dropDuplicateTemplateThumbnails = internalMutation({
    args: { cursor: v.optional(v.union(v.string(), v.null())) },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query('templates')
            .paginate({ numItems: TEMPLATE_THUMBNAIL_BATCH, cursor: args.cursor ?? null })
        let dropped = 0
        for (const template of page.page) {
            const thumbnail = template.thumbnail
            if (!thumbnail?.startsWith('data:') || snapshotBackground(template.slideId) !== thumbnail) continue
            await ctx.db.patch(template._id, { thumbnail: undefined })
            dropped++
        }
        if (!page.isDone) {
            await ctx.scheduler.runAfter(0, internal.migrations.dropDuplicateTemplateThumbnails, { cursor: page.continueCursor })
        }
        return { dropped, done: page.isDone }
    },
})
