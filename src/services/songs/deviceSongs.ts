/**
 * The songs kept on this device (IndexedDB), loaded once and shared by every
 * `useSongs()` instance, and the library they make with the server's list.
 *
 * Each instance used to read every song from IndexedDB when it mounted, and
 * the server list is mirrored there, so opening the songs panel (two
 * instances) read the whole library, lyrics and all, twice. Each instance then
 * merged its own copy of the list, so nothing built from it (the search index
 * above all) could be reused from one opening to the next.
 */
import { getIndexedDB } from '../../hooks/useIndexedDB'
import type { Song } from '../../types'
import { getServerSongs, shadowedServerIds } from './serverSongs'

// Fired whenever the device's songs change, so everything holding a copy
// (this store, the auto-detect index, the sync) catches up.
const songsChangeTarget = new EventTarget()

export function notifySongsChanged(): void {
    songsChangeTarget.dispatchEvent(new Event('songs-changed'))
}

/**
 * Subscribe to the same signal from outside a `useSongs()` instance. Returns an
 * unsubscribe function.
 *
 * Non-component consumers need this too: `useSongAutoDetect` keeps a
 * module-scoped search index built once per session, which silently went stale
 * on any library mutation — a song imported or edited mid-service could not be
 * auto-detected for the rest of that session.
 */
export function subscribeSongsChanged(listener: () => void): () => void {
    songsChangeTarget.addEventListener('songs-changed', listener)
    return () => songsChangeTarget.removeEventListener('songs-changed', listener)
}

let songs: Song[] | undefined
let inFlight: Promise<Song[]> | null = null
/** A reload asked for while one was running: run once more after it. */
let again = false
/** Set while this store announces its own change, so it doesn't reload for it. */
let announcing = false
const listeners = new Set<() => void>()

subscribeSongsChanged(() => {
    if (!announcing) void loadDeviceSongs()
})

export function subscribeDeviceSongs(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/** Undefined until first loaded. */
export function getDeviceSongs(): Song[] | undefined {
    return songs
}

/** Read the device's songs now; callers during a read share it. */
export function loadDeviceSongs(): Promise<Song[]> {
    if (inFlight) {
        again = true
        return inFlight
    }
    inFlight = (async () => {
        try {
            do {
                again = false
                const rows = await getIndexedDB().library.where('type').equals('song').toArray()
                songs = rows.map((row) => row.content as Song)
            } while (again)
            for (const l of listeners) l()
        } catch (err) {
            console.warn('[deviceSongs] Failed to load local songs:', err)
        } finally {
            inFlight = null
        }
        return songs ?? []
    })()
    return inFlight
}

/** After a change this device made: reload, then tell everyone else. */
export async function reloadDeviceSongs(): Promise<void> {
    await loadDeviceSongs()
    announcing = true
    try {
        notifySongsChanged()
    } finally {
        announcing = false
    }
}

const NONE: Song[] = []
let merged: { server: Song[] | undefined; device: Song[] | undefined; songs: Song[] } | null = null

/**
 * The library: the server's songs and this device's, each song once (the more
 * recently updated copy). The same array until either list changes, so what's
 * built from it can be kept.
 */
export function getLibrarySongs(): Song[] {
    const server = getServerSongs()
    const device = songs
    if (merged && merged.server === server && merged.device === device) return merged.songs
    merged = { server, device, songs: mergeSongs(server ?? NONE, device ?? NONE) }
    return merged.songs
}

function mergeSongs(server: Song[], device: Song[]): Song[] {
    // A server song this device keeps its own copy of shows once, as that copy.
    const shadowed = shadowedServerIds(device)
    const serverList = server.filter((s) => !shadowed.has(s._id || s.id))
    if (device.length === 0) return serverList
    const map = new Map<string, Song>()
    for (const s of serverList) {
        const k = s._id || s.id
        if (!k) continue
        map.set(k, s)
    }
    for (const s of device) {
        const k = s._id || s.id
        if (!k) continue
        const existing = map.get(k)
        // Prefer whichever was updated more recently
        if (!existing || new Date(s.updatedAt || 0).getTime() > new Date(existing.updatedAt || 0).getTime()) {
            map.set(k, s)
        }
    }
    return Array.from(map.values())
}

/** For tests. */
export function resetDeviceSongs(): void {
    songs = undefined
    inFlight = null
    again = false
    merged = null
}
