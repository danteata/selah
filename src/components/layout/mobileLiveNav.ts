import type { Slide } from '../../types'

/**
 * Where the phone's Prev / Next go, and what's up next.
 *
 * A song is a run of slides, one per section. The phone used to step through
 * the deck alone, so a live song whose slides weren't all in the deck (or
 * weren't in it at all) was lost: "Up next" showed whatever started the deck
 * and Next jumped there, out of the song. A live song now steps through its
 * own slides first, as the desktop's song navigator does, then carries on with
 * the deck after it.
 */
export interface LiveNavigation {
    /** The live song's slides in order, or empty when no song is live. */
    songParts: Slide[]
    /** The live slide's place in its song, or -1. */
    partIndex: number
    prevSlide: Slide | null
    /** What follows the live slide: the rest of its song, then the deck. */
    following: Slide[]
    /** "3 of 6": the place in the song, else in the deck. */
    place: string
}

/** The run of a song's slides around the live one, in the order they were added. */
export function songPartsAround(slides: Slide[], liveSlideId: string | null | undefined): Slide[] {
    const at = slides.findIndex((s) => s.id === liveSlideId)
    const live = slides[at]
    if (at < 0 || live.type !== 'song' || !live.songId) return []
    const samePart = (s: Slide | undefined) => !!s && s.type === 'song' && s.songId === live.songId
    let start = at
    while (samePart(slides[start - 1])) start--
    let end = at
    while (samePart(slides[end + 1])) end++
    return slides.slice(start, end + 1)
}

export function liveNavigation(deck: Slide[], activeSlides: Slide[], liveSlideId: string | null | undefined): LiveNavigation {
    const liveIndex = deck.findIndex((s) => s.id === liveSlideId)
    const songParts = songPartsAround(activeSlides, liveSlideId)
    const partIndex = songParts.findIndex((s) => s.id === liveSlideId)

    if (partIndex < 0) {
        return {
            songParts: [],
            partIndex: -1,
            prevSlide: liveIndex > 0 ? deck[liveIndex - 1] : null,
            // Nothing live yet (or not in the deck): "next" is the start of it.
            following: deck.slice(liveIndex + 1),
            place: liveIndex >= 0 ? `${liveIndex + 1} of ${deck.length}` : '',
        }
    }

    // The deck around the song: before its first slide there, after its last.
    const inSong = new Set(songParts.map((s) => s.id))
    const deckSpots = deck.flatMap((s, i) => (inSong.has(s.id) ? [i] : []))
    const before = deckSpots.length > 0 ? deckSpots[0] - 1 : -1
    const after = deckSpots.length > 0 ? deckSpots[deckSpots.length - 1] + 1 : 0

    return {
        songParts,
        partIndex,
        prevSlide: partIndex > 0 ? songParts[partIndex - 1] : before >= 0 ? deck[before] : null,
        following: [...songParts.slice(partIndex + 1), ...deck.slice(after).filter((s) => !inSong.has(s.id))],
        place: songParts.length > 1 ? `${partIndex + 1} of ${songParts.length}` : '',
    }
}
