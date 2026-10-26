/// <reference types="vite/client" />
/**
 * syncSongs: uploading songs saved on a device, in batches; syncLibrary:
 * bringing a device's copy of the library up to date.
 */
import { convexTest } from 'convex-test'
import { describe, it, expect, vi } from 'vitest'
import { api } from './_generated/api'
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
    await asAlice.mutation(api.churches.createChurch, { name: 'Church A' })
    await asBob.mutation(api.churches.createChurch, { name: 'Church B' })
    return { t, asAlice, asBob }
}

const song = (clientId: string, title: string, serverId?: string) => ({
    clientId,
    serverId,
    title,
    artist: 'Unknown',
    lyrics: `${title} lyrics`,
    sections: [{ id: 'v1', type: 'verse' as const, label: 'Verse 1', lines: [`${title} lyrics`] }],
})

describe('syncSongs', () => {
    it('creates new songs in the caller\'s church and returns their ids', async () => {
        const { asAlice } = await setup()
        const results = await asAlice.mutation(api.songs.syncSongs, {
            songs: [song('local_1', 'First'), song('ew_2', 'Second')],
        })
        expect(results.map((r) => r.clientId)).toEqual(['local_1', 'ew_2'])
        const titles = (await asAlice.query(api.songs.searchSongs, {})).map((s) => s.title).sort()
        expect(titles).toEqual(['First', 'Second'])
    })

    it('updates the server song a device copy is linked to, instead of adding another', async () => {
        const { asAlice } = await setup()
        const [{ serverId }] = await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_1', 'Hymn')] })
        const again = await asAlice.mutation(api.songs.syncSongs, {
            songs: [{ ...song('ew_9', 'Hymn', serverId), lyrics: 'corrected lyrics' }],
        })
        expect(again[0].serverId).toBe(serverId)
        const all = await asAlice.query(api.songs.searchSongs, {})
        expect(all).toHaveLength(1)
        expect(all[0].lyrics).toBe('corrected lyrics')
    })

    it("can't overwrite another church's song by naming its id", async () => {
        const { asAlice, asBob } = await setup()
        const [{ serverId }] = await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_1', 'Mine')] })
        const results = await asBob.mutation(api.songs.syncSongs, {
            songs: [{ ...song('local_x', 'Mine', serverId), lyrics: 'defaced' }],
        })
        // Bob gets his own copy; Alice's is untouched.
        expect(results[0].serverId).not.toBe(serverId)
        expect((await asAlice.query(api.songs.searchSongs, {}))[0].lyrics).toBe('Mine lyrics')
    })

    it('refuses an oversized batch', async () => {
        const { asAlice } = await setup()
        const many = Array.from({ length: 51 }, (_, i) => song(`local_${i}`, `Song ${i}`))
        await expect(asAlice.mutation(api.songs.syncSongs, { songs: many })).rejects.toThrow(/At most 50/)
    })

    it('requires a signed-in caller', async () => {
        const t = convexTest(schema, modules)
        await expect(t.mutation(api.songs.syncSongs, { songs: [song('local_1', 'X')] })).rejects.toThrow()
    })
})

/** Run `fn` with the clock this far ahead. */
async function later<T>(ms: number, fn: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ now: Date.now() + ms, toFake: ['Date'] })
    try {
        return await fn()
    } finally {
        vi.useRealTimers()
    }
}

describe('syncLibrary', () => {
    /** Carol, a teammate of Alice's. */
    async function withTeammate() {
        const { asAlice, asBob, t } = await setup()
        const asCarol = t.withIdentity({ subject: 'user_carol', email: 'carol@church-a.org', tokenIdentifier: 'clerk|user_carol' })
        await asCarol.mutation(api.users.upsertUser, { fullname: 'Carol' })
        await t.run(async (ctx) => {
            const alice = await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', 'alice@church-a.org')).unique()
            const carol = await ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', 'carol@church-a.org')).unique()
            await ctx.db.patch(carol!._id, { churchId: alice!.churchId })
        })
        return { asAlice, asBob, asCarol }
    }

    it('sends the whole library to a device with no copy yet', async () => {
        const { asAlice } = await setup()
        await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_1', 'First'), song('local_2', 'Second')] })
        const result = await asAlice.query(api.songs.syncLibrary, {})
        expect(result?.kind).toBe('full')
        expect(result?.kind === 'full' && result.songs.map((s) => s.title).sort()).toEqual(['First', 'Second'])
    })

    it('sends no songs when nothing changed', async () => {
        const { asAlice } = await setup()
        await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_1', 'First')] })
        const first = await asAlice.query(api.songs.syncLibrary, {})
        const again = await asAlice.query(api.songs.syncLibrary, { cursor: first!.cursor })
        expect(again).toEqual({ kind: 'unchanged', cursor: first!.cursor })
    })

    it("sends only what changed: a teammate's new song and edit", async () => {
        const { asAlice, asCarol } = await withTeammate()
        const HOUR = 60 * 60 * 1000
        await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_1', 'Untouched')] })
        const [{ serverId }] = await later(HOUR, () => asAlice.mutation(api.songs.syncSongs, { songs: [song('local_2', 'Hymn')] }))
        const { cursor } = (await asCarol.query(api.songs.syncLibrary, {}))!

        await later(2 * HOUR, async () => {
            await asCarol.mutation(api.songs.updateSong, { songId: serverId, updates: { lyrics: 'new words' } })
            await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_3', 'Brand New')] })
        })

        const result = await asCarol.query(api.songs.syncLibrary, { cursor })
        expect(result?.kind).toBe('changes')
        expect(result?.kind === 'changes' && result.songs.map((s) => s.title).sort()).toEqual(['Brand New', 'Hymn'])
        expect(result?.cursor.church).toBeGreaterThan(cursor.church)
    })

    it('sends the whole library again after a delete', async () => {
        const { asAlice, asCarol } = await withTeammate()
        const [{ serverId }] = await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_1', 'Gone')] })
        await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_2', 'Kept')] })
        const { cursor } = (await asCarol.query(api.songs.syncLibrary, {}))!

        await asAlice.mutation(api.songs.deleteSong, { songId: serverId })

        const result = await asCarol.query(api.songs.syncLibrary, { cursor })
        expect(result?.kind).toBe('full')
        expect(result?.kind === 'full' && result.songs.map((s) => s.title)).toEqual(['Kept'])
    })

    it("tracks the songs a user made before they belonged to a church", async () => {
        const t = convexTest(schema, modules)
        const asDan = t.withIdentity({ subject: 'user_dan', email: 'dan@example.org', tokenIdentifier: 'clerk|user_dan' })
        await asDan.mutation(api.users.upsertUser, { fullname: 'Dan' })
        const { cursor } = (await asDan.query(api.songs.syncLibrary, {}))!
        await asDan.mutation(api.songs.createSong, { title: 'Mine', artist: 'Dan', lyrics: 'la' })

        const result = await asDan.query(api.songs.syncLibrary, { cursor })
        // No counter existed when the device last looked: the whole library.
        expect(result?.kind === 'full' && result.songs.map((s) => s.title)).toEqual(['Mine'])

        await asDan.mutation(api.songs.createSong, { title: 'Another', artist: 'Dan', lyrics: 'la' })
        const next = await asDan.query(api.songs.syncLibrary, { cursor: result!.cursor })
        expect(next?.kind).toBe('changes')
        expect(next?.kind === 'changes' && next.songs.map((s) => s.title)).toContain('Another')
    })

    it("doesn't see another church's changes, and starts over when the church changes", async () => {
        const { asAlice, asBob } = await setup()
        await asAlice.mutation(api.songs.syncSongs, { songs: [song('local_1', 'Alice song')] })
        const { cursor } = (await asAlice.query(api.songs.syncLibrary, {}))!

        await asBob.mutation(api.songs.syncSongs, { songs: [song('local_1', 'Bob song')] })
        expect((await asAlice.query(api.songs.syncLibrary, { cursor }))?.kind).toBe('unchanged')

        const moved = await asAlice.query(api.songs.syncLibrary, { cursor: { ...cursor, scope: 'someone:else' } })
        expect(moved?.kind).toBe('full')
    })

    it('asks nothing of a signed-out caller', async () => {
        const t = convexTest(schema, modules)
        expect(await t.query(api.songs.syncLibrary, {})).toBeNull()
    })
})
