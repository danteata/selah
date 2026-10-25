import { useEffect, useState } from 'react'
import { getLocalMediaBlob } from './useIndexedDB'

/**
 * Object URLs by media id, kept for the life of the page. The media panel read
 * every tile's full file out of IndexedDB and made a fresh URL each time it
 * opened, then revoked them all when it closed, so every open paid for the
 * whole library again. A URL is released when its item is deleted
 * ({@link forgetLocalMediaBlobUrl}).
 */
const objectUrls = new Map<string, string>()

/** Release the URL kept for a deleted media item. */
export function forgetLocalMediaBlobUrl(localMediaId: string): void {
    const url = objectUrls.get(localMediaId)
    if (url) URL.revokeObjectURL(url)
    objectUrls.delete(localMediaId)
}

/**
 * Web counterpart to desktop's `resolveLocalUrl` — resolves a `localMediaId`
 * (an IndexedDB-backed media library entry with no Convex storage copy) to a
 * `URL.createObjectURL(blob)`. Every window/tab that needs the media (studio,
 * live output) calls this independently — IndexedDB is shared per-origin, so
 * each resolves its own object URL from the same stored Blob.
 *
 * The URL is remembered with the id it was made for and only returned for that
 * id, so an <img>/<video> never shows the previous id's media while the next
 * one loads.
 */
export function useLocalMediaBlobUrl(localMediaId: string | null | undefined): string | null {
    const [resolved, setResolved] = useState<{ id: string; url: string | null } | null>(null)

    useEffect(() => {
        if (!localMediaId || objectUrls.has(localMediaId)) return

        let cancelled = false
        getLocalMediaBlob(localMediaId)
            .then((blob) => {
                if (!blob) {
                    if (!cancelled) setResolved({ id: localMediaId, url: null })
                    return
                }
                // Another tile may have made one meanwhile.
                const url = objectUrls.get(localMediaId) ?? URL.createObjectURL(blob)
                objectUrls.set(localMediaId, url)
                if (!cancelled) setResolved({ id: localMediaId, url })
            })
            .catch((err) => {
                // IndexedDB unavailable (private mode, quota): no media rather
                // than an unhandled rejection.
                console.warn('[useLocalMediaBlobUrl] could not load local media:', err)
                if (!cancelled) setResolved({ id: localMediaId, url: null })
            })

        return () => {
            cancelled = true
        }
    }, [localMediaId])

    if (!localMediaId) return null
    return objectUrls.get(localMediaId) ?? (resolved?.id === localMediaId ? resolved.url : null)
}
