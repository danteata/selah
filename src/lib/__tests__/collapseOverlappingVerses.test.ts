import { describe, it, expect } from 'vitest'
import { collapseOverlappingVerses } from '../collapseOverlappingVerses'
import type { DetectedVerse } from '../../services/sermon-listener'

function verse(
    reference: string,
    book: string,
    chapter: number,
    verseStart: number,
    verseEnd?: number,
    extra: Partial<DetectedVerse> = {},
): DetectedVerse {
    return {
        raw: reference,
        reference,
        book,
        chapter,
        verseStart,
        verseEnd,
        confidence: 'medium',
        startIndex: 0,
        endIndex: 0,
        ...extra,
    } as DetectedVerse
}

const refs = (vs: DetectedVerse[]) => vs.map(v => v.reference)

describe('collapseOverlappingVerses', () => {
    // Every case below appeared together in one live session's queue.
    it('keeps the range over a verse inside it', () => {
        const result = collapseOverlappingVerses([
            verse('Proverbs 24:3', 'Proverbs', 24, 3),
            verse('Proverbs 24:3-4', 'Proverbs', 24, 3, 4),
        ])
        expect(refs(result)).toEqual(['Proverbs 24:3-4'])
    })

    it('collapses regardless of arrival order', () => {
        const result = collapseOverlappingVerses([
            verse('Psalms 34:7-8', 'Psalms', 34, 7, 8),
            verse('Psalms 34:7', 'Psalms', 34, 7),
        ])
        expect(refs(result)).toEqual(['Psalms 34:7-8'])
    })

    it('collapses two singles and a range covering both', () => {
        const result = collapseOverlappingVerses([
            verse('2 Chronicles 7:15', '2 Chronicles', 7, 15),
            verse('2 Chronicles 7:16', '2 Chronicles', 7, 16),
            verse('2 Chronicles 7:15-16', '2 Chronicles', 7, 15, 16),
        ])
        expect(refs(result)).toEqual(['2 Chronicles 7:15-16'])
    })

    it('leaves non-overlapping verses in the same chapter alone', () => {
        const result = collapseOverlappingVerses([
            verse('Deuteronomy 6:6', 'Deuteronomy', 6, 6),
            verse('Deuteronomy 6:9', 'Deuteronomy', 6, 9),
        ])
        expect(refs(result)).toEqual(['Deuteronomy 6:6', 'Deuteronomy 6:9'])
    })

    it('never merges across chapters or books', () => {
        const result = collapseOverlappingVerses([
            verse('Deuteronomy 6:7', 'Deuteronomy', 6, 7),
            verse('Deuteronomy 11:19', 'Deuteronomy', 11, 19),
            verse('Matthew 6:7', 'Matthew', 6, 7),
        ])
        expect(result).toHaveLength(3)
    })

    it('lets a high-confidence narrow match beat a wider low one', () => {
        // A deliberate restatement of one verse should be able to replace the
        // broader range — the carve-out isSpecificityDowngrade also makes.
        const result = collapseOverlappingVerses([
            verse('Deuteronomy 6:6-9', 'Deuteronomy', 6, 6, 9),
            verse('Deuteronomy 6:7', 'Deuteronomy', 6, 7, undefined, { confidence: 'high' }),
        ])
        expect(refs(result)).toEqual(['Deuteronomy 6:7'])
    })

    it('carries isBestMatch onto the survivor from either side', () => {
        const fromNarrow = collapseOverlappingVerses([
            verse('Proverbs 24:3', 'Proverbs', 24, 3, undefined, { isBestMatch: true }),
            verse('Proverbs 24:3-4', 'Proverbs', 24, 3, 4),
        ])
        expect(fromNarrow[0].reference).toBe('Proverbs 24:3-4')
        expect(fromNarrow[0].isBestMatch).toBe(true)

        const fromWide = collapseOverlappingVerses([
            verse('Proverbs 24:3-4', 'Proverbs', 24, 3, 4, { isBestMatch: true }),
            verse('Proverbs 24:3', 'Proverbs', 24, 3),
        ])
        expect(fromWide[0].isBestMatch).toBe(true)
    })

    it('passes through an empty list and a single verse', () => {
        expect(collapseOverlappingVerses([])).toEqual([])
        const one = [verse('John 3:16', 'John', 3, 16)]
        expect(refs(collapseOverlappingVerses(one))).toEqual(['John 3:16'])
    })
})
