import type { DetectedVerse } from '../services/sermon-listener'

/**
 * Collapse detected spans that describe the same passage.
 *
 * Deduping on the reference string alone treats "Proverbs 24:3" and
 * "Proverbs 24:3-4" as unrelated, so a single reading produced both — along
 * with Psalms 34:7 beside 34:7-8, and 2 Chronicles 7:15, 7:16 AND 7:15-16 in
 * one live session. A regex range and the individual verses a semantic pass
 * scores inside it are one passage said once, and the operator wants one entry
 * for it rather than a queue of near-duplicates.
 *
 * The wider span normally wins: it's what the speaker announced, and narrowing
 * to a single verse would drop text already on screen. A high-confidence narrow
 * match is the exception — that's a deliberate restatement, the same carve-out
 * `isSpecificityDowngrade` makes.
 *
 * `isBestMatch` is sticky: if either side of a collapse held it, the survivor
 * keeps it, so merging can never silently drop the display selection.
 */
export function collapseOverlappingVerses(verses: DetectedVerse[]): DetectedVerse[] {
    const span = (v: DetectedVerse) => ({
        start: v.verseStart,
        end: v.verseEnd ?? v.verseStart,
    })

    const collapsed: DetectedVerse[] = []
    for (const verse of verses) {
        const s = span(verse)
        const overlapIdx = collapsed.findIndex((other) => {
            if (other.book !== verse.book || other.chapter !== verse.chapter) return false
            const o = span(other)
            return o.start <= s.end && s.start <= o.end
        })

        if (overlapIdx === -1) {
            collapsed.push(verse)
            continue
        }

        const other = collapsed[overlapIdx]
        const o = span(other)
        const verseIsHigh = verse.confidence === 'high'
        const otherIsHigh = other.confidence === 'high'
        const verseWins = verseIsHigh !== otherIsHigh
            ? verseIsHigh
            : s.end - s.start > o.end - o.start

        if (verseWins) {
            const survivor = {
                ...verse,
                isBestMatch: other.isBestMatch || verse.isBestMatch,
            }
            collapsed[overlapIdx] = survivor

            // Widening can absorb entries that didn't overlap each other. Given
            // 7:15 then 7:16 (disjoint, so both kept), the range 7:15-16 covers
            // both — but a single pass only replaces the one it matched, leaving
            // 7:16 stranded beside it. Sweep the rest against the new span.
            const sSurv = span(survivor)
            for (let i = collapsed.length - 1; i >= 0; i--) {
                if (i === overlapIdx) continue
                const cand = collapsed[i]
                if (cand.book !== survivor.book || cand.chapter !== survivor.chapter) continue
                const c = span(cand)
                if (sSurv.start <= c.end && c.start <= sSurv.end) {
                    if (cand.isBestMatch) collapsed[overlapIdx] = { ...survivor, isBestMatch: true }
                    collapsed.splice(i, 1)
                }
            }
        } else if (verse.isBestMatch) {
            collapsed[overlapIdx] = { ...other, isBestMatch: true }
        }
    }
    return collapsed
}
