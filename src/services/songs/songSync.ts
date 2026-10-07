/**
 * Upload songs saved on this device to the church's library on the server.
 *
 * Importing writes only to this device (IndexedDB), marking each song
 * `syncState: 'pending'`. Whenever the app is online and signed in, pending
 * songs go up in batches through `songs.syncSongs`: a few calls for a whole
 * library instead of one per song. That keeps imports instant and offline-safe
 * and spares the server, while teammates still get every song.
 *
 * Linking, not re-keying: a device song keeps its own id (`local_…`, `ew_…`)
 * and records the server song it went to as `serverId`. Service orders and
 * slides that reference the song by id keep working, and the server copy is
 * hidden from this device's list in favour of its own (see `serverSongs.ts`).
 *
 * A pending song with no server link is matched to a server song of the same
 * title before it is uploaded, so re-importing a library that is already on
 * the server updates those songs instead of adding a second copy of each.
 */
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { getIndexedDB } from '../../hooks/useIndexedDB'
import { notifySongsChanged } from '../../hooks/useSongs'
import type { Song } from '../../types'
import { getServerSongs, refreshServerSongs } from './serverSongs'

/** Songs per `syncSongs` call; the server refuses more than 50. */
export const SYNC_BATCH = 50

export interface SongSyncStatus {
    pending: number
    syncing: boolean
    lastSyncedAt: number | null
    lastError: string | null
}

let status: SongSyncStatus = { pending: 0, syncing: false, lastSyncedAt: null, lastError: null }
const listeners = new Set<() => void>()

function setStatus(next: Partial<SongSyncStatus>): void {
    status = { ...status, ...next }
    for (const l of listeners) l()
}

export function subscribeSongSync(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getSongSyncStatus(): SongSyncStatus {
    return status
}

const requestTarget = new EventTarget()

/** Ask the mounted sync hook to sync now (e.g. a "Sync now" button). */
export function requestSongSync(): void {
    requestTarget.dispatchEvent(new Event('sync'))
}

export function subscribeSyncRequests(listener: () => void): () => void {
    requestTarget.addEventListener('sync', listener)
    return () => requestTarget.removeEventListener('sync', listener)
}

/** Ids this device creates itself; anything else came from the server. */
export function isDeviceId(id: string): boolean {
    return id.startsWith('local_') || id.startsWith('ew_')
}

function normalTitle(title: string): string {
    return title.toLowerCase().replace(/\s+/g, ' ').trim()
}

interface Row {
    id: string
    type: string
    content: Song
    createdAt: string
    updatedAt: string
}

async function songRows(): Promise<Row[]> {
    return (await getIndexedDB().library.where('type').equals('song').toArray()) as Row[]
}

/**
 * Mark for upload the songs created on this device before syncing existed:
 * `local_` songs whose server create failed (offline) were kept with no way
 * back to the server. Songs seeded from the old bundled library (`ew_`) are
 * left alone; they sync once someone imports or edits them.
 */
export async function adoptUnsyncedLocalSongs(): Promise<number> {
    try {
        const stray = (await songRows()).filter(
            (r) => r.id.startsWith('local_') && !r.content.serverId && !r.content.syncState,
        )
        if (stray.length > 0) {
            await getIndexedDB().library.bulkPut(
                stray.map((r) => ({ ...r, content: { ...r.content, syncState: 'pending' as const } })),
            )
        }
        return stray.length
    } catch {
        return 0
    }
}

export async function refreshPendingCount(): Promise<number> {
    try {
        const pending = (await songRows()).filter((r) => r.content?.syncState === 'pending').length
        setStatus({ pending })
        return pending
    } catch {
        return status.pending
    }
}

/**
 * Where each pending row should go on the server: the server song it is
 * linked to, the server row it is, or one matched by title that no other song
 * on this device already claims. Undefined means "create a new song".
 */
export function planServerTargets(rows: Row[], serverSongs: Song[]): Map<string, string | undefined> {
    const claimed = new Set<string>()
    for (const r of rows) if (r.content.serverId) claimed.add(r.content.serverId)

    const byTitle = new Map<string, string>()
    for (const s of serverSongs) {
        const id = s._id || s.id
        const key = normalTitle(s.title || '')
        if (id && key && !byTitle.has(key)) byTitle.set(key, id)
    }

    const plan = new Map<string, string | undefined>()
    for (const r of rows) {
        if (r.content.syncState !== 'pending') continue
        if (r.content.serverId) {
            plan.set(r.id, r.content.serverId)
        } else if (!isDeviceId(r.id)) {
            plan.set(r.id, r.id)
        } else {
            const match = byTitle.get(normalTitle(r.content.title || ''))
            if (match && !claimed.has(match)) {
                claimed.add(match)
                plan.set(r.id, match)
            } else {
                plan.set(r.id, undefined)
            }
        }
    }
    return plan
}

function toUpload(row: Row, serverId: string | undefined) {
    const s = row.content
    const lyrics = s.lyrics || (s.sections ?? []).map((x) => x.lines.join('\n')).join('\n\n')
    return {
        clientId: row.id,
        serverId,
        title: s.title || 'Untitled',
        artist: s.artist || s.author || 'Unknown',
        lyrics,
        author: s.author,
        verses: s.verses,
        sections: s.sections,
        defaultArrangement: s.defaultArrangement,
    }
}

let running: Promise<void> | null = null

/** Upload every pending song. Single-flight: concurrent calls share one run. */
export function syncPendingSongs(convex: ConvexReactClient): Promise<void> {
    if (running) return running
    running = (async () => {
        setStatus({ syncing: true, lastError: null })
        try {
            const serverSongs = getServerSongs() ?? (await refreshServerSongs(convex)) ?? []
            const rows = await songRows()
            const pending = rows.filter((r) => r.content?.syncState === 'pending')
            if (pending.length === 0) {
                setStatus({ pending: 0 })
                return
            }
            const plan = planServerTargets(rows, serverSongs)
            const db = getIndexedDB()

            for (let i = 0; i < pending.length; i += SYNC_BATCH) {
                const batch = pending.slice(i, i + SYNC_BATCH)
                const results = await convex.mutation(api.songs.syncSongs, {
                    songs: batch.map((row) => toUpload(row, plan.get(row.id))),
                })
                const sent = new Map(batch.map((row) => [row.id, row]))
                for (const { clientId, serverId } of results) {
                    const before = sent.get(clientId)
                    if (!before) continue
                    const current = (await db.library.get(clientId)) as Row | undefined
                    // Edited again while uploading: leave it pending for next time.
                    if (!current || current.content.updatedAt !== before.content.updatedAt) continue
                    const linked = clientId === serverId ? {} : { serverId }
                    await db.library.put({
                        ...current,
                        content: { ...current.content, ...linked, syncState: 'synced' },
                    })
                    // The server copy this device song now stands for, mirrored
                    // here by an earlier fetch, would be a second copy of it.
                    if (clientId !== serverId) await db.library.delete(serverId)
                }
                setStatus({ pending: Math.max(0, pending.length - (i + batch.length)) })
            }

            setStatus({ lastSyncedAt: Date.now() })
            await refreshServerSongs(convex)
            notifySongsChanged()
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.warn('[songSync] sync failed; songs stay pending:', err)
            setStatus({ lastError: message })
        } finally {
            await refreshPendingCount()
            setStatus({ syncing: false })
            running = null
        }
    })()
    return running
}
