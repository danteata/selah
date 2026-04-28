import { useState, useCallback, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAppStore } from '../store/appStore'
import type { Song } from '../types'
import { getIndexedDB } from './useIndexedDB'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'

export interface UseSongsReturn {
    songs: Song[]
    loading: boolean
    searchSongs: (query: string, limit?: number) => Song[]
    getAllSongs: () => Song[]
    getSongById: (songId: string) => Song | null
    createSong: (songData: Partial<Song>, isPublic?: boolean) => Promise<Song | null>
    updateSong: (songId: string, updateData: Partial<Song>) => Promise<Song | null>
    deleteSong: (songId: string) => Promise<boolean>
    parseSongLyrics: (lyrics: string, linesPerVerse?: number) => string[]
    isOfflineData: boolean
}

export function useSongs(): UseSongsReturn {
    const [loading, setLoading] = useState(false)
    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const churchId = activeSchedule?.churchId || ''
    const { isOffline } = useConvexConnection()
    const [localSongs, setLocalSongs] = useState<Song[]>([])

    const createSongMutation = useMutation(api.songs.createSong)
    const updateSongMutation = useMutation(api.songs.updateSong)
    const deleteSongMutation = useMutation(api.songs.deleteSong)

    const allSongsQuery = useQuery(
        api.songs.searchSongs,
        { churchId: churchId || undefined, query: '', limit: 1000 }
    )

    useEffect(() => {
        if (allSongsQuery && allSongsQuery.length > 0) {
            const db = getIndexedDB()
            for (const song of allSongsQuery) {
                db.library.put({
                    id: song._id || song.id,
                    type: 'song',
                    content: song,
                    createdAt: song.createdAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                }).catch(() => {})
            }
        }
    }, [allSongsQuery])

    useEffect(() => {
        if (!isOffline) return

        const loadLocalSongs = async () => {
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
        }
        loadLocalSongs()
    }, [isOffline])

    const isOfflineData = isOffline && (allSongsQuery === undefined || allSongsQuery === null)

    const effectiveSongs = isOfflineData ? localSongs : (allSongsQuery || [])

    const searchSongs = useCallback((query: string = '', limit: number = 20): Song[] => {
        if (!query.trim()) {
            return effectiveSongs.slice(0, limit) as Song[]
        }

        const filtered = effectiveSongs.filter((song: Song) =>
            song.title.toLowerCase().includes(query.toLowerCase()) ||
            song.artist.toLowerCase().includes(query.toLowerCase())
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

    const createSong = useCallback(async (
        songData: Partial<Song>,
        isPublic: boolean = false
    ): Promise<Song | null> => {
        try {
            setLoading(true)

            if (!songData.title || !songData.artist || !songData.lyrics) {
                throw new Error('Title, artist, and lyrics are required')
            }

            const localId = `local_song_${Date.now()}_${Math.random().toString(36).slice(2)}`
            const localSong: Song = {
                id: localId,
                _id: localId,
                title: songData.title,
                artist: songData.artist,
                lyrics: songData.lyrics,
                album: songData.album,
                cover: songData.cover,
                author: songData.author,
                verses: songData.verses,
                isPublic,
                churchId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }

            const db = getIndexedDB()
            await db.library.put({
                id: localId,
                type: 'song',
                content: localSong,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })

            if (!isOffline) {
                try {
                    const serverId = await createSongMutation({
                        title: songData.title,
                        artist: songData.artist,
                        lyrics: songData.lyrics,
                        album: songData.album,
                        cover: songData.cover,
                        author: songData.author,
                        verses: songData.verses,
                        isPublic,
                        churchId,
                    })

                    await db.library.delete(localId)
                    await db.library.put({
                        id: serverId,
                        type: 'song',
                        content: { ...localSong, _id: serverId, id: serverId },
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    })
                } catch (err) {
                    console.warn('[useSongs] Server create failed, keeping local:', err)
                }
            }

            return localSong
        } catch (error) {
            console.error('Error creating song:', error)
            return null
        } finally {
            setLoading(false)
        }
    }, [createSongMutation, churchId, isOffline])

    const updateSong = useCallback(async (
        songId: string,
        updateData: Partial<Song>
    ): Promise<Song | null> => {
        try {
            setLoading(true)

            const db = getIndexedDB()
            const existing = await db.library.get(songId)
            const updatedLocal: Song = {
                ...(existing?.content as Song || {}),
                ...updateData,
                updatedAt: new Date().toISOString(),
            }

            await db.library.put({
                ...existing,
                id: songId,
                type: 'song',
                content: updatedLocal,
                updatedAt: new Date().toISOString(),
            })

            if (!isOffline) {
                try {
                    await updateSongMutation({
                        songId,
                        updates: {
                            title: updateData.title,
                            artist: updateData.artist,
                            lyrics: updateData.lyrics,
                            album: updateData.album,
                            cover: updateData.cover,
                            author: updateData.author,
                            verses: updateData.verses,
                            isPublic: updateData.isPublic,
                        },
                    })
                } catch (err) {
                    console.warn('[useSongs] Server update failed, local update kept:', err)
                }
            }

            return updatedLocal
        } catch (error) {
            console.error('Error updating song:', error)
            return null
        } finally {
            setLoading(false)
        }
    }, [updateSongMutation, isOffline])

    const deleteSong = useCallback(async (songId: string): Promise<boolean> => {
        try {
            setLoading(true)

            const db = getIndexedDB()
            await db.library.delete(songId)

            if (!isOffline) {
                try {
                    await deleteSongMutation({ songId })
                } catch (err) {
                    console.warn('[useSongs] Server delete failed, local delete kept:', err)
                }
            }

            return true
        } catch (error) {
            console.error('Error deleting song:', error)
            return false
        } finally {
            setLoading(false)
        }
    }, [deleteSongMutation, isOffline])

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

    return {
        songs,
        loading,
        searchSongs,
        getAllSongs,
        getSongById,
        createSong,
        updateSong,
        deleteSong,
        parseSongLyrics,
        isOfflineData,
    }
}