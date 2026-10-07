/**
 * The church's songs as the server has them, fetched on demand and shared by
 * every `useSongs()` instance.
 *
 * This replaced a live subscription to the whole song list. Every write to a
 * song made Convex re-run that query and re-send up to a thousand songs, lyrics
 * and all, so importing a few hundred songs one at a time re-sent the library
 * hundreds of times. The list is now fetched when it is first needed, after
 * a sync, when the connection comes back, and when the window regains focus
 * after a while. That is fresh enough to see teammates' songs without paying
 * for every keystroke of everyone's edits.
 *
 * Each fetch is also mirrored into IndexedDB so the library works offline,
 * except songs this device holds its own copy of (see `songSync.ts`). That
 * mirroring used to write the server copy too, and the library ended up with
 * the same song twice.
 */
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { getIndexedDB } from '../../hooks/useIndexedDB'
import type { Song } from '../../types'

/** Most songs fetched; the server caps the query at this. */
const FETCH_LIMIT = 5000
/** Refetch on focus only if the list is older than this. */
export const STALE_AFTER_MS = 10 * 60 * 1000

let songs: Song[] | undefined
let fetchedAt = 0
let inFlight: Promise<Song[] | undefined> | null = null
const listeners = new Set<() => void>()

export function subscribeServerSongs(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getServerSongs(): Song[] | undefined {
    return songs
}

export function serverSongsAge(now = Date.now()): number {
    return fetchedAt === 0 ? Infinity : now - fetchedAt
}

/** Fetch the list now; concurrent callers share one request. */
export function refreshServerSongs(convex: ConvexReactClient): Promise<Song[] | undefined> {
    if (inFlight) return inFlight
    inFlight = (async () => {
        try {
            const fetched = (await convex.query(api.songs.searchSongs, { limit: FETCH_LIMIT })) as Song[]
            songs = fetched
            fetchedAt = Date.now()
            await mirrorToDevice(fetched)
            for (const l of listeners) l()
            return fetched
        } catch (err) {
            console.warn('[serverSongs] fetch failed, keeping the last list:', err)
            return songs
        } finally {
            inFlight = null
        }
    })()
    return inFlight
}

/**
 * Song ids the server list must not stand in for on this device: the server
 * copies of songs this device keeps itself (their `serverId`), and server-id
 * rows carrying changes not yet uploaded.
 */
export function shadowedServerIds(localSongs: Song[]): Set<string> {
    const ids = new Set<string>()
    for (const s of localSongs) {
        if (s.serverId) ids.add(s.serverId)
        const id = s._id || s.id
        if (s.syncState === 'pending' && id) ids.add(id)
    }
    return ids
}

async function mirrorToDevice(fetched: Song[]): Promise<void> {
    try {
        const db = getIndexedDB()
        const local = (await db.library.where('type').equals('song').toArray()).map((row) => row.content as Song)
        const shadowed = shadowedServerIds(local)
        const now = new Date().toISOString()
        const rows = fetched
            .filter((song) => !shadowed.has(song._id || song.id))
            .map((song) => ({
                id: song._id || song.id,
                type: 'song',
                content: song,
                createdAt: song.createdAt || now,
                updatedAt: now,
            }))
        if (rows.length > 0) await db.library.bulkPut(rows)
    } catch (err) {
        console.warn('[serverSongs] could not mirror songs to this device:', err)
    }
}

/** For tests. */
export function resetServerSongs(): void {
    songs = undefined
    fetchedAt = 0
    inFlight = null
}
