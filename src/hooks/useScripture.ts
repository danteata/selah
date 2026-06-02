import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { getIndexedDB } from './useIndexedDB'
import type { BibleVerse, Scripture, Hymn } from '../types'

// Bible data served as a static asset bundled with the app (web + Tauri).
// Vite copies `public/bibles/{version}.json` into the build output as-is.
// The browser/Tauri webview serves the file with normal HTTP cache headers,
// so subsequent visits skip the network entirely.
const BUNDLED_BIBLE_URL = '/bibles'

// Public CDN fallback — only hit if the bundled asset is missing (e.g. a
// version was added to the system after the last build). This is a
// third-party CloudFront URL, not Convex.
const BIBLE_DATA_URL = 'https://d37gopmfkl2m2z.cloudfront.net/open/bible-versions'

// Data source tracking
export type BibleDataSource = 'indexeddb' | 'bundled' | 'cdn'

export interface BibleVersionStatus {
    id: string
    downloaded: boolean
    source: BibleDataSource | null
    availableBundled: boolean
    availableOnCdn: boolean
}

export function useScripture() {
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const setDefaultBibleVersion = useAppStore((state) => state.setDefaultBibleVersion)

    // Fetch Bible data from the bundled static asset (Vite/Tauri).
    // Served as `/bibles/{version}.json` — cached by the browser forever after first load.
    const fetchFromBundled = useCallback(async (version: string): Promise<BibleVerse[] | null> => {
        try {
            const response = await fetch(`${BUNDLED_BIBLE_URL}/${version.toLowerCase()}.json`)

            if (!response.ok) {
                // Bundled asset is missing (e.g. the version was added after this build).
                // Don't warn loudly — this is expected for not-yet-bundled versions.
                return null
            }

            const bibleData = await response.json() as BibleVerse[]
            return bibleData
        } catch {
            return null
        }
    }, [])

    // Fetch Bible data from public CDN (last-resort fallback if bundled missing).
    const fetchFromCdn = useCallback(async (version: string): Promise<BibleVerse[] | null> => {
        try {
            const response = await fetch(`${BIBLE_DATA_URL}/${version.toLowerCase()}.json`)

            if (!response.ok) {
                console.warn(`CDN fetch failed for ${version}: ${response.status}`)
                return null
            }

            const bibleData = await response.json() as BibleVerse[]
            console.log(`Successfully fetched ${version} from CDN (${bibleData.length} verses)`)
            return bibleData
        } catch (error) {
            console.error('Error fetching from CDN:', error)
            return null
        }
    }, [])

    // Cache Bible data in IndexedDB
    const cacheInIndexedDB = useCallback(async (version: string, data: BibleVerse[]): Promise<void> => {
        const db = getIndexedDB()
        await db.bibleAndHymns.put({
            id: version,
            data: data as unknown as Array<Scripture | Hymn>,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        })
        console.log(`Cached Bible version ${version} in IndexedDB`)
    }, [])

    // Get Bible data from IndexedDB cache
    const getFromIndexedDB = useCallback(async (version: string): Promise<BibleVerse[] | null> => {
        const db = getIndexedDB()
        const cached = await db.bibleAndHymns.get(version)

        if (cached?.data) {
            console.log(`Found ${version} in IndexedDB cache`)
            return cached.data as unknown as BibleVerse[]
        }

        return null
    }, [])

    // Download Bible version with fallback chain: IndexedDB → bundled → CDN.
    // Convex is intentionally NOT in this chain. The Bible files stored in
    // Convex storage are cold backup only — the client never reads them.
    const downloadBibleVersion = useCallback(async (version: string): Promise<BibleVerse[] | null> => {
        // 1. Check IndexedDB cache first
        const cached = await getFromIndexedDB(version)
        if (cached) {
            return cached
        }

        // 2. Try the bundled static asset (served with the app, HTTP-cached)
        const bundledData = await fetchFromBundled(version)
        if (bundledData) {
            await cacheInIndexedDB(version, bundledData)
            return bundledData
        }

        // 3. Last-resort fallback: public CDN
        const cdnData = await fetchFromCdn(version)
        if (cdnData) {
            await cacheInIndexedDB(version, cdnData)
            return cdnData
        }

        console.error(`Failed to fetch Bible version ${version} from any source`)
        return null
    }, [getFromIndexedDB, fetchFromBundled, fetchFromCdn, cacheInIndexedDB])

    // Check if a bible version is downloaded (in IndexedDB)
    const isVersionDownloaded = useCallback(async (version: string): Promise<boolean> => {
        const cached = await getFromIndexedDB(version)
        return cached !== null
    }, [getFromIndexedDB])

    // Get detailed status of a Bible version
    const getVersionStatus = useCallback(async (version: string): Promise<BibleVersionStatus> => {
        const downloaded = await isVersionDownloaded(version)

        // Bundled asset is always available when served from the app — no probe needed.

        // Check CDN availability (just check if the URL responds with OK)
        let availableOnCdn = false
        try {
            const response = await fetch(`${BIBLE_DATA_URL}/${version.toLowerCase()}.json`, { method: 'HEAD' })
            availableOnCdn = response.ok
        } catch {
            // CDN not available
        }

        return {
            id: version,
            downloaded,
            source: downloaded ? 'indexeddb' : null,
            availableBundled: true,
            availableOnCdn,
        }
    }, [isVersionDownloaded])

    const fetchScripture = useCallback(async (
        label: string = '1:1:1',
        version: string = ''
    ): Promise<Scripture | null> => {
        // Use provided version or default
        const selectedVersion = version || defaultBibleVersion

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

            // Fetch bible data - downloadBibleVersion checks IndexedDB → bundled asset → CDN
            let bibleData = await downloadBibleVersion(selectedVersion)

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

    return {
        fetchScripture,
        downloadBibleVersion,
        isVersionDownloaded,
        getVersionStatus,
        fetchFromBundled,
        fetchFromCdn,
        cacheInIndexedDB,
    }
}
