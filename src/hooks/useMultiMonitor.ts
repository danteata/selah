/**
 * React hook for multi-monitor support
 */
import { useState, useEffect, useCallback } from 'react'
import {
    multiMonitorService,
    type ScreenInfo,
    type MultiMonitorState,
} from '../services/multi-monitor'

export function useMultiMonitor() {
    const [state, setState] = useState<MultiMonitorState>(multiMonitorService.getState())
    const [isLoading, setIsLoading] = useState(false)

    // Subscribe to state changes
    useEffect(() => {
        const unsubscribe = multiMonitorService.subscribe(setState)
        return unsubscribe
    }, [])

    // Detect available screens
    const detectScreens = useCallback(async () => {
        setIsLoading(true)
        try {
            const screens = await multiMonitorService.detectScreens()
            return screens
        } finally {
            setIsLoading(false)
        }
    }, [])

    // Open live view on a specific screen
    const openLiveViewOnScreen = useCallback(async (screenId: string, currentSlideId?: string) => {
        const liveViewUrl = `${window.location.origin}/live`
        return multiMonitorService.openLiveViewOnScreen(screenId, liveViewUrl, currentSlideId)
    }, [])

    // Start presentation using Presentation API
    const startPresentation = useCallback(async () => {
        const liveViewUrl = `${window.location.origin}/live`
        return multiMonitorService.startPresentation(liveViewUrl)
    }, [])

    // Terminate current presentation
    const terminatePresentation = useCallback(() => {
        return multiMonitorService.terminatePresentation()
    }, [])

    // Get best screen for live output
    const getBestScreen = useCallback(() => {
        return multiMonitorService.getBestScreenForLive()
    }, [])

    // Broadcast slide update to live window
    const broadcastSlideUpdate = useCallback((slideId: string) => {
        return multiMonitorService.broadcastSlideUpdate(slideId)
    }, [])

    // Check if Presentation API is available
    const isPresentationApiAvailable = useCallback(() => {
        return multiMonitorService.isPresentationApiAvailable()
    }, [])

    // Check if Screen Enumeration API is available
    const isScreenEnumerationAvailable = useCallback(() => {
        return multiMonitorService.isScreenEnumerationAvailable()
    }, [])

    return {
        // State
        screens: state.screens,
        selectedScreenId: state.selectedScreenId,
        isPresenting: state.isPresenting,
        liveWindow: state.liveWindow,
        isLoading,

        // Actions
        detectScreens,
        openLiveViewOnScreen,
        startPresentation,
        terminatePresentation,
        getBestScreen,
        broadcastSlideUpdate,

        // Feature detection
        isPresentationApiAvailable,
        isScreenEnumerationAvailable,
    }
}

export type UseMultiMonitorReturn = ReturnType<typeof useMultiMonitor>