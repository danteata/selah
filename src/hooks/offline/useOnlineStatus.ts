import { useState, useEffect, useCallback } from 'react'

export interface OnlineStatus {
    isOnline: boolean
    isOffline: boolean
    lastOnlineAt: Date | null
    lastOfflineAt: Date | null
    /**
     * How long we have been offline, in ms, or null while online.
     *
     * A function rather than a value: computed during render it was both
     * impure and wrong — frozen at whatever the clock said on the last render,
     * so a "offline for 3 minutes" label would sit still until something
     * unrelated re-rendered it. Callers that want it ticking should read this
     * from their own interval.
     */
    getOfflineDurationMs: () => number | null
}

const STORAGE_KEY = 'selah-last-online-at'

function getStoredLastOnlineAt(): Date | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) return new Date(stored)
    } catch {
        // localStorage can throw outright, not just return null: private
        // windows and "block site data" both do. No stored value is a fine
        // answer here.
    }
    return null
}

function storeLastOnlineAt(date: Date): void {
    try {
        localStorage.setItem(STORAGE_KEY, date.toISOString())
    } catch {
        // Same as the read: unavailable storage is not a failure worth
        // surfacing for a diagnostic timestamp.
    }
}

export function useOnlineStatus(): OnlineStatus {
    const [isOnline, setIsOnline] = useState(() => {
        if (typeof navigator === 'undefined') return true
        return navigator.onLine
    })
    // State, not a ref: this is a value a caller would render. Held in a ref it
    // had to be read during render to be returned at all, which is the one
    // thing a ref must not be used for — the read is a snapshot and no later
    // write can update it. Lazily initialised so the localStorage read happens
    // once rather than on every render.
    const [lastOnlineAt, setLastOnlineAt] = useState<Date | null>(getStoredLastOnlineAt)
    const [lastOfflineAt, setLastOfflineAt] = useState<Date | null>(null)

    const handleOnline = useCallback(() => {
        const now = new Date()
        setIsOnline(true)
        setLastOnlineAt(now)
        storeLastOnlineAt(now)
    }, [])

    const handleOffline = useCallback(() => {
        setIsOnline(false)
        setLastOfflineAt(new Date())
    }, [])

    useEffect(() => {
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        const currentOnline = navigator.onLine
        setIsOnline(currentOnline)
        if (currentOnline) {
            const now = new Date()
            setLastOnlineAt(now)
            storeLastOnlineAt(now)
        }

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [handleOnline, handleOffline])

    const getOfflineDurationMs = useCallback(
        () => (!isOnline && lastOfflineAt ? Date.now() - lastOfflineAt.getTime() : null),
        [isOnline, lastOfflineAt],
    )

    return {
        isOnline,
        isOffline: !isOnline,
        lastOnlineAt,
        lastOfflineAt,
        getOfflineDurationMs,
    }
}