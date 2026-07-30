import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type { Slide } from '../types'

/**
 * Putting a slide on the alternate output, from wherever the operator found it.
 *
 * The Bible, dictionary and library panels each build their own slides and then
 * hand them to Add or Live; this is the third peer of those two. Without it the
 * only route to the alternate output was a slide already sitting in the queue,
 * which meant adding something to the queue purely to get it somewhere else.
 *
 * The output holds one slide, replaced each time — no queue of its own yet.
 * Sending the slide that's already there clears it, so the same button both
 * shows and hides.
 */
interface UseSendToAlternateReturn {
    /** Available only while the output carries its own content; when it follows
     *  the main output there is nothing to choose. */
    canSend: boolean
    /** The slide on the output, so a row can show itself as active. */
    currentId: string | null
    isOnAlternate: (slideId: string | null | undefined) => boolean
    /** Send it, or clear the output if this slide is already the one showing. */
    send: (slide: Slide) => void
}

export function useSendToAlternate(): UseSendToAlternateReturn {
    const contentSource = useAppStore((state) => state.alternateOutput.contentSource)
    const current = useAppStore((state) => state.alternateSlide)
    const setAlternateSlide = useAppStore((state) => state.setAlternateSlide)

    const send = useCallback((slide: Slide) => {
        setAlternateSlide(current?.id === slide.id ? null : slide)
    }, [current?.id, setAlternateSlide])

    const isOnAlternate = useCallback(
        (slideId: string | null | undefined) => !!slideId && current?.id === slideId,
        [current?.id],
    )

    return {
        canSend: contentSource === 'independent',
        currentId: current?.id ?? null,
        isOnAlternate,
        send,
    }
}
