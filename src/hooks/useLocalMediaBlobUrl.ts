import { useEffect, useRef, useState } from 'react'
import { getLocalMediaBlob } from './useIndexedDB'

/**
 * Web counterpart to desktop's `resolveLocalUrl` — resolves a `localMediaId`
 * (an IndexedDB-backed media library entry with no Convex storage copy) to a
 * `URL.createObjectURL(blob)`. Every window/tab that needs the media (studio,
 * live output) calls this independently — IndexedDB is shared per-origin, so
 * each resolves its own object URL from the same stored Blob.
 */
export function useLocalMediaBlobUrl(localMediaId: string | null | undefined): string | null {
    const [url, setUrl] = useState<string | null>(null)
    const objectUrlRef = useRef<string | null>(null)

    useEffect(() => {
        if (!localMediaId) {
            setUrl(null)
            return
        }

        let cancelled = false

        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current)
            objectUrlRef.current = null
        }

        getLocalMediaBlob(localMediaId).then((blob) => {
            if (cancelled) return
            if (!blob) {
                setUrl(null)
                return
            }
            const objectUrl = URL.createObjectURL(blob)
            objectUrlRef.current = objectUrl
            setUrl(objectUrl)
        })

        return () => {
            cancelled = true
        }
    }, [localMediaId])

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current)
                objectUrlRef.current = null
            }
        }
    }, [])

    return url
}
