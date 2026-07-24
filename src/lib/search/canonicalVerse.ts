/**
 * Canonical verse identity. Dense embeddings include clause fragments with
 * ids like "Matthew 16:18__clause_4"; users must see one canonical verse, not
 * several fragment rows. These helpers map any row id to its canonical verse
 * and format references consistently from the number-string `book` field used
 * in the bundled /bibles/{version}.json corpus.
 */

import { NUMBER_TO_BOOK } from '../../services/sermon-listener/verseDetection'
import type { BibleVerse } from '../../types'

/** Strip a "__clause_N" (or any "__…") fragment suffix to the base verse ref. */
export function toCanonicalVerseId(rowId: string): string {
    const idx = rowId.indexOf('__')
    return idx === -1 ? rowId : rowId.slice(0, idx)
}

/** True when the row id carries a fragment/clause suffix. */
export function isClauseRow(rowId: string): boolean {
    return rowId.includes('__')
}

export interface CanonicalVerseParts {
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
}

/** Resolve a bundled corpus row (book as number-string) to canonical parts. */
export function versePartsFromRow(v: BibleVerse): CanonicalVerseParts {
    const bookNumber = Number(v.book)
    const book = (Number.isFinite(bookNumber) && NUMBER_TO_BOOK[bookNumber]) || String(v.book)
    const chapter = Number(v.chapter)
    const verse = Number(v.verse)
    return {
        reference: `${book} ${chapter}:${verse}`,
        book,
        bookNumber: Number.isFinite(bookNumber) ? bookNumber : 0,
        chapter,
        verse,
    }
}

/** Parse "Book Chapter:Verse" back into sortable parts for tie-breaking. */
export function parseReference(reference: string): { bookNumber: number; chapter: number; verse: number; book: string } {
    const m = reference.match(/^(.+)\s+(\d+):(\d+)$/)
    if (!m) return { book: reference, bookNumber: 9999, chapter: 0, verse: 0 }
    const book = m[1]
    const bookNumber = BOOK_TO_NUMBER[book] ?? 9999
    return { book, bookNumber, chapter: Number(m[2]), verse: Number(m[3]) }
}

// Reverse of NUMBER_TO_BOOK, for canonical Bible-order tie-breaking.
const BOOK_TO_NUMBER: Record<string, number> = Object.entries(NUMBER_TO_BOOK)
    .reduce((acc, [num, name]) => { acc[name] = Number(num); return acc }, {} as Record<string, number>)
