import { describe, it, expect, beforeEach, vi } from 'vitest'

// A real IndexedDB, installed before Dexie loads (it captures it on import).
await vi.hoisted(async () => {
    const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb')
    const win = globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown }
    win.indexedDB = new IDBFactory()
    win.IDBKeyRange = IDBKeyRange
})
import type { ConvexReactClient } from 'convex/react'
import { getIndexedDB } from '../../../hooks/useIndexedDB'
import { adoptUnsyncedLocalSongs, planServerTargets, syncPendingSongs, getSongSyncStatus } from '../songSync'
import { getServerSongs, refreshServerSongs, resetServerSongs, shadowedServerIds } from '../serverSongs'
import type { Song } from '../../../types'

const T0 = '2026-10-07T10:00:00.000Z'

function row(id: string, title: string, extra: Partial<Song> = {}) {
    const content = { id, _id: id, title, artist: 'Unknown', lyrics: `${title} lyrics`, updatedAt: T0, ...extra } as Song
    return { id, type: 'song', content, createdAt: T0, updatedAt: T0 }
}

/** A fake Convex client: a server song list, and a syncSongs that assigns ids. */
function fakeConvex(serverSongs: Song[]) {
    let next = 1
    const calls: Array<Array<{ clientId: string; serverId?: string; title: string }>> = []
    const client = {
        query: vi.fn(async () => serverSongs),
        mutation: vi.fn(async (_fn: unknown, args: { songs: Array<{ clientId: string; serverId?: string; title: string }> }) => {
            calls.push(args.songs)
            return args.songs.map((s) => ({ clientId: s.clientId, serverId: s.serverId ?? `srv_new_${next++}` }))
        }),
    }
    return { client: client as unknown as ConvexReactClient, calls }
}

describe('planServerTargets', () => {
    const server = [{ _id: 'srv_a', id: 'srv_a', title: 'Amazing  Grace' }, { _id: 'srv_b', id: 'srv_b', title: 'Cornerstone' }] as Song[]

    it('links device songs to server songs by title, once each', () => {
        const plan = planServerTargets([
            row('ew_1', 'amazing grace', { syncState: 'pending' }),
            row('local_2', 'AMAZING GRACE', { syncState: 'pending' }),
            row('local_3', 'New Song', { syncState: 'pending' }),
        ], server)
        // The second copy of a title doesn't claim the same server song.
        expect([plan.get('ew_1'), plan.get('local_2'), plan.get('local_3')]).toEqual(['srv_a', undefined, undefined])
    })

    it('keeps an existing link, and sends a server row to itself', () => {
        const plan = planServerTargets([
            row('ew_1', 'Cornerstone', { syncState: 'pending', serverId: 'srv_x' }),
            row('srv_b', 'Cornerstone', { syncState: 'pending' }),
        ], server)
        expect(plan.get('ew_1')).toBe('srv_x')
        expect(plan.get('srv_b')).toBe('srv_b')
    })

    it("won't link to a server song another device song already stands for", () => {
        const plan = planServerTargets([
            row('ew_1', 'Cornerstone', { syncState: 'synced', serverId: 'srv_b' }),
            row('local_2', 'Cornerstone', { syncState: 'pending' }),
        ], server)
        expect(plan.get('local_2')).toBeUndefined()
    })
})

describe('syncPendingSongs', () => {
    beforeEach(async () => {
        resetServerSongs()
        await getIndexedDB().library.clear()
    })

    it('uploads pending songs in batches of 50 and links each to its server song', async () => {
        const db = getIndexedDB()
        const many = Array.from({ length: 60 }, (_, i) => row(`local_${i}`, `Song ${i}`, { syncState: 'pending' }))
        await db.library.bulkPut([...many, row('ew_untouched', 'Seeded', {})])
        const { client, calls } = fakeConvex([])

        await syncPendingSongs(client)

        expect(calls.map((c) => c.length)).toEqual([50, 10])
        expect(calls.flat().some((s) => s.clientId === 'ew_untouched')).toBe(false)
        const synced = (await db.library.get('local_0'))!.content as Song
        expect(synced.syncState).toBe('synced')
        expect(synced.serverId).toMatch(/^srv_new_/)
        expect(synced.id).toBe('local_0') // the device id stays
        expect(getSongSyncStatus().pending).toBe(0)
    })

    it('updates the server copy of a re-imported song and drops its duplicate from the device', async () => {
        const db = getIndexedDB()
        const serverCopy = { _id: 'srv_a', id: 'srv_a', title: 'Amazing Grace', artist: 'x', lyrics: 'old' } as Song
        await db.library.bulkPut([
            row('ew_1', 'Amazing Grace', { syncState: 'pending', lyrics: 'corrected' }),
            { id: 'srv_a', type: 'song', content: serverCopy, createdAt: T0, updatedAt: T0 },
        ])
        const { client, calls } = fakeConvex([serverCopy])

        await syncPendingSongs(client)

        expect(calls[0]).toEqual([expect.objectContaining({ clientId: 'ew_1', serverId: 'srv_a' })])
        expect(((await db.library.get('ew_1'))!.content as Song).serverId).toBe('srv_a')
        expect(await db.library.get('srv_a')).toBeUndefined()
    })

    it('leaves a song pending when it changed while uploading', async () => {
        const db = getIndexedDB()
        await db.library.put(row('local_1', 'Draft', { syncState: 'pending' }))
        const { client } = fakeConvex([])
        ;(client.mutation as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_fn, args) => {
            await db.library.put(row('local_1', 'Draft v2', { syncState: 'pending', updatedAt: '2026-10-07T10:00:05.000Z' }))
            return args.songs.map((s: { clientId: string }) => ({ clientId: s.clientId, serverId: 'srv_1' }))
        })

        await syncPendingSongs(client)

        expect(((await db.library.get('local_1'))!.content as Song).syncState).toBe('pending')
    })

    it('keeps songs pending and reports the error when the server refuses', async () => {
        const db = getIndexedDB()
        await db.library.put(row('local_1', 'Hymn', { syncState: 'pending' }))
        const { client } = fakeConvex([])
        ;(client.mutation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'))

        await syncPendingSongs(client)

        expect(((await db.library.get('local_1'))!.content as Song).syncState).toBe('pending')
        expect(getSongSyncStatus()).toMatchObject({ pending: 1, syncing: false, lastError: 'offline' })
    })
})

describe('adoptUnsyncedLocalSongs', () => {
    beforeEach(async () => {
        await getIndexedDB().library.clear()
    })

    it('queues songs created offline before syncing existed, and nothing else', async () => {
        const db = getIndexedDB()
        await db.library.bulkPut([
            row('local_song_old', 'Offline song'),
            row('ew_1', 'Seeded'),
            row('local_song_linked', 'Linked', { serverId: 'srv_1' }),
            row('srv_2', 'Server song'),
        ])
        expect(await adoptUnsyncedLocalSongs()).toBe(1)
        const pending = (await db.library.toArray()).filter((r) => (r.content as Song).syncState === 'pending').map((r) => r.id)
        expect(pending).toEqual(['local_song_old'])
    })
})

describe('server song list', () => {
    beforeEach(async () => {
        resetServerSongs()
        await getIndexedDB().library.clear()
    })

    it("doesn't mirror the server copy of a song this device keeps", async () => {
        const db = getIndexedDB()
        await db.library.put(row('ew_1', 'Amazing Grace', { syncState: 'synced', serverId: 'srv_a' }))
        const { client } = fakeConvex([
            { _id: 'srv_a', id: 'srv_a', title: 'Amazing Grace' } as Song,
            { _id: 'srv_b', id: 'srv_b', title: 'Cornerstone' } as Song,
        ])

        await refreshServerSongs(client)

        expect(getServerSongs()).toHaveLength(2)
        expect((await db.library.toArray()).map((r) => r.id).sort()).toEqual(['ew_1', 'srv_b'])
    })

    it('shares one request between concurrent callers', async () => {
        const { client } = fakeConvex([])
        await Promise.all([refreshServerSongs(client), refreshServerSongs(client), refreshServerSongs(client)])
        expect(client.query).toHaveBeenCalledTimes(1)
    })

    it('treats pending server-id rows as shadowing their server copy', () => {
        const ids = shadowedServerIds([
            { id: 'srv_a', _id: 'srv_a', syncState: 'pending' } as Song,
            { id: 'ew_1', serverId: 'srv_b' } as Song,
            { id: 'srv_c', _id: 'srv_c' } as Song,
        ])
        expect([...ids].sort()).toEqual(['srv_a', 'srv_b'])
    })
})
