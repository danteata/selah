import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAppStore } from '../store/appStore'
import type { Song } from '../types'
import { getIndexedDB } from './useIndexedDB'

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
}

export function useSongs(): UseSongsReturn {
    const [loading, setLoading] = useState(false)
    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const churchId = activeSchedule?.churchId || ''

    // Convex mutations
    const createSongMutation = useMutation(api.songs.createSong)
    const updateSongMutation = useMutation(api.songs.updateSong)
    const deleteSongMutation = useMutation(api.songs.deleteSong)

    // Get all songs query - uses the user's churchId from auth if not provided
    const allSongsQuery = useQuery(
        api.songs.searchSongs,
        { churchId: churchId || undefined, query: '', limit: 1000 }
    )

    /**
     * Search songs by query (client-side filtering from loaded songs)
     */
    const searchSongs = useCallback((query: string = '', limit: number = 20): Song[] => {
        if (!query.trim()) {
            return (allSongsQuery || []).slice(0, limit) as Song[]
        }

        const filtered = (allSongsQuery || []).filter((song: Song) =>
            song.title.toLowerCase().includes(query.toLowerCase()) ||
            song.artist.toLowerCase().includes(query.toLowerCase())
        )

        return filtered.slice(0, limit) as Song[]
    }, [allSongsQuery])

    /**
     * Get all songs for the church
     */
    const getAllSongs = useCallback((): Song[] => {
        return (allSongsQuery || []) as Song[]
    }, [allSongsQuery])

    /**
     * Get a single song by ID
     */
    const getSongById = useCallback((songId: string): Song | null => {
        const song = (allSongsQuery || []).find((s: Song) => s._id === songId || s.id === songId)
        return song || null
    }, [allSongsQuery])

    /**
     * Create a new song
     */
    const createSong = useCallback(async (
        songData: Partial<Song>,
        isPublic: boolean = false
    ): Promise<Song | null> => {
        try {
            setLoading(true)

            if (!songData.title || !songData.artist || !songData.lyrics) {
                throw new Error('Title, artist, and lyrics are required')
            }

            const songId = await createSongMutation({
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

            // Also save to local IndexedDB for offline access
            const db = getIndexedDB()
            const localSong: Song = {
                id: songId,
                _id: songId,
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

            await db.library.put({
                id: songId,
                type: 'song',
                content: localSong,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })

            return localSong
        } catch (error) {
            console.error('Error creating song:', error)
            return null
        } finally {
            setLoading(false)
        }
    }, [createSongMutation, churchId])

    /**
     * Update an existing song
     */
    const updateSong = useCallback(async (
        songId: string,
        updateData: Partial<Song>
    ): Promise<Song | null> => {
        try {
            setLoading(true)

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

            // Update local IndexedDB
            const db = getIndexedDB()
            const existing = await db.library.get(songId)
            if (existing?.content) {
                await db.library.put({
                    ...existing,
                    content: {
                        ...existing.content,
                        ...updateData,
                        updatedAt: new Date().toISOString(),
                    },
                    updatedAt: new Date().toISOString(),
                })
            }

            // Return updated song
            const updatedSong: Song = {
                ...(existing?.content as Song || {}),
                ...updateData,
                updatedAt: new Date().toISOString(),
            }

            return updatedSong
        } catch (error) {
            console.error('Error updating song:', error)
            return null
        } finally {
            setLoading(false)
        }
    }, [updateSongMutation])

    /**
     * Delete a song
     */
    const deleteSong = useCallback(async (songId: string): Promise<boolean> => {
        try {
            setLoading(true)

            await deleteSongMutation({ songId })

            // Delete from local IndexedDB
            const db = getIndexedDB()
            await db.library.delete(songId)

            return true
        } catch (error) {
            console.error('Error deleting song:', error)
            return false
        } finally {
            setLoading(false)
        }
    }, [deleteSongMutation])

    /**
     * Parse song lyrics into verses
     */
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

            // Clean up line
            line = line
                .replaceAll("â", "'")
                .replaceAll('solo: ', '')
                .replaceAll(' ??? ', '')
                .replaceAll(' ?? ', '')
                .replaceAll('[force-verse-break]', '')

            // If line is empty, start new verse
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

            // Force verse break on double newline
            if (tempVerse.includes('\n\n')) {
                verses.push(tempVerse.replace('\n\n', '').trim())
                lineCount = 0
                tempVerse = ''
                continue
            }

            // Start new verse when line count is reached
            if (lineCount === linesPerVerse) {
                verses.push(tempVerse.replace('\n\n', '').trim())
                lineCount = 0
                tempVerse = ''
            }

            // Add remaining lines as last verse
            if (lyricLines.length - i === 1 && tempVerse) {
                verses.push(tempVerse.replace('\n\n', '').trim())
            }
        }

        return verses.filter((verse) => verse !== '')
    }, [])

    const songs = useMemo(() => (allSongsQuery || []) as Song[], [allSongsQuery])

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
    }
}