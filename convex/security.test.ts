/// <reference types="vite/client" />
/**
 * Who may read and change what. Each case here was, before the auth rewrite
 * (convex/lib/auth.ts), open to any caller who could name an id.
 */
import { convexTest } from 'convex-test'
import { describe, it, expect } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const alice = { subject: 'user_alice', email: 'alice@church-a.org', tokenIdentifier: 'clerk|user_alice' }
const bob = { subject: 'user_bob', email: 'bob@church-b.org', tokenIdentifier: 'clerk|user_bob' }

/** Two churches, each founded (and so administered) by one person. */
async function twoChurches() {
    const t = convexTest(schema, modules)
    const asAlice = t.withIdentity(alice)
    const asBob = t.withIdentity(bob)
    await asAlice.mutation(api.users.upsertUser, { fullname: 'Alice' })
    await asBob.mutation(api.users.upsertUser, { fullname: 'Bob' })
    const churchA = await asAlice.mutation(api.churches.createChurch, { name: 'Church A' })
    const churchB = await asBob.mutation(api.churches.createChurch, { name: 'Church B' })
    return { t, asAlice, asBob, churchA, churchB }
}

describe('identity comes from the token, not the arguments', () => {
    it('ignores a clerkId and email sent to upsertUser', async () => {
        const { t } = await twoChurches()
        const mallory = t.withIdentity({ subject: 'user_mallory', email: 'mallory@evil.test', tokenIdentifier: 'clerk|user_mallory' })

        // The old attack: claim Alice's email to adopt her row.
        await mallory.mutation(api.users.upsertUser, {
            clerkId: 'user_mallory',
            email: alice.email,
            fullname: 'Mallory',
            churchId: 'anything',
        })

        const me = await mallory.query(api.users.getCurrentUser, {})
        expect(me?.email).toBe('mallory@evil.test')
        expect(me?.churchId).toBe('')
        const aliceRow = await t.withIdentity(alice).query(api.users.getCurrentUser, {})
        expect(aliceRow?.clerkId).toBe('user_alice')
    })

    it('does nothing for a caller with no identity', async () => {
        const t = convexTest(schema, modules)
        expect(await t.mutation(api.users.upsertUser, { fullname: 'Nobody', email: 'x@y.z' })).toBeNull()
    })

    it("won't move a non-superadmin into another church", async () => {
        const { asBob, churchA } = await twoChurches()
        await expect(asBob.mutation(api.users.updateUserChurch, { churchId: churchA })).rejects.toThrow()
    })
})

describe('church data stays in its church', () => {
    it("hides another church's schedules and transcripts", async () => {
        const { asAlice, asBob, churchA } = await twoChurches()
        await asAlice.mutation(api.schedules.createSchedule, { name: 'Sunday', churchId: churchA })
        await asAlice.mutation(api.transcripts.create, {
            title: 'Sermon', transcript: 'In the beginning', provider: 'web-speech',
        })

        expect(await asAlice.query(api.schedules.getSchedules, { churchId: churchA })).toHaveLength(1)
        expect(await asBob.query(api.schedules.getSchedules, { churchId: churchA })).toEqual([])
        expect(await asBob.query(api.transcripts.getByChurch, { churchId: churchA })).toEqual([])
    })

    it("won't write slides into another church's schedule", async () => {
        const { asAlice, asBob, churchA } = await twoChurches()
        const scheduleId = await asAlice.mutation(api.schedules.createSchedule, { name: 'Sunday', churchId: churchA })

        await expect(asBob.mutation(api.slides.applyScheduleSlideChanges, {
            scheduleId,
            upserts: [{ id: 'evil', index: 0, name: 'x', type: 'text', layout: 'full-text', contents: ['injected'] }],
            deletes: [],
        })).rejects.toThrow()
    })

    it("won't let another church's admin blank this church's projector", async () => {
        const { asAlice, asBob, churchA } = await twoChurches()
        const scheduleId = await asAlice.mutation(api.schedules.createSchedule, { name: 'Sunday', churchId: churchA })
        const sessionId = await asAlice.mutation(api.liveSessions.startSession, { scheduleId, churchId: churchA })

        // Bob is an admin too — of Church B. The role is global; that used
        // to be enough.
        await expect(asBob.mutation(api.liveSessions.toggleBlank, { sessionId, isBlank: true })).rejects.toThrow()
        await asAlice.mutation(api.liveSessions.toggleBlank, { sessionId, isBlank: true })
    })

    it('keeps API keys out of the settings sent to ordinary users', async () => {
        const { t, asBob } = await twoChurches()
        await t.run(async (ctx) => {
            await ctx.db.insert('globalAppSettings', {
                sermonListener_whisperApiKey: 'sk-secret',
                createdAt: '', updatedAt: '', updatedBy: 'system',
            })
        })
        const settings = await asBob.query(api.globalAppSettings.getGlobalSettings, {})
        expect(settings).not.toHaveProperty('sermonListener_whisperApiKey')
    })
})

describe('slide sync only deletes what the operator removed', () => {
    it("leaves a collaborator's slide alone", async () => {
        const { t, asAlice, churchA } = await twoChurches()
        const scheduleId = await asAlice.mutation(api.schedules.createSchedule, { name: 'Sunday', churchId: churchA })
        const slide = (id: string) => ({ id, index: 0, name: id, type: 'text', layout: 'full-text', contents: [id] })

        await asAlice.mutation(api.slides.applyScheduleSlideChanges, { scheduleId, upserts: [slide('a'), slide('b')], deletes: [] })
        await asAlice.mutation(api.slides.applyScheduleSlideChanges, { scheduleId, upserts: [slide('c')], deletes: ['a'] })

        const ids = await t.run(async (ctx) =>
            (await ctx.db.query('slides').collect()).map((s) => s.id).sort())
        expect(ids).toEqual(['b', 'c'])
    })
})

describe('saving a service order', () => {
    it('accepts a slide carrying a library song and a live countdown clock', async () => {
        const { t, asAlice, churchA } = await twoChurches()
        const scheduleId = await asAlice.mutation(api.schedules.createSchedule, { name: 'Sunday', churchId: churchA })
        // What the client really sends: its copy of the library song, system
        // fields and all, and slide styling the table's old strict copy lacked.
        const song = {
            _id: 'song-doc', _creationTime: 1790579152317.658, id: 'song_1', title: 'Amazing Grace',
            artist: 'John Newton', lyrics: 'Amazing grace', copyright: 'Public domain', ccli: '22025',
        }
        await asAlice.mutation(api.slides.applyScheduleSlideChanges, {
            scheduleId,
            upserts: [{
                id: 'verse-1', index: 0, name: 'Amazing Grace - Verse 1', type: 'song', layout: 'full-text',
                contents: ['Amazing grace'], songId: 'song-doc', data: song,
                slideStyle: { verseRefPosition: 'top', countdownEndsAt: 1790580000000, mediaSeekNonce: 2 },
            }],
            deletes: [],
        })
        const saved = await t.run(async (ctx) => await ctx.db.query('slides').first())
        expect(saved?.data?.title).toBe('Amazing Grace')
    })
})

describe('invitations', () => {
    it("keeps the church's default link working after someone joins with it", async () => {
        const { t, asAlice, churchA } = await twoChurches()
        const church = await asAlice.query(api.churches.getChurchById, { id: churchA })
        const code = church!.defaultInviteCode!

        const carol = t.withIdentity({ subject: 'user_carol', email: 'carol@x.org', tokenIdentifier: 'clerk|user_carol' })
        const dave = t.withIdentity({ subject: 'user_dave', email: 'dave@x.org', tokenIdentifier: 'clerk|user_dave' })
        // Pro, so the team cap allows more than one member.
        await t.run(async (ctx) => {
            await ctx.db.insert('subscriptions', {
                email: alice.email, churchId: churchA, plan: 'pro', status: 'active',
                currentPeriodEnd: new Date(Date.now() + 864e5).toISOString(), gracePeriodDays: 14,
                createdAt: '', updatedAt: '',
            })
        })

        await carol.mutation(api.churches.joinChurch, { inviteCode: code })
        // It used to be marked "accepted" by the first joiner and die.
        await dave.mutation(api.churches.joinChurch, { inviteCode: code })
        expect((await dave.query(api.users.getCurrentUser, {}))?.churchId).toBe(churchA)
    })
})
