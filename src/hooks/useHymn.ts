import { useCallback } from 'react'
import { getIndexedDB } from './useIndexedDB'
import type { Hymn } from '../types'

// Hymn data URL from Vue app (same CDN as Bible data)
const HYMN_DATA_URL = 'https://d37gopmfkl2m2z.cloudfront.net/open/hymns.json'

export function useHymn() {
    // Download hymn data if not cached
    const downloadHymns = useCallback(async (): Promise<Hymn[] | null> => {
        try {
            console.log('Downloading hymns data...')
            const response = await fetch(HYMN_DATA_URL)

            if (!response.ok) {
                throw new Error(`Failed to fetch hymn data: ${response.status}`)
            }

            const hymns = await response.json() as Hymn[]

            // Cache in IndexedDB
            const db = getIndexedDB()
            await db.bibleAndHymns.put({
                id: 'hymns',
                data: hymns as unknown as Hymn[],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })

            console.log(`Downloaded and cached ${hymns.length} hymns`)
            return hymns
        } catch (error) {
            console.error('Error downloading hymn data:', error)
            return null
        }
    }, [])

    const getHymn = useCallback(async (number: string): Promise<Hymn | null> => {
        const db = getIndexedDB()

        try {
            let hymnsData = await db.bibleAndHymns.get('hymns')
            let hymns = hymnsData?.data as unknown as Hymn[]

            // If not cached, download it
            if (!hymns) {
                const downloadedHymns = await downloadHymns()
                if (!downloadedHymns) {
                    console.error('Hymns data not found and could not be downloaded')
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
                    console.error('Hymns data not found and could not be downloaded')
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

    return { getHymn, getAllHymns, downloadHymns }
}
