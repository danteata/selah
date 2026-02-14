/**
 * Hook to sync live state to localStorage and broadcast to other windows
 * This enables the LiveView window to receive updates from the main window
 */
import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'

const STORAGE_KEY = 'selah-live-state'

export function useLiveSync() {
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null)

    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const settings = useAppStore((state) => state.settings)

    // Initialize BroadcastChannel
    useEffect(() => {
        broadcastChannelRef.current = new BroadcastChannel('selah-live-channel')

        return () => {
            broadcastChannelRef.current?.close()
        }
    }, [])

    // Sync state to localStorage and broadcast changes
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

        // Broadcast to other windows
        broadcastChannelRef.current?.postMessage({
            type: 'state-update',
            state: liveState,
        })
    }, [activeSlides, liveSlideId, settings])

    // Function to broadcast slide update
    const broadcastSlideUpdate = (slideId: string) => {
        broadcastChannelRef.current?.postMessage({
            type: 'slide-update',
            slideId,
        })
    }

    return { broadcastSlideUpdate }
}