import type { BibleVerse, Scripture, Slide } from '../types'

export interface QueuedBibleSlideMatch {
    slide: Slide
    /**
     * The queued slide holds text that is no longer what should be shown — it
     * covers a narrower span of the passage now being read, or it is a
     * placeholder the caller asked to supersede. The caller rewrites it in place
     * rather than queueing a second, overlapping entry.
     */
    needsRefresh: boolean
}

/** The verse span a scripture covers, or null if it isn't a single-chapter verse list. */
function spanOf(scripture: Scripture | undefined): { book: string; chapter: string; start: number; end: number } | null {
    const content = scripture?.content
    if (!Array.isArray(content) || content.length === 0) return null

    const verses: number[] = []
    const { book, chapter } = content[0] as BibleVerse
    for (const verse of content as BibleVerse[]) {
        // A span across chapter boundaries has no single (book, chapter) to
        // compare against, so fall back to label-only matching for it.
        if (verse.book !== book || verse.chapter !== chapter) return null
        const n = Number(verse.verse)
        if (!Number.isFinite(n)) return null
        verses.push(n)
    }
    if (verses.length === 0) return null

    return { book, chapter, start: Math.min(...verses), end: Math.max(...verses) }
}

/**
 * Find the slide already queued for a scripture reference.
 *
 * `appendActiveSlide` dedupes on `slide.id`, and every detection path mints a
 * fresh id before appending — so a passage the preacher returns to queued a new
 * slide on every mention. `collapseOverlappingVerses` only governs the detected
 * verse LIST; the queue was built independently and kept the duplicates (one
 * live session ended with Psalms 34:7, 2 Chronicles 7:15 and Deuteronomy 6:6
 * each queued twice against a clean list of 10).
 *
 * Two ways a reference is already queued:
 *
 *  - Same label. Matching ignores the version: the same passage in a different
 *    version is the same queue entry, and the caller refreshes its text in place
 *    rather than stacking a second copy.
 *
 *  - The queued slide holds a NARROWER span of the same chapter. One passage
 *    routinely arrives twice at different widths: announcing "Proverbs 24" then
 *    "three through four" navigates to 24:3, and the regex pass then resolves
 *    the full 24:3-4 range from the same sentence. That queued 24:3 beside
 *    24:3-4, and 34:7 beside 34:7-8 — four slides for two passages. Widening
 *    the queued slide keeps one entry per passage, which is the same "the wider
 *    span is what the speaker announced" rule collapseOverlappingVerses applies
 *    to the detected list. Auto-detect slides render only their first verse, so
 *    a widened slide shows exactly what it showed before.
 *
 *  - `supersedesLabel` names a slide the caller knows is a placeholder for this
 *    very reference: the verse 1 a bare "Book Chapter" announcement resolves to,
 *    now that the verse actually being announced has arrived. Only the caller
 *    can know this — a verse-1 slide is otherwise a legitimate queue entry.
 *
 * Narrowing is deliberately NOT a match. Reusing a queued range for a single
 * verse inside it would put the range's text on screen when the operator's
 * detection was the one verse, and quietly changing what the congregation reads
 * is not a queue-tidying decision.
 *
 * A slide the operator has dropped from the live output order is never reused —
 * reviving it would put the verse back on screen from a deck the operator
 * already curated it out of, so the caller queues a fresh slide.
 */
export function findQueuedBibleSlide(
    slides: Slide[],
    scripture: Scripture | undefined,
    liveOutputSlidesId: string[] | null,
    supersedesLabel?: string | null,
): QueuedBibleSlideMatch | undefined {
    const label = scripture?.label
    if (!label) return undefined

    // null/absent order means "no curated deck yet" — every active slide is in
    // the queue. Only an explicit order can exclude one.
    const queued = slides.filter((slide) =>
        slide?.type === 'bible' && (!liveOutputSlidesId || liveOutputSlidesId.includes(slide.id)),
    )

    const sameReference = queued.find((slide) => (slide.data as Scripture | undefined)?.label === label)
    if (sameReference) return { slide: sameReference, needsRefresh: false }

    if (supersedesLabel) {
        const placeholder = queued.find((slide) => (slide.data as Scripture | undefined)?.label === supersedesLabel)
        if (placeholder) return { slide: placeholder, needsRefresh: true }
    }

    const incoming = spanOf(scripture)
    if (!incoming) return undefined

    const narrower = queued.find((slide) => {
        const existing = spanOf(slide.data as Scripture | undefined)
        if (!existing) return false
        if (existing.book !== incoming.book || existing.chapter !== incoming.chapter) return false
        const contained = incoming.start <= existing.start && existing.end <= incoming.end
        const strictly = incoming.start < existing.start || existing.end < incoming.end
        return contained && strictly
    })

    return narrower ? { slide: narrower, needsRefresh: true } : undefined
}
