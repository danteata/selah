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

const BOOK_NAMES = [
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
    'Jude', 'Revelation',
]

// Some cached payloads use book name strings ("John") instead of book
// numbers. Find the index of a specific verse, falling back to scanning by
// name+number so the lookup resolves regardless of the cached data shape.
function findBibleStartIndex(bibleData: BibleVerse[], book: number, chapter: number, verse: number): number {
    let startIndex = bibleData.findIndex((s: BibleVerse) =>
        Number(s.book) === book &&
        Number(s.chapter) === chapter &&
        Number(s.verse) === verse
    )

    if (startIndex === -1) {
        const targetBookName = BOOK_NAMES[book] || ''
        startIndex = bibleData.findIndex((s: any) => {
            const sb = String(s.book ?? '')
            const sc = Number(s.chapter)
            const sv = Number(s.verse)
            const nameMatch = sb === targetBookName || sb === String(book)
            return nameMatch && sc === chapter && sv === verse
        })
    }

    return startIndex
}

// A verse must never be attributed to the wrong book/chapter (bad ASR
// digits, an unvalidated LLM/regex guess, etc.) — the flat, sequential
// bible array has no natural stop at a chapter boundary.
function belongsToChapter(s: BibleVerse, book: number, chapter: number, bookName: string): boolean {
    const bookMatches = Number(s.book) === book || s.book === bookName || s.book === String(book)
    return bookMatches && Number(s.chapter) === chapter
}

// "10-12, 14, 17" — groups consecutive verse numbers into ranges, joined
// with commas, for a compact multi-verse reference label.
export function formatVerseGroups(verseNumbers: number[]): string {
    const sorted = Array.from(new Set(verseNumbers)).sort((a, b) => a - b)
    if (sorted.length === 0) return ''

    const runs: string[] = []
    let runStart = sorted[0]
    let runEnd = sorted[0]
    for (let i = 1; i <= sorted.length; i++) {
        if (i < sorted.length && sorted[i] === runEnd + 1) {
            runEnd = sorted[i]
        } else {
            runs.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`)
            if (i < sorted.length) {
                runStart = sorted[i]
                runEnd = sorted[i]
            }
        }
    }
    return runs.join(', ')
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
    // We only try the CDN if the page is served from a same-origin context
    // (HTTPS, non-IP host) — cross-origin public CDNs are blocked by CORS
    // and the browser logs a console error for each blocked request, which
    // is noisy. Operators who want CDN fallback can configure CORS on their
    // CDN or override this function.
    const fetchFromCdn = useCallback(async (version: string): Promise<BibleVerse[] | null> => {
        try {
            const response = await fetch(`${BIBLE_DATA_URL}/${version.toLowerCase()}.json`, {
                mode: 'cors',
            })

            if (!response.ok) {
                return null
            }

            const bibleData = await response.json() as BibleVerse[]
            console.log(`Successfully fetched ${version} from CDN (${bibleData.length} verses)`)
            return bibleData
        } catch {
            // CORS-blocked or network error — silent. The bundled asset path
            // is the only supported source for production deployments.
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
            console.log(`Found ${version} in IndexedDB cache, entries:`, (cached.data as any[]).length, 'first entry keys:', cached.data && (cached.data as any[])[0] ? Object.keys((cached.data as any[])[0]).join(',') : 'none')
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

        // Check CDN availability (just check if the URL responds with OK).
        // This is a probe for the settings UI; failures are expected when
        // the CDN doesn't have CORS configured, so we stay silent to keep
        // the console clean. Operators who need CDN can enable CORS on
        // their distribution.
        let availableOnCdn = false
        try {
            const response = await fetch(`${BIBLE_DATA_URL}/${version.toLowerCase()}.json`, {
                method: 'HEAD',
                mode: 'cors',
            })
            availableOnCdn = response.ok
        } catch {
            // CDN probe blocked or unreachable — treat as unavailable.
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

            const startIndex = findBibleStartIndex(bibleData, book, chapter, verses[0])

            if (startIndex === -1) {
                console.error('Scripture not found. Cache size:', bibleData.length, 'sample:', JSON.stringify(bibleData[0]).slice(0, 200), 'looking for', `${book}:${chapter}:${verses[0]}`)
                return null
            }

            // Get all verses in sequence
            let selectedVerses = bibleData.slice(startIndex, startIndex + verses.length)

            const bookName = BOOK_NAMES[book] || ''

            // A too-large verse range (bad ASR digits, an unvalidated LLM/regex
            // guess, etc.) must never spill past the requested chapter — the
            // flat, sequential bible array has no natural stop at a chapter
            // boundary, so `slice` would otherwise silently return real verses
            // from a completely different chapter/book under a label built
            // from the (wrong) requested range. Clamp to what's actually in
            // the requested book+chapter; we'd rather show fewer verses than
            // requested than substitute wrong scripture under a correct-looking
            // label.
            const firstOutOfRangeIdx = selectedVerses.findIndex((s) => !belongsToChapter(s, book, chapter, bookName))
            if (firstOutOfRangeIdx !== -1) {
                console.warn(
                    `Requested verse range spilled past ${bookName} ${chapter} — clamping`,
                    { requestedCount: verses.length, availableCount: firstOutOfRangeIdx },
                )
                selectedVerses = selectedVerses.slice(0, firstOutOfRangeIdx)
            }
            if (selectedVerses.length === 0) {
                console.error('Scripture range entirely out of bounds for the requested chapter', { book, chapter, verseStr })
                return null
            }

            const startVerse = verses[0]
            const endVerse = Number(selectedVerses[selectedVerses.length - 1].verse)

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

    // Fetch an explicit, possibly non-contiguous set of verse numbers (e.g.
    // from shift-click/drag selection in the verse picker) and merge them
    // into one Scripture. Unlike fetchScripture's label mini-language (which
    // can only express a contiguous range), this filters by exact verse
    // membership so a sparse selection like {10, 12, 14, 17} works.
    const fetchScriptureByVerseNumbers = useCallback(async (
        bookIndex: number,
        chapter: number,
        verseNumbers: number[],
        version: string = ''
    ): Promise<Scripture | null> => {
        const selectedVersion = version || defaultBibleVersion
        const sortedVerseNumbers = Array.from(new Set(verseNumbers)).sort((a, b) => a - b)

        if (sortedVerseNumbers.length === 0) return null

        try {
            const bibleData = await downloadBibleVersion(selectedVersion)
            if (!bibleData) {
                console.error(`Bible data not found for version ${selectedVersion}`)
                return null
            }

            const bookName = BOOK_NAMES[bookIndex] || ''
            const selectedVerses = bibleData
                .filter((s) => belongsToChapter(s, bookIndex, chapter, bookName) && sortedVerseNumbers.includes(Number(s.verse)))
                .sort((a, b) => Number(a.verse) - Number(b.verse))

            if (selectedVerses.length === 0) {
                console.error('No matching verses found for selection', { bookIndex, chapter, verseNumbers: sortedVerseNumbers })
                return null
            }

            const minVerse = sortedVerseNumbers[0]
            const maxVerse = sortedVerseNumbers[sortedVerseNumbers.length - 1]

            if (selectedVersion !== defaultBibleVersion) {
                setDefaultBibleVersion(selectedVersion)
            }

            return {
                label: `${bookName} ${chapter}:${formatVerseGroups(sortedVerseNumbers)}`,
                // Kept as a plain bounding range (not the grouped/sparse form) —
                // BibleList.tsx and BibleVerseNavigator.tsx both parse this as
                // "book:chapter:start(-end)". The exact sparse set lives in
                // `content` only.
                labelShortFormat: `${bookIndex}:${chapter}:${minVerse}${minVerse !== maxVerse ? `-${maxVerse}` : ''}`,
                version: selectedVersion,
                content: selectedVerses,
            }
        } catch (error) {
            console.error('Error fetching scripture by verse numbers:', error)
            return null
        }
    }, [defaultBibleVersion, setDefaultBibleVersion, downloadBibleVersion])

    return {
        fetchScripture,
        fetchScriptureByVerseNumbers,
        downloadBibleVersion,
        isVersionDownloaded,
        getVersionStatus,
        fetchFromBundled,
        fetchFromCdn,
        cacheInIndexedDB,
    }
}
