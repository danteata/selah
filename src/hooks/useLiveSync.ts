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
    const activeOverlay = useAppStore((state) => state.activeOverlay)
    const activeAlert = useAppStore((state) => state.activeAlert)

    const liveSlide = useMemo(() => {
        if (!liveSlideId) return null
        return activeSlides.find(slide => slide.id === liveSlideId)
    }, [activeSlides, liveSlideId])

    useEffect(() => {
        broadcastChannelRef.current = new BroadcastChannel('selah-live-channel')

        return () => {
            broadcastChannelRef.current?.close()
        }
    }, [])

    useEffect(() => {
        const liveState = {
            slides: activeSlides,
            liveSlideId,
            settings: {
                liveWindowFullscreen: settings.liveWindowFullscreen,
                songAndHymnLabelsVisibility: settings.songAndHymnLabelsVisibility,
                defaultFont: settings.defaultFont,
                verseRefPosition: settings.slideStyles?.verseRefPosition,
                animations: settings.animations ?? true,
                transitionInterval: settings.transitionInterval ?? 0.7,
            },
            overlay: activeOverlay,
            alert: activeAlert,
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(liveState))

        broadcastChannelRef.current?.postMessage({
            type: 'state-update',
            state: liveState,
        })
    }, [activeSlides, liveSlideId, settings, activeOverlay, activeAlert])

    useEffect(() => {
        if (isDesktop && liveSlideId && liveSlide) {
            sendSlideToLive(liveSlideId, liveSlide as unknown as Record<string, unknown>)
        }
    }, [isDesktop, liveSlideId, liveSlide, sendSlideToLive])

    const broadcastSlideUpdate = (slideId: string) => {
        broadcastChannelRef.current?.postMessage({
            type: 'slide-update',
            slideId,
        })
    }

    return { broadcastSlideUpdate }
}