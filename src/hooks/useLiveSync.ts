import { useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { useNativeMultiMonitor } from './useNativeMultiMonitor'

const STORAGE_KEY = 'selah-live-state'

/**
 * Subset of settings the live output window actually needs. Memoized so
 * its identity only changes when one of these values actually changes,
 * not on every unrelated settings update. The operator's monitor renders
 * from this same object (SlideView), so it can't drift from the projector.
 *
 * `liveOutputBlanked` rides along in this same object (rather than a
 * separate channel) so it reaches the live window through the exact same
 * paths settings already do: native IPC (`sendSettingsToLive`, below) and
 * the localStorage/BroadcastChannel state used by web-mode windows.
 */
export function useLiveOutputSettings() {
    const liveOutputBlanked = useAppStore((state) => state.liveOutputBlanked)
    const settings = useAppStore((state) => state.settings)
    const visualizerEnabled = useAppStore((state) => state.visualizerEnabled)
    return useMemo(() => ({
        liveWindowFullscreen: settings.liveWindowFullscreen,
        songAndHymnLabelsVisibility: settings.songAndHymnLabelsVisibility,
        defaultFont: settings.defaultFont,
        verseRefPosition: settings.slideStyles?.verseRefPosition,
        verseRefColor: settings.slideStyles?.verseRefColor,
        verseRefBold: settings.slideStyles?.verseRefBold,
        verseRefItalic: settings.slideStyles?.verseRefItalic,
        verseRefUnderline: settings.slideStyles?.verseRefUnderline,
        verseRefSizePercent: settings.slideStyles?.verseRefSizePercent,
        animations: settings.animations ?? true,
        transitionInterval: settings.transitionInterval ?? 0.7,
        visualizerEnabled,
        liveOutputBlanked,
    }), [settings, visualizerEnabled, liveOutputBlanked])
}

export function useLiveSync() {
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
    const { isDesktop, sendSlideToLive, sendSettingsToLive, clearLiveOutput } = useNativeMultiMonitor()
    const hadLiveSlideRef = useRef(false)

    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const activeOverlay = useAppStore((state) => state.activeOverlay)
    const activeAlert = useAppStore((state) => state.activeAlert)

    const liveSlide = useMemo(() => {
        if (!liveSlideId) return null
        return activeSlides.find(slide => slide.id === liveSlideId)
    }, [activeSlides, liveSlideId])

    const liveSettings = useLiveOutputSettings()

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

        // The snapshot is only for a live window opening later; the channel
        // below is what updates an open one. Slides can carry image
        // backgrounds as data URLs, so this can exceed the storage quota — and
        // an exception thrown here, inside an effect, took down the whole
        // operator screen mid-service and skipped the post below as well.
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(liveState))
        } catch (err) {
            console.warn('[useLiveSync] live snapshot not stored:', err)
        }

        broadcastChannelRef.current?.postMessage({
            type: 'state-update',
            state: liveState,
        })
    }, [activeSlides, liveSlideId, liveSettings, activeOverlay, activeAlert])

    useEffect(() => {
        if (!isDesktop) return
        if (liveSlideId && liveSlide) {
            hadLiveSlideRef.current = true
            sendSlideToLive(liveSlideId, liveSlide as unknown as Record<string, unknown>)
        } else if (!liveSlideId && hadLiveSlideRef.current) {
            // "Stop Live Output" / clearing the queue sets no live slide. Only
            // a slide was ever sent to the native window, never its absence,
            // so the congregation kept seeing the last one.
            hadLiveSlideRef.current = false
            void clearLiveOutput('clear')
        }
    }, [isDesktop, liveSlideId, liveSlide, sendSlideToLive, clearLiveOutput])

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