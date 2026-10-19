import type { Scripture, Slide } from '../types'
import { bibleBooks } from '../types'
import { BOOK_MAX_VERSES } from '../services/sermon-listener/verseDetection'

/** The book, chapter and verse range a Bible slide shows. */
export interface BibleSlideRange {
    bookIndex: number
    bookName: string
    chapter: number
    startVerse: number
    endVerse: number
    /** The slide's own version, if it names one. */
    version?: string
}

/**
 * Read a Bible slide's range from its short label ("43:3:16-18" is John
 * 3:16-18). Null for any other slide, or one whose label doesn't parse.
 */
export function bibleSlideRange(slide: Slide | null | undefined): BibleSlideRange | null {
    if (!slide || slide.type !== 'bible') return null
    const data = slide.data as Scripture | undefined
    const parts = data?.labelShortFormat?.split(':')
    if (!parts || parts.length < 3) return null

    const bookIndex = parseInt(parts[0])
    const chapter = parseInt(parts[1])
    const [start, end] = parts[2].split('-')
    const startVerse = parseInt(start)
    const endVerse = end === undefined ? startVerse : parseInt(end)

    return {
        bookIndex,
        bookName: bibleBooks[bookIndex - 1] || '',
        chapter,
        startVerse,
        endVerse,
        version: data?.version,
    }
}

/**
 * The range one step before or after, the same width: v16-18 steps to v19-21.
 * Stays in the chapter, as the desktop navigator does; null past either end.
 */
export function steppedRange(range: BibleSlideRange, direction: 'prev' | 'next'): { startVerse: number; endVerse: number } | null {
    const width = range.endVerse - range.startVerse + 1
    if (direction === 'prev') {
        if (range.startVerse <= 1) return null
        const startVerse = Math.max(1, range.startVerse - width)
        return { startVerse, endVerse: startVerse + width - 1 }
    }
    const chapterMax = BOOK_MAX_VERSES[range.bookName]?.[range.chapter - 1]
    if (chapterMax && range.endVerse >= chapterMax) return null
    return { startVerse: range.startVerse + width, endVerse: range.endVerse + width }
}
