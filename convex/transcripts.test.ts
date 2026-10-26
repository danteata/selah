/// <reference types="vite/client" />
/**
 * The saved-transcripts list reads summaries kept beside each transcript, not
 * the transcripts themselves.
 */
import { convexTest } from 'convex-test'
import { describe, it, expect } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const alice = { subject: 'user_alice', email: 'alice@church-a.org', tokenIdentifier: 'clerk|user_alice' }
const bob = { subject: 'user_bob', email: 'bob@church-b.org', tokenIdentifier: 'clerk|user_bob' }

async function setup() {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(alice)
    const asBob = t.withIdentity(bob)
    await asAlice.mutation(api.users.upsertUser, { fullname: 'Alice' })
    await asBob.mutation(api.users.upsertUser, { fullname: 'Bob' })
    const churchA = await asAlice.mutation(api.churches.createChurch, { name: 'Church A' })
    await asBob.mutation(api.churches.createChurch, { name: 'Church B' })
    return { t, asAlice, asBob, churchA: churchA as string }
}

const verse = (reference: string) => ({ reference, book: 'John', chapter: 3, verseStart: 16, confidence: 'high' })

describe('transcript summaries', () => {
    it('lists a saved transcript by its summary: the start of the text and its verses', async () => {
        const { asAlice, churchA } = await setup()
        const text = 'In the beginning '.repeat(100)
        const id = await asAlice.mutation(api.transcripts.create, {
            title: 'Sunday',
            transcript: text,
            detectedVerses: [verse('John 3:16'), verse('Genesis 1:1')],
            segments: [{ id: 's1', text, startMs: 0, endMs: 1000, source: 'whisper' }],
            provider: 'whisper',
        })

        const [summary] = await asAlice.query(api.transcripts.listSummaries, { churchId: churchA })
        expect(summary).toMatchObject({
            transcriptId: id,
            title: 'Sunday',
            preview: text.slice(0, 500),
            length: text.length,
            verseReferences: ['John 3:16', 'Genesis 1:1'],
            verseCount: 2,
        })
        expect(summary).not.toHaveProperty('segments')
        expect(summary).not.toHaveProperty('transcript')
    })

    it('follows the transcript as it is saved again, and goes with it', async () => {
        const { asAlice, churchA } = await setup()
        const id = await asAlice.mutation(api.transcripts.create, { title: 'Draft', transcript: 'So far', provider: 'whisper' })
        await asAlice.mutation(api.transcripts.update, { id, title: 'Sunday', transcript: 'So far, and then more' })

        const [summary] = await asAlice.query(api.transcripts.listSummaries, { churchId: churchA })
        expect(summary).toMatchObject({ title: 'Sunday', preview: 'So far, and then more' })

        await asAlice.mutation(api.transcripts.remove, { id })
        expect(await asAlice.query(api.transcripts.listSummaries, { churchId: churchA })).toEqual([])
    })

    it("lists only the caller's own church's", async () => {
        const { asAlice, asBob, churchA } = await setup()
        await asAlice.mutation(api.transcripts.create, { title: 'Ours', transcript: 'text', provider: 'whisper' })
        expect(await asBob.query(api.transcripts.listSummaries, { churchId: churchA })).toEqual([])
    })

    it('backfills summaries for transcripts saved before them', async () => {
        const { t, asAlice, churchA } = await setup()
        await t.run(async (ctx) => {
            const user = await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', alice.email)).unique()
            for (const title of ['Old one', 'Old two']) {
                await ctx.db.insert('transcripts', {
                    title,
                    transcript: `${title} text`,
                    provider: 'whisper',
                    churchId: churchA,
                    createdBy: user!._id,
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                })
            }
        })
        expect(await asAlice.query(api.transcripts.listSummaries, { churchId: churchA })).toEqual([])

        await t.mutation(internal.migrations.backfillTranscriptSummaries, {})
        await t.mutation(internal.migrations.backfillTranscriptSummaries, {})

        const titles = (await asAlice.query(api.transcripts.listSummaries, { churchId: churchA })).map((s) => s.title)
        expect(titles.sort()).toEqual(['Old one', 'Old two'])
    })
})
