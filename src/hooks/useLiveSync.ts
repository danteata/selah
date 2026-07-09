import { useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { useNativeMultiMonitor } from './useNativeMultiMonitor'

const STORAGE_KEY = 'selah-live-state'

export function useLiveSync() {
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
    const { isDesktop, sendSlideToLive, sendSettingsToLive } = useNativeMultiMonitor()

    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const settings = useAppStore((state) => state.settings)
    const activeOverlay = useAppStore((state) => state.activeOverlay)
    const activeAlert = useAppStore((state) => state.activeAlert)

    const liveSlide = useMemo(() => {
        if (!liveSlideId) return null
        return activeSlides.find(slide => slide.id === liveSlideId)
    }, [activeSlides, liveSlideId])

    // Subset of settings the live output window actually needs. Memoized so
    // its identity only changes when one of these values actually changes,
    // not on every unrelated settings update.
    const liveSettings = useMemo(() => ({
        liveWindowFullscreen: settings.liveWindowFullscreen,
        songAndHymnLabelsVisibility: settings.songAndHymnLabelsVisibility,
        defaultFont: settings.defaultFont,
        verseRefPosition: settings.slideStyles?.verseRefPosition,
        animations: settings.animations ?? true,
        transitionInterval: settings.transitionInterval ?? 0.7,
    }), [settings])

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
            settings: liveSettings,
            overlay: activeOverlay,
            alert: activeAlert,
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(liveState))

        broadcastChannelRef.current?.postMessage({
            type: 'state-update',
            state: liveState,
        })
    }, [activeSlides, liveSlideId, liveSettings, activeOverlay, activeAlert])

    useEffect(() => {
        if (isDesktop && liveSlideId && liveSlide) {
            sendSlideToLive(liveSlideId, liveSlide as unknown as Record<string, unknown>)
        }
    }, [isDesktop, liveSlideId, liveSlide, sendSlideToLive])

    // Desktop's live window is a separate native WebviewWindow — it can't be
    // relied on to receive BroadcastChannel/localStorage `storage` events the
    // way two tabs of the same origin would, so push settings over native IPC
    // too (mirrors the sendSlideToLive effect above).
    useEffect(() => {
        if (isDesktop) {
            sendSettingsToLive(liveSettings)
        }
    }, [isDesktop, liveSettings, sendSettingsToLive])

    const broadcastSlideUpdate = (slideId: string) => {
        broadcastChannelRef.current?.postMessage({
            type: 'slide-update',
            slideId,
        })
    }

    return { broadcastSlideUpdate }
}