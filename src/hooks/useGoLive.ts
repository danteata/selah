import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { useLiveSession } from './useLiveSession'
import { isMobileViewport } from './useIsMobile'
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
 *
 * In a session, only the operator's device shares its whole deck. Anyone
 * else's slides reach the session through its addToQueue: the operator's deck
 * in an open session, a suggestion in review mode. Without it a contributor's
 * song sent live put only its first slide on the server, outside the deck, so
 * no other device (nor this one after a reload) had the rest of the song.
 *
 * On a phone a panel covers the live view, so going live returns to it.
 */
export function useGoLive() {
    const appendActiveSlides = useAppStore((s) => s.appendActiveSlides)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const { setLiveSlide, addToQueue: shareWithSession, isConnected, isOperator, isOpen, isStrict } = useLiveSession()
    // This device's own additions reach the session only through addToQueue.
    const sharesThroughQueue = isConnected && !isOperator

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
        if (slides.length === 0) return
        appendActiveSlides(slides)
        if (sharesThroughQueue && !isStrict) void shareWithSession(slides.map((s) => s.id))
    }, [appendActiveSlides, sharesThroughQueue, isStrict, shareWithSession])

    /** Append the slides and put the first one live (verse 1 for a song). */
    const addAndGoLive = useCallback((slides: Slide[]) => {
        if (slides.length === 0) return false
        appendActiveSlides(slides)
        const live = goLive(slides[0].id)
        // The live change goes first; the whole song follows into the deck.
        if (live && sharesThroughQueue) void shareWithSession(slides.map((s) => s.id))
        if (live && isMobileViewport()) setActiveNavSection(null)
        return live
    }, [appendActiveSlides, goLive, sharesThroughQueue, shareWithSession, setActiveNavSection])

    return { canGoLive, goLive, addToQueue, addAndGoLive }
}
