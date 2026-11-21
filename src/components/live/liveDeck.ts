import type { Slide } from '../../types'

/**
 * The live deck: the slides Live steps through, in the order the operator
 * arranged them (`liveOutputSlidesId`), limited to the session's schedule
 * (else the active one) plus unscheduled slides. With no schedule, only the
 * unscheduled ones.
 */
export function liveDeckFor(
    deckIds: string[] | null,
    activeSlides: Slide[],
    scheduleId: string | null | undefined,
): Slide[] {
    if (!deckIds) return []
    const byId = new Map(activeSlides.map((slide) => [slide.id, slide]))
    const slides = deckIds
        .map((id) => byId.get(id))
        .filter((slide): slide is Slide => slide !== undefined)
    if (scheduleId) {
        return slides.filter((slide) => slide.scheduleId === scheduleId || !slide.scheduleId)
    }
    return slides.filter((slide) => !slide.scheduleId)
}

export interface DeckPosition {
    /** Index of the on-air slide in the deck, or -1 when it isn't in it. */
    index: number
    previous: Slide | undefined
    /** The slide after the one on air (GLOSSARY.md: next up). With nothing on
     *  air, or the on-air slide outside the deck, the deck's first slide. */
    nextUp: Slide | undefined
}

export function deckPosition(deck: Slide[], liveSlideId: string | null): DeckPosition {
    const index = liveSlideId ? deck.findIndex((slide) => slide.id === liveSlideId) : -1
    return {
        index,
        previous: index > 0 ? deck[index - 1] : undefined,
        nextUp: deck[index + 1],
    }
}
