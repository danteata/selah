import { useCallback } from 'react'
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

export function useHymn() {
    // Cache hymns in IndexedDB so subsequent lookups don't re-fetch.
    const cacheHymns = useCallback(async (hymns: Hymn[]): Promise<void> => {
        const db = getIndexedDB()
        await db.bibleAndHymns.put({
            id: 'hymns',
            data: hymns as unknown as Hymn[],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        })
    }, [])

    // Try the bundled static asset first (same-origin, no CORS).
    const fetchFromBundled = useCallback(async (): Promise<Hymn[] | null> => {
        try {
            const response = await fetch(BUNDLED_HYMNS_URL)
            if (!response.ok) return null
            return await response.json() as Hymn[]
        } catch {
            return null
        }
    }, [])

    // Last-resort fallback: public CDN. Silent on CORS/network failure —
    // the bundled asset is the supported source for production deployments.
    const fetchFromCdn = useCallback(async (): Promise<Hymn[] | null> => {
        try {
            const response = await fetch(HYMN_DATA_URL, { mode: 'cors' })
            if (!response.ok) return null
            return await response.json() as Hymn[]
        } catch {
            return null
        }
    }, [])

    // Download hymn data with fallback chain: IndexedDB → bundled → CDN.
    const downloadHymns = useCallback(async (): Promise<Hymn[] | null> => {
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
    }, [fetchFromBundled, fetchFromCdn, cacheHymns])

    const getHymn = useCallback(async (number: string): Promise<Hymn | null> => {
        const db = getIndexedDB()

        try {
            let hymnsData = await db.bibleAndHymns.get('hymns')
            let hymns = hymnsData?.data as unknown as Hymn[]

            // If not cached, download it
            if (!hymns) {
                const downloadedHymns = await downloadHymns()
                if (!downloadedHymns) {
                    return null
                }
                hymns = downloadedHymns
            }

            const hymn = hymns.find((h: Hymn) => h.number === number)

            if (!hymn) {
                console.error(`Hymn ${number} not found`)
                return null
            }

            return hymn
        } catch (error) {
            console.error('Error fetching hymn:', error)
            return null
        }
    }, [downloadHymns])

    const getAllHymns = useCallback(async (): Promise<Hymn[]> => {
        const db = getIndexedDB()

        try {
            let hymnsData = await db.bibleAndHymns.get('hymns')
            let hymns = hymnsData?.data as unknown as Hymn[]

            // If not cached, download it
            if (!hymns) {
                const downloadedHymns = await downloadHymns()
                if (!downloadedHymns) {
                    return []
                }
                hymns = downloadedHymns
            }

            return hymns
        } catch (error) {
            console.error('Error fetching hymns:', error)
            return []
        }
    }, [downloadHymns])

    return { getHymn, getHymnByNumber: getHymn, getAllHymns, downloadHymns }
}
