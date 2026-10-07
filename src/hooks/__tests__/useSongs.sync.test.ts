import { describe, it, expect, beforeEach, vi } from 'vitest'

// A real IndexedDB, installed before Dexie loads (it captures it on import).
await vi.hoisted(async () => {
    const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb')
    const win = globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown }
    win.indexedDB = new IDBFactory()
    win.IDBKeyRange = IDBKeyRange
})

const deleteSongMutation = vi.fn(async () => true)
vi.mock('convex/react', () => ({ useMutation: () => deleteSongMutation }))
vi.mock('../../providers/ConvexConnectionProvider', () => ({ useConvexConnection: () => ({ isOffline: false }) }))

import { renderHook, act, waitFor } from '@testing-library/react'
import type { ConvexReactClient } from 'convex/react'
import { useSongs } from '../useSongs'
import { getIndexedDB } from '../useIndexedDB'
import { refreshServerSongs, resetServerSongs } from '../../services/songs/serverSongs'
import type { Song } from '../../types'

const T0 = '2026-10-07T10:00:00.000Z'

async function serverHas(songs: Song[]) {
    const client = { query: vi.fn(async () => songs) } as unknown as ConvexReactClient
    await act(async () => { await refreshServerSongs(client) })
}

describe('useSongs with device and server libraries', () => {
    beforeEach(async () => {
        resetServerSongs()
        deleteSongMutation.mockClear()
        await getIndexedDB().library.clear()
    })

    it('imports to the device only, marking songs for upload', async () => {
        const { result } = renderHook(() => useSongs())
        await act(async () => {
            await result.current.importSongs([
                { data: { title: 'New Song', artist: 'x', lyrics: 'la' } },
            ])
        })
        const rows = await getIndexedDB().library.toArray()
        expect(rows).toHaveLength(1)
        expect(rows[0].id).toMatch(/^local_song_/)
        expect((rows[0].content as Song).syncState).toBe('pending')
        expect(deleteSongMutation).not.toHaveBeenCalled()
    })

    it('replaces a song in place, keeping its id', async () => {
        await getIndexedDB().library.put({
            id: 'ew_1', type: 'song', createdAt: T0, updatedAt: T0,
            content: { id: 'ew_1', _id: 'ew_1', title: 'Hymn', artist: 'x', lyrics: 'are the days' } as Song,
        })
        const { result } = renderHook(() => useSongs())
        await act(async () => {
            await result.current.importSongs([{ replaceId: 'ew_1', data: { lyrics: 'These are the days' } }])
        })
        const content = (await getIndexedDB().library.get('ew_1'))!.content as Song
        expect(content).toMatchObject({ id: 'ew_1', title: 'Hymn', lyrics: 'These are the days', syncState: 'pending' })
    })

    it('lists a song once when the device keeps its own copy of a server song', async () => {
        await getIndexedDB().library.put({
            id: 'ew_1', type: 'song', createdAt: T0, updatedAt: T0,
            content: { id: 'ew_1', _id: 'ew_1', title: 'Amazing Grace', artist: 'x', lyrics: 'fixed', serverId: 'srv_a', syncState: 'synced' } as Song,
        })
        const { result } = renderHook(() => useSongs())
        await serverHas([
            { _id: 'srv_a', id: 'srv_a', title: 'Amazing Grace', artist: 'x', lyrics: 'old' } as Song,
            { _id: 'srv_b', id: 'srv_b', title: 'Cornerstone', artist: 'x', lyrics: 'hope' } as Song,
        ])
        await waitFor(() => expect(result.current.songs.map((s) => s._id).sort()).toEqual(['ew_1', 'srv_b']))
    })

    it('deletes the server copy along with a linked device song', async () => {
        await getIndexedDB().library.put({
            id: 'ew_1', type: 'song', createdAt: T0, updatedAt: T0,
            content: { id: 'ew_1', _id: 'ew_1', title: 'Hymn', artist: 'x', lyrics: 'la', serverId: 'srv_a' } as Song,
        })
        const { result } = renderHook(() => useSongs())
        await act(async () => { await result.current.deleteSong('ew_1') })
        expect(deleteSongMutation).toHaveBeenCalledWith({ songId: 'srv_a' })
        expect(await getIndexedDB().library.get('ew_1')).toBeUndefined()
    })
})
