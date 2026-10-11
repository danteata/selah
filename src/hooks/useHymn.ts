import { getIndexedDB } from './useIndexedDB'
import type { Hymn } from '../types'

// Hymn data served as a static asset bundled with the app (web + Tauri).
// Vite copies `public/hymns/hymns.json` into the build output as-is, so the
// browser/Tauri webview can serve it with normal HTTP cache headers and avoid
// the CORS-blocked cross-origin CDN path.
const BUNDLED_HYMNS_URL = '/hymns/hymns.json'

// Public CDN fallback — only hit if the bundled asset is missing. Same
// third-party CloudFront URL used for Bible data, not Convex.
const HYMN_DATA_URL = 'https://d37gopmfkl2m2z.cloudfront.net/open/hymns.json'

// The hymnal, once read, for the rest of the session. Every opening of the
// songs panel read all 1.7 MB of it back out of IndexedDB, and handed back a
// new array each time, so the search index over it was rebuilt each time too.
let hymnal: Hymn[] | null = null
let hymnalLoad: Promise<Hymn[]> | null = null

/** The hymnal if it's been read this session — to render without waiting. */
export function getLoadedHymns(): Hymn[] | null {
    return hymnal
}

// Cache hymns in IndexedDB so subsequent lookups don't re-fetch.
async function cacheHymns(hymns: Hymn[]): Promise<void> {
    const db = getIndexedDB()
    await db.bibleAndHymns.put({
        id: 'hymns',
        data: hymns as unknown as Hymn[],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    })
}

// Try the bundled static asset first (same-origin, no CORS).
async function fetchFromBundled(): Promise<Hymn[] | null> {
    try {
        const response = await fetch(BUNDLED_HYMNS_URL)
        if (!response.ok) return null
        return await response.json() as Hymn[]
    } catch {
        return null
    }
}

// Last-resort fallback: public CDN. Silent on CORS/network failure —
// the bundled asset is the supported source for production deployments.
async function fetchFromCdn(): Promise<Hymn[] | null> {
    try {
        const response = await fetch(HYMN_DATA_URL, { mode: 'cors' })
        if (!response.ok) return null
        return await response.json() as Hymn[]
    } catch {
        return null
    }
}

// Download hymn data with fallback chain: IndexedDB → bundled → CDN.
async function downloadHymns(): Promise<Hymn[] | null> {
    console.log('Downloading hymns data...')
    const bundled = await fetchFromBundled()
    if (bundled) {
        await cacheHymns(bundled)
        console.log(`Loaded ${bundled.length} hymns from bundled asset`)
        return bundled
    }

    const cdn = await fetchFromCdn()
    if (cdn) {
        await cacheHymns(cdn)
        console.log(`Downloaded and cached ${cdn.length} hymns`)
        return cdn
    }

    console.error('Hymns data not found and could not be downloaded')
    return null
}

/** Every hymn: from memory after the first call, else IndexedDB, else downloaded. */
export function loadHymns(): Promise<Hymn[]> {
    if (hymnal) return Promise.resolve(hymnal)
    hymnalLoad ??= (async () => {
        try {
            const hymnsData = await getIndexedDB().bibleAndHymns.get('hymns')
            // If not cached, download it
            const hymns = (hymnsData?.data as unknown as Hymn[] | undefined) ?? await downloadHymns()
            if (hymns) hymnal = hymns
            return hymns ?? []
        } catch (error) {
            console.error('Error fetching hymns:', error)
            return []
        } finally {
            hymnalLoad = null
        }
    })()
    return hymnalLoad
}

async function getHymn(number: string): Promise<Hymn | null> {
    const hymn = (await loadHymns()).find((h: Hymn) => h.number === number)
    if (!hymn) console.error(`Hymn ${number} not found`)
    return hymn ?? null
}

/** For tests. */
export function resetLoadedHymns(): void {
    hymnal = null
    hymnalLoad = null
}

export function useHymn() {
    return { getHymn, getHymnByNumber: getHymn, getAllHymns: loadHymns, downloadHymns }
}
