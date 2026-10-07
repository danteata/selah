import { useState, useCallback, useMemo, useEffect, useSyncExternalStore } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAppStore } from '../store/appStore'
import type { Song } from '../types'
import { getIndexedDB } from './useIndexedDB'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { getServerSongs, shadowedServerIds, subscribeServerSongs } from '../services/songs/serverSongs'

// Per-call timeout for Convex mutations. If the websocket dies, useMutation
// promises can hang indefinitely — bounded timeout lets the wizard move on
// instead of freezing the whole batch on a single bad song.
const MUTATION_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${ms}ms`)),
            ms,
        )
        promise.then(
            (v) => { clearTimeout(timer); resolve(v) },
            (e) => { clearTimeout(timer); reject(e) },
        )
    })
}

// Cross-instance refresh signal — fired whenever any useSongs() instance mutates
// IndexedDB so every other instance (Songs panel, MusicBrowser, etc.) reloads.
const songsChangeTarget = new EventTarget()
export const notifySongsChanged = () => songsChangeTarget.dispatchEvent(new Event('songs-changed'))

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

export interface UseSongsReturn {
    songs: Song[]
    loading: boolean
    searchSongs: (query: string, limit?: number) => Song[]
    getAllSongs: () => Song[]
    getSongById: (songId: string) => Song | null
    createSong: (songData: Partial<Song>, isPublic?: boolean) => Promise<Song | null>
    /** Save many songs on this device in one write; they sync in the background. */
    importSongs: (items: ImportedSong[]) => Promise<{ created: number; updated: number }>
    updateSong: (songId: string, updateData: Partial<Song>) => Promise<Song | null>
    deleteSong: (songId: string) => Promise<boolean>
    parseSongLyrics: (lyrics: string, linesPerVerse?: number) => string[]
    isOfflineData: boolean
}

/** A song to import: new, or replacing the song with id `replaceId`. */
export interface ImportedSong {
    data: Partial<Song>
    replaceId?: string
}

/** A row for the device library, marked for upload. */
function pendingRow(id: string, song: Song, createdAt: string) {
    const now = new Date().toISOString()
    return {
        id,
        type: 'song',
        content: { ...song, id, _id: id, updatedAt: now, syncState: 'pending' as const },
        createdAt,
        updatedAt: now,
    }
}

function newLocalId(): string {
    return `local_song_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function useSongs(): UseSongsReturn {
    const [loading, setLoading] = useState(false)
    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const churchId = activeSchedule?.churchId || ''
    const { isOffline } = useConvexConnection()
    const [localSongs, setLocalSongs] = useState<Song[]>([])

    const deleteSongMutation = useMutation(api.songs.deleteSong)

    // The server's list, fetched and refreshed by useSongLibrarySync and shared
    // by every instance (see serverSongs.ts). Undefined until first fetched.
    const allSongsQuery = useSyncExternalStore(subscribeServerSongs, getServerSongs)

    // Always load local IndexedDB songs and merge with server results so that
    // imported / locally-created songs (e.g. from EasyWorship import in offline
    // mode) always show up in the Songs panel, regardless of connection state.
    const loadLocalSongs = useCallback(async () => {
        try {
            const db = getIndexedDB()
            const localItems = await db.library
                .where('type')
                .equals('song')
                .toArray()
            setLocalSongs(localItems.map(item => item.content as Song))
        } catch (err) {
            console.warn('[useSongs] Failed to load local songs:', err)
        }
    }, [])

    useEffect(() => {
        loadLocalSongs()
        const onChange = () => { void loadLocalSongs() }
        songsChangeTarget.addEventListener('songs-changed', onChange)
        return () => songsChangeTarget.removeEventListener('songs-changed', onChange)
    }, [loadLocalSongs])

    const isOfflineData = isOffline && (allSongsQuery === undefined || allSongsQuery === null)

    // Merge local + server, deduplicating by id (prefer most-recently-updated copy).
    const effectiveSongs = useMemo(() => {
        // A server song this device keeps its own copy of shows once, as that copy.
        const shadowed = shadowedServerIds(localSongs)
        const serverList = ((allSongsQuery || []) as Song[]).filter((s) => !shadowed.has(s._id || s.id))
        if (localSongs.length === 0) return serverList
        const map = new Map<string, Song>()
        for (const s of serverList) {
            const k = s._id || s.id
            if (!k) continue
            map.set(k, s)
        }
        for (const s of localSongs) {
            const k = s._id || s.id
            if (!k) continue
            const existing = map.get(k)
            if (!existing) {
                map.set(k, s)
            } else {
                // Prefer whichever was updated more recently
                const localTime = new Date(s.updatedAt || 0).getTime()
                const serverTime = new Date(existing.updatedAt || 0).getTime()
                if (localTime > serverTime) {
                    map.set(k, s)
                }
            }
        }
        return Array.from(map.values())
    }, [allSongsQuery, localSongs])

    const searchSongs = useCallback((query: string = '', limit: number = 20): Song[] => {
        if (!query.trim()) {
            return effectiveSongs.slice(0, limit) as Song[]
        }

        const q = query.toLowerCase()
        const filtered = effectiveSongs.filter((song: Song) =>
            song.title.toLowerCase().includes(q) ||
            song.artist.toLowerCase().includes(q) ||
            (song.lyrics || '').toLowerCase().includes(q)
        )

        return filtered.slice(0, limit) as Song[]
    }, [effectiveSongs])

    const getAllSongs = useCallback((): Song[] => {
        return effectiveSongs as Song[]
    }, [effectiveSongs])

    const getSongById = useCallback((songId: string): Song | null => {
        const song = effectiveSongs.find((s: Song) => s._id === songId || s.id === songId)
        return song || null
    }, [effectiveSongs])

    // Creating, editing and importing all save to this device and mark the
    // song for upload; useSongLibrarySync sends what is pending a few seconds
    // later, in batches (songSync.ts). Offline edits used to stay on the device
    // for good, and each online edit cost a server write that made every
    // device re-download the whole song list.
    const createSong = useCallback(async (
        songData: Partial<Song>,
        isPublic: boolean = false
    ): Promise<Song | null> => {
        try {
            setLoading(true)

            if (!songData.title || !songData.artist || !songData.lyrics) {
                throw new Error('Title, artist, and lyrics are required')
            }

            const id = newLocalId()
            const now = new Date().toISOString()
            const row = pendingRow(id, {
                id,
                title: songData.title,
                artist: songData.artist,
                lyrics: songData.lyrics,
                album: songData.album,
                cover: songData.cover,
                author: songData.author,
                verses: songData.verses,
                sections: songData.sections,
                defaultArrangement: songData.defaultArrangement,
                isPublic,
                churchId,
                createdAt: now,
            }, now)
            await getIndexedDB().library.put(row)

            await loadLocalSongs()
            notifySongsChanged()
            return row.content
        } catch (error) {
            console.error('Error creating song:', error)
            return null
        } finally {
            setLoading(false)
        }
    }, [churchId, loadLocalSongs])

    const updateSong = useCallback(async (
        songId: string,
        updateData: Partial<Song>
    ): Promise<Song | null> => {
        try {
            setLoading(true)

            const db = getIndexedDB()
            const existing = await db.library.get(songId)
            const current = (existing?.content as Song | undefined) ?? getServerSongs()?.find((s) => (s._id || s.id) === songId)
            const row = pendingRow(
                songId,
                { ...(current ?? { id: songId, title: '', artist: '', lyrics: '' }), ...updateData },
                existing?.createdAt ?? new Date().toISOString(),
            )
            await db.library.put(row)

            await loadLocalSongs()
            notifySongsChanged()
            return row.content
        } catch (error) {
            console.error('Error updating song:', error)
            return null
        } finally {
            setLoading(false)
        }
    }, [loadLocalSongs])

    const importSongs = useCallback(async (items: ImportedSong[]) => {
        const db = getIndexedDB()
        const now = new Date().toISOString()
        const existing = new Map(
            (await db.library.bulkGet(items.map((i) => i.replaceId).filter((id): id is string => !!id)))
                .filter((row): row is NonNullable<typeof row> => !!row)
                .map((row) => [row.id, row]),
        )
        const server = new Map((getServerSongs() ?? []).map((s) => [s._id || s.id, s]))
        let created = 0
        let updated = 0
        const rows = items.map(({ data, replaceId }) => {
            if (replaceId) {
                updated++
                const prior = existing.get(replaceId)
                const base = (prior?.content as Song | undefined) ?? server.get(replaceId)
                return pendingRow(replaceId, { ...(base ?? { id: replaceId, title: '', artist: '', lyrics: '' }), ...data }, prior?.createdAt ?? now)
            }
            created++
            const id = newLocalId()
            return pendingRow(id, { id, title: '', artist: '', lyrics: '', churchId, createdAt: now, ...data }, now)
        })
        await db.library.bulkPut(rows)
        await loadLocalSongs()
        notifySongsChanged()
        return { created, updated }
    }, [churchId, loadLocalSongs])

    const deleteSong = useCallback(async (songId: string): Promise<boolean> => {
        try {
            setLoading(true)

            const db = getIndexedDB()
            const removed = await db.library.get(songId)
            await db.library.delete(songId)

            // A device song may stand for a server song (its serverId); a
            // server-id row is one. Either way the server copy goes too.
            const serverId = (removed?.content as Song | undefined)?.serverId
                ?? (songId.startsWith('local_') || songId.startsWith('ew_') ? undefined : songId)

            if (!isOffline && serverId) {
                try {
                    await withTimeout(
                        deleteSongMutation({ songId: serverId }),
                        MUTATION_TIMEOUT_MS,
                        'deleteSong',
                    )
                } catch (err) {
                    console.warn('[useSongs] Server delete failed, local delete kept:', err)
                }
            }

            await loadLocalSongs()
            notifySongsChanged()
            return true
        } catch (error) {
            console.error('Error deleting song:', error)
            return false
        } finally {
            setLoading(false)
        }
    }, [deleteSongMutation, isOffline, loadLocalSongs])

    const parseSongLyrics = useCallback((
        lyrics: string,
        linesPerVerse: number = 4
    ): string[] => {
        const verses: string[] = []
        let tempVerse = ''
        let lineCount = 0

        const lyricLines = lyrics?.replaceAll('\n \n', '\n\n')?.split('\n') || []

        for (let i = 0; i < lyricLines.length; i++) {
            let line = lyricLines[i]

            line = line
                .replaceAll("\u00e2", "'")
                .replaceAll('solo: ', '')
                .replaceAll(' ??? ', '')
                .replaceAll(' ?? ', '')
                .replaceAll('[force-verse-break]', '')

            if (line.trim() === '') {
                if (tempVerse) {
                    verses.push(tempVerse.replace('\n\n', '').trim())
                }
                lineCount = 0
                tempVerse = ''
                continue
            }

            tempVerse += `${line}\n`
            lineCount += 1

            if (tempVerse.includes('\n\n')) {
                verses.push(tempVerse.replace('\n\n', '').trim())
                lineCount = 0
                tempVerse = ''
                continue
            }

            if (lineCount === linesPerVerse) {
                verses.push(tempVerse.replace('\n\n', '').trim())
                lineCount = 0
                tempVerse = ''
            }

            if (lyricLines.length - i === 1 && tempVerse) {
                verses.push(tempVerse.replace('\n\n', '').trim())
            }
        }

        return verses.filter((verse) => verse !== '')
    }, [])

    const songs = useMemo(() => effectiveSongs as Song[], [effectiveSongs])

    // Report "loading" during the initial fetch too (the Convex query is
    // `undefined` until it resolves), not just during mutations — otherwise the
    // UI flashes an empty "No songs yet" before the library arrives.
    const initialLoading = allSongsQuery === undefined && songs.length === 0
    const loadingState = loading || initialLoading

    return {
        songs,
        loading: loadingState,
        searchSongs,
        getAllSongs,
        getSongById,
        createSong,
        importSongs,
        updateSong,
        deleteSong,
        parseSongLyrics,
        isOfflineData,
    }
}