import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { getIndexedDB } from './useIndexedDB'
import type { Song } from '../types'

export function useSong() {
    const linesPerSlide = useAppStore((state) => state.settings.slideStyles.linesPerSlide)

    const getSong = useCallback(async (
        song: Song | string,
        customLinesPerDisplay?: number
    ): Promise<Song | null> => {
        const linesToUse = customLinesPerDisplay || linesPerSlide || 4

        try {
            let songData: Song | null = null

            if (typeof song === 'string') {
                // Try to get from IndexedDB first
                if (song.includes('-')) {
                    const db = getIndexedDB()
                    const data = await db.library.get(song)
                    if (data?.content) {
                        songData = data.content as Song
                    }
                }

                // If not found, would fetch from API here
                if (!songData) {
                    console.error('Song not found:', song)
                    return null
                }
            } else {
                songData = song
            }

            if (!songData) {
                return null
            }

            // Divide lyrics into verses by splitting on blank lines
            const verses: string[] = []

            // Clean up lyrics
            let cleanedLyrics = songData.lyrics || ''
            cleanedLyrics = cleanedLyrics
                .replaceAll("â", "'")
                .replaceAll('solo: ', '')
                .replaceAll(' ??? ', '')
                .replaceAll(' ?? ', '')
                .replaceAll('[force-verse-break]', '')

            // Split by one or more blank lines (handles both single and double blank lines)
            // A blank line is a line that is empty or contains only whitespace
            const verseBlocks = cleanedLyrics.split(/\n\s*\n/)

            for (const block of verseBlocks) {
                const trimmedBlock = block.trim()
                if (trimmedBlock) {
                    verses.push(trimmedBlock)
                }
            }

            console.log('Parsed verses:', verses.length, verses)

            return {
                ...songData,
                verses: verses.filter(verse => verse !== '')
            }
        } catch (error) {
            console.error('Error processing song:', error)
            return null
        }
    }, [linesPerSlide])

    const saveSong = useCallback(async (song: Song): Promise<void> => {
        const db = getIndexedDB()

        const libraryItem = {
            id: song._id || song.id,
            type: 'song' as const,
            content: song,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }

        await db.library.put(libraryItem)
    }, [])

    const deleteSong = useCallback(async (songId: string): Promise<void> => {
        const db = getIndexedDB()
        await db.library.delete(songId)
    }, [])

    return { getSong, saveSong, deleteSong }
}
