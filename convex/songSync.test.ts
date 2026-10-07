/// <reference types="vite/client" />
/**
 * syncSongs: uploading songs saved on a device, in batches.
 */
import { convexTest } from 'convex-test'
import { describe, it, expect } from 'vitest'
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
    return { asAlice, asBob }
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
