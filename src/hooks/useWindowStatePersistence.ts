/**
 * Hook for window state persistence
 * 
 * Saves and restores window positions across app sessions
 */

import { useEffect, useCallback, useRef } from 'react'
import { nativeMultiMonitorService, type WindowState } from '../services/native-multi-monitor'

const STORAGE_KEY = 'selah-window-state'

export function useWindowStatePersistence() {
    const initialized = useRef(false)

    // Load saved state on mount
    useEffect(() => {
        if (initialized.current) return
        initialized.current = true

        const loadState = async () => {
            const isDesktop = await nativeMultiMonitorService.isDesktop()
            if (!isDesktop) return

            // Try to load from localStorage first (faster)
            const savedState = localStorage.getItem(STORAGE_KEY)
            if (savedState) {
                try {
                    const state = JSON.parse(savedState) as WindowState
                    await nativeMultiMonitorService.saveWindowState(state)
                } catch (e) {
                    console.warn('Failed to parse saved window state:', e)
                }
            }

            // Restore main window position
            await nativeMultiMonitorService.restoreMainWindowState()
        }

        loadState()
    }, [])

    // Save state before unload
    useEffect(() => {
        const saveState = async () => {
            const isDesktop = await nativeMultiMonitorService.isDesktop()
            if (!isDesktop) return

            // Update main window state
            await nativeMultiMonitorService.updateMainWindowState()

            // Get current state
            const state = await nativeMultiMonitorService.getWindowState()

            // Save to localStorage for next session
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
        }

        const handleBeforeUnload = () => {
            saveState()
        }

        // Save on window close/unload
        window.addEventListener('beforeunload', handleBeforeUnload)

        // Also save periodically (every 30 seconds)
        const interval = setInterval(saveState, 30000)

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
            clearInterval(interval)
        }
    }, [])

    // Manual save function
    const saveState = useCallback(async () => {
        const isDesktop = await nativeMultiMonitorService.isDesktop()
        if (!isDesktop) return

        await nativeMultiMonitorService.updateMainWindowState()
        const state = await nativeMultiMonitorService.getWindowState()
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }, [])

    // Manual load function
    const loadState = useCallback(async () => {
        const isDesktop = await nativeMultiMonitorService.isDesktop()
        if (!isDesktop) return

        await nativeMultiMonitorService.restoreMainWindowState()
    }, [])

    // Clear saved state
    const clearState = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY)
    }, [])

    return {
        saveState,
        loadState,
        clearState,
    }
}

export type UseWindowStatePersistenceReturn = ReturnType<typeof useWindowStatePersistence>
