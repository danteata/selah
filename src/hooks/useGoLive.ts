import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { useLiveSession } from './useLiveSession'
import type { Slide } from '../types'

/**
 * Shared "add to queue / go live" actions so every search surface (Bible,
 * songs, hymns, unified) behaves identically:
 *   - Add  → append slides to the queue only.
 *   - Live → append (if new) and put the first slide on the output immediately.
 *
 * Go-live respects collaboration mode (a non-operator in a non-open session
 * cannot push live) and broadcasts the `broadcast-slide` event LiveOutput
 * listens for, so the projection/preview windows update in real time — the
 * same path BibleList's per-result "Live" button already uses.
 */
export function useGoLive() {
    const appendActiveSlides = useAppStore((s) => s.appendActiveSlides)
    const { setLiveSlide, isConnected, isOperator, isOpen } = useLiveSession()

    // Solo users and operators can always push live; in a session a
    // non-operator can only push directly in open mode.
    const canGoLive = !isConnected || isOperator || isOpen

    const goLive = useCallback((slideId: string) => {
        if (!canGoLive) return false
        void setLiveSlide(slideId)
        // Read from the store at call-time so a just-appended slide is found.
        const slide = useAppStore.getState().activeSlides.find((s) => s.id === slideId)
        if (slide) window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
        return true
    }, [canGoLive, setLiveSlide])

    const addToQueue = useCallback((slides: Slide[]) => {
        if (slides.length > 0) appendActiveSlides(slides)
    }, [appendActiveSlides])

    /** Append the slides and put the first one live (verse 1 for a song). */
    const addAndGoLive = useCallback((slides: Slide[]) => {
        if (slides.length === 0) return false
        appendActiveSlides(slides)
        return goLive(slides[0].id)
    }, [appendActiveSlides, goLive])

    return { canGoLive, goLive, addToQueue, addAndGoLive }
}
