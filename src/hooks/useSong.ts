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

            // Divide lyrics into verses
            const verses: string[] = []
            let tempVerse = ''
            let lineCount = 0

            // Clean up lyrics
            const lyricLines = songData.lyrics
                ?.replaceAll('\n \n', '\n\n')
                ?.split('\n') || []

            for (let i = 0; i < lyricLines.length; i++) {
                let line = lyricLines[i]

                // Clean up line
                line = line
                    .replaceAll("â", "'")
                    .replaceAll('solo: ', '')
                    ?.replaceAll(' ??? ', '')
                    ?.replaceAll(' ?? ', '')
                    ?.replaceAll('[force-verse-break]', '')

                // If line is empty, push current verse and reset
                if (line.trim() === '') {
                    if (tempVerse.trim()) {
                        verses.push(tempVerse.trim())
                    }
                    lineCount = 0
                    tempVerse = ''
                    continue
                }

                tempVerse += `${line}\n`
                lineCount += 1

                // Check for double newline
                if (tempVerse.includes('\n\n')) {
                    verses.push(tempVerse.replace('\n\n', '').trim())
                    lineCount = 0
                    tempVerse = ''
                    continue
                }

                // Check line count limit
                if (lineCount === linesToUse) {
                    verses.push(tempVerse.trim())
                    lineCount = 0
                    tempVerse = ''
                }

                // Last line
                if ((lyricLines.length - i) === 1 && tempVerse.trim()) {
                    verses.push(tempVerse.trim())
                }
            }

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
