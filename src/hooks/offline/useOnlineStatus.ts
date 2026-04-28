import { useState, useEffect, useCallback, useRef } from 'react'

export interface OnlineStatus {
    isOnline: boolean
    isOffline: boolean
    lastOnlineAt: Date | null
    lastOfflineAt: Date | null
    offlineDurationMs: number | null
}

const STORAGE_KEY = 'selah-last-online-at'

function getStoredLastOnlineAt(): Date | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) return new Date(stored)
    } catch {}
    return null
}

function storeLastOnlineAt(date: Date): void {
    try {
        localStorage.setItem(STORAGE_KEY, date.toISOString())
    } catch {}
}

export function useOnlineStatus(): OnlineStatus {
    const [isOnline, setIsOnline] = useState(() => {
        if (typeof navigator === 'undefined') return true
        return navigator.onLine
    })
    const lastOnlineAtRef = useRef<Date | null>(getStoredLastOnlineAt())
    const [lastOfflineAt, setLastOfflineAt] = useState<Date | null>(null)

    const handleOnline = useCallback(() => {
        const now = new Date()
        setIsOnline(true)
        lastOnlineAtRef.current = now
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
            lastOnlineAtRef.current = now
            storeLastOnlineAt(now)
        }

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [handleOnline, handleOffline])

    const offlineDurationMs = !isOnline && lastOfflineAt
        ? Date.now() - lastOfflineAt.getTime()
        : null

    return {
        isOnline,
        isOffline: !isOnline,
        lastOnlineAt: lastOnlineAtRef.current,
        lastOfflineAt,
        offlineDurationMs,
    }
}