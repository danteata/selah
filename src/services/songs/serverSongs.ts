/**
 * The church's songs as the server has them, fetched on demand and shared by
 * every `useSongs()` instance.
 *
 * This replaced a live subscription to the whole song list. Every write to a
 * song made Convex re-run that query and re-send up to a thousand songs, lyrics
 * and all, so importing a few hundred songs one at a time re-sent the library
 * hundreds of times. The list is now brought up to date when it is first
 * needed, after a sync, when the connection comes back, and when the window
 * regains focus after a while.
 *
 * Bringing it up to date no longer means downloading it. The fetch that
 * replaced the subscription still sent every song on every refresh, and that
 * one query was most of the deployment's database reads. Now the device keeps
 * the list from its last sync, with the cursor `songs.syncLibrary` handed back,
 * and asks only what changed since: usually nothing, sometimes a few songs,
 * and the whole library only after a delete or a change of church.
 *
 * Each fetch is also mirrored into IndexedDB's song library so it works
 * offline, except songs this device holds its own copy of (see `songSync.ts`).
 * That mirroring used to write the server copy too, and the library ended up
 * with the same song twice.
 */
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { getIndexedDB, type SongLibraryCursor } from '../../hooks/useIndexedDB'
import type { Song } from '../../types'

/** Most songs fetched; the server caps the query at this. */
const FETCH_LIMIT = 5000
/** Refetch on focus only if the list is older than this. */
export const STALE_AFTER_MS = 10 * 60 * 1000

type LibraryUpdate =
    | { kind: 'unchanged'; cursor?: SongLibraryCursor }
    | { kind: 'changes' | 'full'; songs: Song[]; cursor?: SongLibraryCursor }

let songs: Song[] | undefined
let cursor: SongLibraryCursor | undefined
let fetchedAt = 0
let inFlight: Promise<Song[] | undefined> | null = null
let restoring: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify(): void {
    for (const l of listeners) l()
}

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

/** Ids this device creates itself; anything else came from the server. */
export function isDeviceId(id: string): boolean {
    return id.startsWith('local_') || id.startsWith('ew_')
}

/**
 * Load the list kept from the last sync, once per session, so the library is
 * there at once (online or not) and the next sync can ask only what changed.
 */
export function restoreServerSongs(): Promise<void> {
    if (!restoring) {
        restoring = (async () => {
            try {
                const saved = await getIndexedDB().serverSongLibrary.get('current')
                // A fetch that finished first is newer than what was saved.
                if (!saved || songs !== undefined) return
                songs = saved.songs
                cursor = saved.cursor
                notify()
            } catch (err) {
                console.warn('[serverSongs] could not load the saved song list:', err)
            }
        })()
    }
    return restoring
}

function isMissingFunction(err: unknown): boolean {
    return err instanceof Error && /Could not find public function/i.test(err.message)
}

async function fetchUpdate(convex: ConvexReactClient): Promise<LibraryUpdate | null> {
    try {
        return (await convex.query(api.songs.syncLibrary, { cursor })) as LibraryUpdate | null
    } catch (err) {
        if (!isMissingFunction(err)) throw err
        // A deployment from before syncLibrary: the whole list, as before.
        const all = (await convex.query(api.songs.searchSongs, { limit: FETCH_LIMIT })) as Song[]
        return { kind: 'full', songs: all }
    }
}

/** `base` with `changed` laid over it, each song once. */
function applyChanges(base: Song[], changed: Song[]): Song[] {
    const byId = new Map(base.map((s) => [s._id || s.id, s]))
    for (const s of changed) byId.set(s._id || s.id, s)
    return Array.from(byId.values())
}

/** Bring the list up to date now; concurrent callers share one request. */
export function refreshServerSongs(convex: ConvexReactClient): Promise<Song[] | undefined> {
    if (inFlight) return inFlight
    inFlight = (async () => {
        try {
            await restoreServerSongs()
            const update = await fetchUpdate(convex)
            // Signed out: keep what we have.
            if (!update) return songs
            fetchedAt = Date.now()
            if (update.kind === 'unchanged') return songs

            const next = update.kind === 'changes' ? applyChanges(songs ?? [], update.songs) : update.songs
            songs = next
            cursor = update.cursor
            await saveForNextTime(next, update.cursor)
            await mirrorToDevice(update.songs, update.kind === 'full' ? next : undefined)
            notify()
            return next
        } catch (err) {
            console.warn('[serverSongs] fetch failed, keeping the last list:', err)
            return songs
        } finally {
            inFlight = null
        }
    })()
    return inFlight
}

async function saveForNextTime(list: Song[], at: SongLibraryCursor | undefined): Promise<void> {
    try {
        const table = getIndexedDB().serverSongLibrary
        // No cursor (an older deployment): nothing to catch up from next time.
        if (!at) await table.delete('current')
        else await table.put({ id: 'current', cursor: at, songs: list, savedAt: new Date().toISOString() })
    } catch (err) {
        console.warn('[serverSongs] could not save the song list:', err)
    }
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

/**
 * A row that is the server's song as last fetched (or as this device last
 * uploaded it), not one only this device has: songs made here, seeded, or
 * looked up online have no server `_creationTime`, and unsent edits stay.
 */
function isServerCopy(id: string, song: Song & { _creationTime?: number }): boolean {
    return !isDeviceId(id) && typeof song._creationTime === 'number' && song.syncState !== 'pending'
}

/**
 * Write fetched songs to the device's library. Given the whole server list
 * (`complete`), also drop mirrored songs the server no longer has: deleted
 * songs used to stay on every device that had ever fetched them.
 */
async function mirrorToDevice(fetched: Song[], complete?: Song[]): Promise<void> {
    try {
        const db = getIndexedDB()
        const localRows = await db.library.where('type').equals('song').toArray()
        const shadowed = shadowedServerIds(localRows.map((row) => row.content as Song))
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

        // Only a list short of the cap is known to be all of it.
        if (complete && complete.length < FETCH_LIMIT) {
            const onServer = new Set(complete.map((s) => s._id || s.id))
            const gone = localRows
                .filter((row) => isServerCopy(row.id, row.content as Song) && !onServer.has(row.id))
                .map((row) => row.id)
            if (gone.length > 0) await db.library.bulkDelete(gone)
        }
    } catch (err) {
        console.warn('[serverSongs] could not mirror songs to this device:', err)
    }
}

/** For tests. */
export function resetServerSongs(): void {
    songs = undefined
    cursor = undefined
    fetchedAt = 0
    inFlight = null
    restoring = null
}
