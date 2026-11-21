import { useCallback, useMemo } from 'react'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventType } from '../../services/analytics/types'
import type { Slide } from '../../types'
import { liveDeckFor, deckPosition, type DeckPosition } from './liveDeck'

export interface LiveDeck extends DeckPosition {
    deck: Slide[]
    liveSlide: Slide | undefined
}

/** The live deck for this desk, and where on air sits in it. */
export function useLiveDeck(): LiveDeck {
    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveOutputSlidesId = useAppStore((state) => state.liveOutputSlidesId)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const { sessionScheduleId } = useLiveSession()

    // Prefer the session's schedule while collaborating.
    const deck = useMemo(
        () => liveDeckFor(liveOutputSlidesId, activeSlides, sessionScheduleId || activeSchedule?._id),
        [liveOutputSlidesId, activeSlides, activeSchedule?._id, sessionScheduleId],
    )
    const liveSlide = useMemo(
        () => activeSlides.find((slide) => slide.id === liveSlideId),
        [activeSlides, liveSlideId],
    )
    const position = useMemo(() => deckPosition(deck, liveSlideId), [deck, liveSlideId])
    return { deck, liveSlide, ...position }
}

export interface OnAir extends LiveDeck {
    /** This desk may change what's on air (not a viewer, or a contributor
     *  outside an open session). */
    canStep: boolean
    /** Put a slide on air: here, in the session, and on the output window. */
    setOnAir: (slideId: string) => void
    /** A contributor in a session that isn't strict can offer a slide to the
     *  operator instead of sending it. */
    canSuggest: boolean
    /** In an open session a suggestion goes straight into the deck ("Add");
     *  otherwise the operator reviews it ("Suggest"). */
    suggestionsAreAdded: boolean
    suggest: (slideId: string) => Promise<void>
}

/** Everything Live needs to show and step what's on air. */
export function useOnAir(): OnAir {
    const liveDeck = useLiveDeck()
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
    const { trackEvent } = useAnalytics()
    const { isDesktop, sendSlideToLive } = useNativeMultiMonitor()
    const {
        isOperator,
        isConnected,
        isOpen,
        isStrict,
        setLiveSlide: setLiveSlideShared,
        addToQueue,
    } = useLiveSession()

    const canStep = !(isConnected && !isOperator && !isOpen)

    const setOnAir = useCallback((slideId: string) => {
        if (!canStep) return

        setLiveSlide(slideId)
        if (isConnected) {
            void setLiveSlideShared(slideId)
        }

        const slide = useAppStore.getState().activeSlides.find((s) => s.id === slideId)
        if (!slide) return
        trackEvent(AnalyticsEventType.SLIDE_DISPLAYED, {
            slide_type: slide.type || 'unknown',
            source: isConnected ? 'collaboration' : 'local',
            layout: slide.layout || 'full_text',
        })
        if (slide.layout === 'lower_third' || slide.layout === 'lower-third') {
            trackEvent(AnalyticsEventType.LOWER_THIRD_DISPLAYED, {
                slide_id: slide.id,
                title: slide.title,
            })
        }
        if (isDesktop) {
            void sendSlideToLive(slideId, slide as unknown as Record<string, unknown>)
        }
        // Other windows, in web mode.
        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
    }, [canStep, setLiveSlide, isConnected, setLiveSlideShared, trackEvent, isDesktop, sendSlideToLive])

    const suggest = useCallback(async (slideId: string) => {
        if (!isConnected || isOperator) return
        try {
            await addToQueue([slideId])
        } catch (err) {
            console.error('[Live] Failed to queue slide:', err)
        }
    }, [isConnected, isOperator, addToQueue])

    return {
        ...liveDeck,
        canStep,
        setOnAir,
        canSuggest: isConnected && !isOperator && !isStrict,
        suggestionsAreAdded: isOpen,
        suggest,
    }
}
