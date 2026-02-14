import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { getIndexedDB } from './useIndexedDB'
import type { BibleVerse, Scripture, Hymn } from '../types'

// Bible data URL from Vue app
const BIBLE_DATA_URL = 'https://d37gopmfkl2m2z.cloudfront.net/open/bible-versions'

export function useScripture() {
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const setDefaultBibleVersion = useAppStore((state) => state.setDefaultBibleVersion)

    // Download Bible version data if not cached
    const downloadBibleVersion = useCallback(async (version: string): Promise<BibleVerse[] | null> => {
        try {
            console.log(`Downloading Bible version: ${version}...`)
            const response = await fetch(`${BIBLE_DATA_URL}/${version.toLowerCase()}.json`)

            if (!response.ok) {
                throw new Error(`Failed to fetch Bible data: ${response.status}`)
            }

            const bibleData = await response.json() as BibleVerse[]

            // Cache in IndexedDB
            const db = getIndexedDB()
            await db.bibleAndHymns.put({
                id: version,
                data: bibleData as unknown as Array<Scripture | Hymn>,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })

            console.log(`Bible version ${version} downloaded and cached`)
            return bibleData
        } catch (error) {
            console.error('Error downloading Bible data:', error)
            return null
        }
    }, [])

    // Check if a bible version is downloaded
    const isVersionDownloaded = useCallback(async (version: string): Promise<boolean> => {
        const db = getIndexedDB()
        const count = await db.bibleAndHymns.where('id').equals(version).count()
        return count > 0
    }, [])

    const fetchScripture = useCallback(async (
        label: string = '1:1:1',
        version: string = ''
    ): Promise<Scripture | null> => {
        // Use provided version or default
        const selectedVersion = version || defaultBibleVersion

        const db = getIndexedDB()

        try {
            const shortLabelSplitted = label.split(':')
            const book = Number(shortLabelSplitted?.[0] || '1')
            const chapter = Number(shortLabelSplitted?.[1] || '1')
            const verseStr = shortLabelSplitted?.[2] || '1'

            // Handle verse ranges
            const verses: number[] = []
            if (verseStr.toString().includes('-')) {
                const verseSplitted = verseStr.toString().split('-')
                const verseStart = Number(verseSplitted?.[0] || '1')
                const verseEnd = Number(verseSplitted?.[1] || '1')

                for (let i = verseStart; i <= verseEnd; i++) {
                    verses.push(i)
                }
            } else {
                verses.push(Number(verseStr))
            }

            // Check if version is downloaded
            const isDownloaded = await isVersionDownloaded(selectedVersion)

            if (!isDownloaded) {
                console.log(`Bible version ${selectedVersion} not downloaded, downloading now...`)
                const downloaded = await downloadBibleVersion(selectedVersion)
                if (!downloaded) {
                    console.error(`Failed to download Bible version ${selectedVersion}`)
                    return null
                }
            }

            // Fetch bible data from IndexedDB
            const bibleDataRaw = await db.bibleAndHymns.get(selectedVersion)
            const bibleData = bibleDataRaw?.data as unknown as BibleVerse[]

            if (!bibleData) {
                console.error(`Bible data not found for version ${selectedVersion}`)
                return null
            }

            // Find start index
            const startIndex = bibleData.findIndex((scripture: BibleVerse) =>
                Number(scripture.book) === book &&
                Number(scripture.chapter) === chapter &&
                Number(scripture.verse) === verses[0]
            )

            if (startIndex === -1) {
                console.error('Scripture not found')
                return null
            }

            // Get all verses in sequence
            const selectedVerses = bibleData.slice(startIndex, startIndex + verses.length)

            // Get book name
            const bookNames = [
                '', 'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
                'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
                '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
                'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
                'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
                'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
                'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
                'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
                'Matthew', 'Mark', 'Luke', 'John', 'Acts',
                'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
                'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
                '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
                '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
                'Jude', 'Revelation'
            ]

            const bookName = bookNames[book] || ''
            const startVerse = verses[0]
            const endVerse = verses[verses.length - 1]

            const labelText = startVerse === endVerse
                ? `${bookName} ${chapter}:${startVerse}`
                : `${bookName} ${chapter}:${startVerse}-${endVerse}`

            // Update default version to the one just used
            if (selectedVersion !== defaultBibleVersion) {
                setDefaultBibleVersion(selectedVersion)
            }

            const scripture: Scripture = {
                label: labelText,
                labelShortFormat: `${book}:${chapter}:${startVerse}${startVerse !== endVerse ? `-${endVerse}` : ''}`,
                version: selectedVersion,
                content: selectedVerses
            }

            return scripture
        } catch (error) {
            console.error('Error fetching scripture:', error)
            return null
        }
    }, [defaultBibleVersion, setDefaultBibleVersion, isVersionDownloaded, downloadBibleVersion])

    return { fetchScripture, downloadBibleVersion, isVersionDownloaded }
}
