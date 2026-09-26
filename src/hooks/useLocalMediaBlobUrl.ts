import { useEffect, useState } from 'react'
import { getLocalMediaBlob } from './useIndexedDB'

/**
 * Web counterpart to desktop's `resolveLocalUrl` — resolves a `localMediaId`
 * (an IndexedDB-backed media library entry with no Convex storage copy) to a
 * `URL.createObjectURL(blob)`. Every window/tab that needs the media (studio,
 * live output) calls this independently — IndexedDB is shared per-origin, so
 * each resolves its own object URL from the same stored Blob.
 *
 * The URL is remembered with the id it was made for and only returned for that
 * id. Previously the old URL was revoked the moment the id changed but still
 * returned until the new blob loaded, so the <img>/<video> briefly pointed at a
 * dead `blob:` URL and showed broken media — on the live output, too.
 */
export function useLocalMediaBlobUrl(localMediaId: string | null | undefined): string | null {
    const [resolved, setResolved] = useState<{ id: string; url: string | null } | null>(null)

    useEffect(() => {
        if (!localMediaId) return

        let cancelled = false
        let objectUrl: string | null = null

        getLocalMediaBlob(localMediaId)
            .then((blob) => {
                if (cancelled) return
                objectUrl = blob ? URL.createObjectURL(blob) : null
                setResolved({ id: localMediaId, url: objectUrl })
            })
            .catch((err) => {
                // IndexedDB unavailable (private mode, quota): no media rather
                // than an unhandled rejection.
                console.warn('[useLocalMediaBlobUrl] could not load local media:', err)
                if (!cancelled) setResolved({ id: localMediaId, url: null })
            })

        return () => {
            cancelled = true
            // This run's URL, once nothing can be showing it any more.
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [localMediaId])

    return localMediaId && resolved?.id === localMediaId ? resolved.url : null
}
