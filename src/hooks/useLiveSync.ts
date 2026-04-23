/**
 * Hook to sync live state to localStorage and broadcast to other windows
 * This enables the LiveView window to receive updates from the main window
 */
import { useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { useNativeMultiMonitor } from './useNativeMultiMonitor'

const STORAGE_KEY = 'selah-live-state'

export function useLiveSync() {
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
    const { isDesktop, sendSlideToLive } = useNativeMultiMonitor()

    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const settings = useAppStore((state) => state.settings)

    // Get current live slide
    const liveSlide = useMemo(() => {
        if (!liveSlideId) return null
        return activeSlides.find(slide => slide.id === liveSlideId)
    }, [activeSlides, liveSlideId])

    // Initialize BroadcastChannel
    useEffect(() => {
        broadcastChannelRef.current = new BroadcastChannel('selah-live-channel')

        return () => {
            broadcastChannelRef.current?.close()
        }
    }, [])

    // Sync state to localStorage and broadcast changes (Web & Cross-window)
    useEffect(() => {
        const liveState = {
            slides: activeSlides,
            liveSlideId,
            settings: {
                liveWindowFullscreen: settings.liveWindowFullscreen,
                songAndHymnLabelsVisibility: settings.songAndHymnLabelsVisibility,
                defaultFont: settings.defaultFont,
            },
        }

        // Store in localStorage for cross-window access
        localStorage.setItem(STORAGE_KEY, JSON.stringify(liveState))

        // Broadcast to other windows via BroadcastChannel
        broadcastChannelRef.current?.postMessage({
            type: 'state-update',
            state: liveState,
        })
    }, [activeSlides, liveSlideId, settings])

    // Sync to native desktop live window (Tauri)
    useEffect(() => {
        if (isDesktop && liveSlideId && liveSlide) {
            // This ensures that ANY update to the live slide ID (from hook, keyboard, or manual click)
            // is automatically sent to the native presentation window.
            sendSlideToLive(liveSlideId, liveSlide as unknown as Record<string, unknown>)
        }
    }, [isDesktop, liveSlideId, liveSlide, sendSlideToLive])

    // Function to broadcast slide update manually if needed
    const broadcastSlideUpdate = (slideId: string) => {
        broadcastChannelRef.current?.postMessage({
            type: 'slide-update',
            slideId,
        })
    }

    return { broadcastSlideUpdate }
}