import fuzzysort from 'fuzzysort'
import { bibleBooks } from '../types'

/**
 * Normalize a free-form bible reference (typed or spoken) into canonical
 * "Book C:V" form so the existing parser can match it.
 *
 * Transformations applied:
 *   "John 3 16"      → "John 3:16"        (digit-space-digit → colon)
 *   "John 3 : 16"    → "John 3:16"        (collapse spaces around colon)
 *   "John 3 16 20"   → "John 3:16-20"     (digit-space-digit-space-digit → colon-dash)
 *   "John 3, 16"     → "John 3:16"        (commas in reference → colon)
 *
 * Non-reference text (e.g. "God so loved the world") is left untouched,
 * so this helper is safe to call on every search-input change.
 */
export function normalizeBibleReference(input: string): string {
    if (!input) return input
    let out = input

    // Range pattern: "Book N V W" (book, chapter, verse1, verse2 — all
    // separated by spaces, optional comma/dash). The first and second
    // numbers together identify the chapter, the third and fourth are
    // a verse range. Matches "John 3 16 20", "John 3, 16 to 20",
    // "John 3 16-20", etc.
    out = out.replace(
        /\b((?:\d\s?)?[a-z]+)\s+(\d+)\s*[:.,-]?\s*(\d+)\s*(?:-|to|through|,)\s*(\d+)/i,
        (_m, book, ch, v1, v2) => `${book} ${ch}:${v1}-${v2}`,
    )

    // 3-number pattern with no separator: "John 3 16 20" — most
    // likely a range because the third number is the end verse. We
    // bail if the second number is too large to be a chapter (rare
    // but e.g. "John 3 16 30" should still be a range, while a
    // sentence like "love 5 6 7" should not be touched).
    out = out.replace(
        /\b((?:\d\s?)?[a-z]+)\s+(\d+)\s+(\d+)\s+(\d+)\b/i,
        (_m, book, ch, v1, v2) => {
            const chapter = parseInt(ch, 10)
            // Only treat as a range if the second number is a plausible
            // chapter (< 200) and the verse numbers are small (< 200).
            // This keeps e.g. "Psalm 119 105" alone but converts
            // "John 3 16 20" → "John 3:16-20".
            if (chapter > 200 || parseInt(v1, 10) > 200 || parseInt(v2, 10) > 200) {
                return _m
            }
            return `${book} ${ch}:${v1}-${v2}`
        },
    )

    // Single reference pattern: "Book N V" or "Book N, V" or "Book N : V"
    // → "Book N:V". The separator is OPTIONAL because users (and STT) often
    // write "John 3 16" without a colon. To keep that working while rejecting
    // the bad split "John 316" → "John 31:6" / "John 31 6" → "John 31:6",
    // we validate ch against the book's max-chapter when the separator
    // is missing. If ch > maxChapter, we leave the match alone — it's
    // almost certainly a STT artifact, not a real reference.
    out = out.replace(
        /\b((?:\d\s?)?[a-z]+)\s+(\d+)(\s*[:.,x×]|vs\.?|verse)?\s*(\d+)\b/i,
        (_m, book, ch, sep, v) => {
            if (!sep) {
                const resolved = resolveBookName(book)
                const maxChapter = resolved ? BOOK_CHAPTER_COUNTS[resolved.bookName] : undefined
                const chapterNum = parseInt(ch, 10)
                if (maxChapter !== undefined && chapterNum > maxChapter) {
                    return _m
                }
            }
            return `${book} ${ch}:${v}`
        },
    )

    // Tidy up whitespace from any of the above.
    out = out.replace(/\s+/g, ' ').trim()

    return out
}

export const bookAbbreviations: Record<string, string> = {
    'gen': 'Genesis', 'ex': 'Exodus', 'exod': 'Exodus', 'lev': 'Leviticus',
    'num': 'Numbers', 'deut': 'Deuteronomy', 'dt': 'Deuteronomy',
    'josh': 'Joshua', 'judg': 'Judges', 'ruth': 'Ruth',
    '1sam': '1 Samuel', '1sa': '1 Samuel', '2sam': '2 Samuel', '2sa': '2 Samuel',
    '1kgs': '1 Kings', '1ki': '1 Kings', '2kgs': '2 Kings', '2ki': '2 Kings',
    '1chr': '1 Chronicles', '1ch': '1 Chronicles', '2chr': '2 Chronicles', '2ch': '2 Chronicles',
    'ezra': 'Ezra', 'neh': 'Nehemiah', 'esth': 'Esther', 'est': 'Esther',
    'job': 'Job', 'ps': 'Psalms', 'psa': 'Psalms', 'psalm': 'Psalms',
    'prov': 'Proverbs', 'pr': 'Proverbs', 'eccl': 'Ecclesiastes', 'ec': 'Ecclesiastes',
    'song': 'Song of Solomon', 'sos': 'Song of Solomon', 'isa': 'Isaiah',
    'jer': 'Jeremiah', 'lam': 'Lamentations', 'ezek': 'Ezekiel', 'dan': 'Daniel',
    'hos': 'Hosea', 'joel': 'Joel', 'amos': 'Amos', 'obad': 'Obadiah', 'ob': 'Obadiah',
    'jon': 'Jonah', 'mic': 'Micah', 'nah': 'Nahum', 'hab': 'Habakkuk',
    'zeph': 'Zephaniah', 'hag': 'Haggai', 'zech': 'Zechariah', 'zec': 'Zechariah',
    'mal': 'Malachi',
    'mt': 'Matthew', 'matt': 'Matthew', 'mk': 'Mark', 'mrk': 'Mark',
    'lk': 'Luke', 'luk': 'Luke', 'jn': 'John', 'joh': 'John',
    'acts': 'Acts', 'act': 'Acts', 'rom': 'Romans', 'ro': 'Romans',
    '1cor': '1 Corinthians', '1co': '1 Corinthians', '2cor': '2 Corinthians', '2co': '2 Corinthians',
    'gal': 'Galatians', 'ga': 'Galatians', 'eph': 'Ephesians', 'ep': 'Ephesians',
    'phil': 'Philippians', 'php': 'Philippians', 'col': 'Colossians',
    '1thess': '1 Thessalonians', '1th': '1 Thessalonians', '2thess': '2 Thessalonians', '2th': '2 Thessalonians',
    '1tim': '1 Timothy', '1ti': '1 Timothy', '2tim': '2 Timothy', '2ti': '2 Timothy',
    'tit': 'Titus', 'titus': 'Titus', 'phlm': 'Philemon', 'philem': 'Philemon',
    'heb': 'Hebrews', 'jas': 'James', 'jam': 'James', 'james': 'James',
    '1pet': '1 Peter', '1pe': '1 Peter', '1pt': '1 Peter', '2pet': '2 Peter', '2pe': '2 Peter', '2pt': '2 Peter',
    '1jn': '1 John', '1joh': '1 John', '1john': '1 John', '2jn': '2 John', '2joh': '2 John', '2john': '2 John',
    '3jn': '3 John', '3joh': '3 John', '3john': '3 John', 'jude': 'Jude', 'rev': 'Revelation',
    'revelations': 'Revelation', 'revelation': 'Revelation',
}

export interface ParsedBibleQuery {
    bookIndex: number
    bookName: string
    chapter: number
    startVerse: number
    endVerse: number
}

export function resolveBookName(input: string): { bookIndex: number; bookName: string } | null {
    const lower = input.toLowerCase().trim()
    if (!lower) return null
    const noSpace = lower.replace(/\s+/g, '')
    const fromAbbr = bookAbbreviations[noSpace]
    if (fromAbbr) {
        const idx = bibleBooks.indexOf(fromAbbr as typeof bibleBooks[number])
        if (idx >= 0) return { bookIndex: idx + 1, bookName: fromAbbr }
    }
    const found = bibleBooks.find(b => b.toLowerCase() === lower || b.toLowerCase().startsWith(lower))
    if (found) {
        const idx = bibleBooks.indexOf(found as typeof bibleBooks[number])
        if (idx >= 0) return { bookIndex: idx + 1, bookName: found }
    }
    return null
}

export const BOOK_CHAPTER_COUNTS: Record<string, number> = {
    Genesis: 50, Exodus: 40, Leviticus: 27, Numbers: 36, Deuteronomy: 34,
    Joshua: 24, Judges: 21, Ruth: 4, '1 Samuel': 31, '2 Samuel': 24,
    '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36, Ezra: 10,
    Nehemiah: 13, Esther: 10, Job: 42, Psalms: 150, Proverbs: 31,
    Ecclesiastes: 12, 'Song of Solomon': 8, Isaiah: 66, Jeremiah: 52, Lamentations: 5,
    Ezekiel: 48, Daniel: 12, Hosea: 14, Joel: 3, Amos: 9,
    Obadiah: 1, Jonah: 4, Micah: 7, Nahum: 3, Habakkuk: 3,
    Zephaniah: 3, Haggai: 2, Zechariah: 14, Malachi: 4,
    Matthew: 28, Mark: 16, Luke: 24, John: 21, Acts: 28,
    Romans: 16, '1 Corinthians': 16, '2 Corinthians': 13, Galatians: 6, Ephesians: 6,
    Philippians: 4, Colossians: 4, '1 Thessalonians': 5, '2 Thessalonians': 3, '1 Timothy': 6,
    '2 Timothy': 4, Titus: 3, Philemon: 1, Hebrews: 13, James: 5,
    '1 Peter': 5, '2 Peter': 3, '1 John': 5, '2 John': 1, '3 John': 1,
    Jude: 1, Revelation: 22,
}

export function getNextChapter(book: string, chapter: number): { book: string; chapter: number } | null {
    const max = BOOK_CHAPTER_COUNTS[book]
    if (!max) return null
    if (chapter < max) {
        return { book, chapter: chapter + 1 }
    }
    const idx = bibleBooks.indexOf(book as typeof bibleBooks[number])
    if (idx >= 0 && idx < bibleBooks.length - 1) {
        return { book: bibleBooks[idx + 1], chapter: 1 }
    }
    return null
}

export function getPreviousChapter(book: string, chapter: number): { book: string; chapter: number } | null {
    if (chapter > 1) {
        return { book, chapter: chapter - 1 }
    }
    const idx = bibleBooks.indexOf(book as typeof bibleBooks[number])
    if (idx > 0) {
        const prevBook = bibleBooks[idx - 1]
        const prevMax = BOOK_CHAPTER_COUNTS[prevBook]
        return prevMax ? { book: prevBook, chapter: prevMax } : null
    }
    return null
}

/**
 * Step the chapter by `delta`, rolling across book boundaries when it runs
 * off either end (e.g. stepping +1 from the last chapter of John lands on
 * Acts 1). Reuses `getNextChapter`/`getPreviousChapter` so the book-boundary
 * logic lives in one place. Stops at the very start/end of the canon.
 */
export function stepChapter(bookIndex: number, chapter: number, delta: number): { bookIndex: number; chapter: number } {
    const book = bibleBooks[bookIndex - 1]
    if (!book) return { bookIndex, chapter }
    let cursor: { book: string; chapter: number } = { book, chapter }
    const step = delta > 0 ? getNextChapter : getPreviousChapter
    for (let i = 0; i < Math.abs(delta); i++) {
        const next = step(cursor.book, cursor.chapter)
        if (!next) break
        cursor = next
    }
    const idx = bibleBooks.indexOf(cursor.book as typeof bibleBooks[number])
    return { bookIndex: idx >= 0 ? idx + 1 : bookIndex, chapter: cursor.chapter }
}

/** Step the book by `delta`, clamped to the 66-book canon. */
export function stepBook(bookIndex: number, delta: number): number {
    return Math.min(bibleBooks.length, Math.max(1, bookIndex + delta))
}

/**
 * Clamp a verse number: never below 1, and — when the caller knows which
 * verses are actually loaded for the chapter — never above the highest
 * loaded verse. There is no static verse-per-chapter table, so the upper
 * bound is best-effort from what the panel has already fetched.
 */
export function clampVerse(verse: number, loadedVerseNumbers?: number[]): number {
    let v = Math.max(1, Math.floor(verse))
    if (loadedVerseNumbers && loadedVerseNumbers.length > 0) {
        const max = Math.max(...loadedVerseNumbers)
        if (v > max) v = max
    }
    return v
}

/**
 * Canonical query string for a reference — "Book C:V" or "Book C:V-W".
 * Centralizes the label-building that BibleList and QuickBibleBar both did
 * inline, so the text input and the stepper chips always agree.
 */
export function formatReferenceQuery(bookIndex: number, chapter: number, startVerse: number, endVerse?: number): string {
    const book = bibleBooks[bookIndex - 1] ?? ''
    const rangePart = endVerse && endVerse !== startVerse ? `-${endVerse}` : ''
    return `${book} ${chapter}:${startVerse}${rangePart}`
}

export function parseBibleQuery(q: string): ParsedBibleQuery | null {
    // Strip trailing sentence punctuation ("John 3:16." from voice dictation,
    // or a stray typed period) — the patterns below are $-anchored, so a
    // trailing "." would otherwise fail the match and the reference wouldn't
    // be recognized.
    const trimmed = q.trim().replace(/[.,;!?]+$/, '')
    if (!trimmed) return null

    const fullPattern = /^((?:\d\s?)?[a-z]+)\s+(\d+):(\d+)(?:-(\d+))?$/i
    const match = trimmed.match(fullPattern)
    if (match) {
        const bookInput = match[1].toLowerCase()
        const chapter = parseInt(match[2])
        const startVerse = parseInt(match[3])
        const endVerse = match[4] ? parseInt(match[4]) : startVerse
        const resolved = resolveBookName(bookInput)
        if (resolved) {
            return { ...resolved, chapter, startVerse, endVerse }
        }
    }

    const numericPattern = /^(\d+):(\d+):(\d+)(?:-(\d+))?$/
    const numMatch = trimmed.match(numericPattern)
    if (numMatch) {
        const bookIndex = parseInt(numMatch[1])
        const bookName = bibleBooks[bookIndex - 1]
        if (bookName) {
            return {
                bookIndex,
                bookName,
                chapter: parseInt(numMatch[2]),
                startVerse: parseInt(numMatch[3]),
                endVerse: numMatch[4] ? parseInt(numMatch[4]) : parseInt(numMatch[3]),
            }
        }
    }

    return null
}

/**
 * Parse a fully written-out reference such as "Exodus 4:14",
 * "1 Samuel 2:3-5", "Song of Solomon 2:1" or "Leviticus 8".
 *
 * `parseBibleQuery` is tuned for what an operator types into a search box, so
 * its book pattern is one word with an optional leading digit — which is every
 * book except "Song of Solomon". This is for references quoted in prose, as
 * dictionary entries cite them: split the trailing numbers off first, then
 * resolve whatever precedes them as a book name, however many words that takes.
 *
 * Two shapes that only show up in cited references:
 *   "Leviticus 8"        — a whole chapter, resolved to its first verse, the
 *                          same convention the Bible panel uses for a bare
 *                          chapter.
 *   "Judges 8:33-9:6"    — a span crossing a chapter boundary. Selah's
 *                          Scripture model holds one chapter, so this resolves
 *                          to the opening verse. Showing 8:33 alone is right;
 *                          showing 8:33-8:6 or spilling into the next chapter
 *                          would put wrong text under a correct-looking label.
 */
export function parseFullBibleReference(reference: string): ParsedBibleQuery | null {
    const trimmed = reference.trim().replace(/[.,;!?]+$/, '')
    if (!trimmed) return null

    const direct = parseBibleQuery(trimmed)
    if (direct) return direct

    const crossChapter = trimmed.match(/^(.+?)\s+(\d+):(\d+)\s*-\s*\d+:\d+$/)
    if (crossChapter) {
        const resolved = resolveBookName(crossChapter[1])
        if (!resolved) return null
        const startVerse = parseInt(crossChapter[3])
        return { ...resolved, chapter: parseInt(crossChapter[2]), startVerse, endVerse: startVerse }
    }

    const withVerse = trimmed.match(/^(.+?)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?$/)
    if (withVerse) {
        const resolved = resolveBookName(withVerse[1])
        if (!resolved) return null
        const startVerse = parseInt(withVerse[3])
        return {
            ...resolved,
            chapter: parseInt(withVerse[2]),
            startVerse,
            endVerse: withVerse[4] ? parseInt(withVerse[4]) : startVerse,
        }
    }

    const chapterOnly = trimmed.match(/^(.+?)\s+(\d+)$/)
    if (chapterOnly) {
        const resolved = resolveBookName(chapterOnly[1])
        if (!resolved) return null
        return { ...resolved, chapter: parseInt(chapterOnly[2]), startVerse: 1, endVerse: 1 }
    }

    return null
}

/**
 * What pressing Enter in the Bible panel should do.
 *
 * The panel keeps its result rows on screen while you type — that is what makes
 * the arrow keys and the verse stepper work — and its lookup is debounced by
 * 500ms. Put together, a fast typer can press Enter while the rows still belong
 * to an earlier prefix of the query: entering "John 11:35" quickly used to
 * present whatever "John 1" had loaded.
 *
 * The decision is here rather than in the keydown handler so it can be tested
 * directly; the component only maps the result onto its present/queue/search
 * calls.
 *
 * - `typed`  the query names a reference the rows don't belong to, so act on
 *            what was typed and ignore the rows. This covers two ways the rows
 *            can be wrong: they were fetched for an earlier prefix of the query,
 *            or they are semantic matches for a partial query and no reference
 *            has been fetched at all.
 * - `row`    the rows are current, so act on the highlighted one. This is what
 *            keeps a deliberate arrow-key selection working: the operator can
 *            arrow to a neighbouring verse and Enter presents *that* verse,
 *            because the rows still match what's typed.
 * - `search` the query isn't a reference and nothing is on screen — run the
 *            search rather than guessing.
 * - `none`   nothing to act on.
 */
export type BibleEnterAction =
    | { kind: 'typed'; reference: ParsedBibleQuery }
    | { kind: 'row'; index: number }
    | { kind: 'search' }
    | { kind: 'none' }

export interface BibleEnterInput {
    /** Current contents of the search box. */
    query: string
    /** The reference the visible rows were fetched for, if any. */
    loadedAnchor: { bookIndex: number; chapter: number; startVerse: number } | null
    /** How many result rows are on screen. */
    rowCount: number
    /** Highlighted row, or -1 when none has been focused. */
    focusedIndex: number
    /** Whether a search has already run for this query. */
    hasSearched: boolean
}

export function resolveEnterAction({
    query,
    loadedAnchor,
    rowCount,
    focusedIndex,
    hasSearched,
}: BibleEnterInput): BibleEnterAction {
    const parsed = parseBibleQuery(normalizeBibleReference(query))

    if (parsed) {
        // No rows have been fetched for a reference yet, so whatever is on screen
        // is a semantic (meaning) match for a partial query — those persist while
        // a reference is being typed, and presenting one puts a verse on the
        // screen that was never asked for.
        if (!loadedAnchor) return { kind: 'typed', reference: parsed }

        const rowsMatchQuery =
            loadedAnchor.bookIndex === parsed.bookIndex &&
            loadedAnchor.chapter === parsed.chapter &&
            loadedAnchor.startVerse === parsed.startVerse
        if (!rowsMatchQuery) return { kind: 'typed', reference: parsed }
    }

    if (rowCount > 0) {
        // Rows are shown with one highlighted, so an unfocused list acts on the
        // first — no throwaway keystroke needed to select it.
        return { kind: 'row', index: focusedIndex >= 0 ? focusedIndex : 0 }
    }

    if (!hasSearched) return { kind: 'search' }

    return { kind: 'none' }
}

export function getBookSuggestions(query: string): string[] {
    if (!query || query.includes(':')) return []
    const lq = query.toLowerCase().trim()
    const am = bookAbbreviations[lq]
    if (am) return [am]
    return bibleBooks.filter(b => b.toLowerCase().startsWith(lq) || b.toLowerCase().includes(lq)).slice(0, 5)
}

// Shortest known abbreviation per book, used purely as a display hint in the
// autocomplete (e.g. "John · jn"). Built once from `bookAbbreviations`.
const bookToAbbrev: Record<string, string> = (() => {
    const m: Record<string, string> = {}
    for (const [abbr, name] of Object.entries(bookAbbreviations)) {
        if (!m[name] || abbr.length < m[name].length) m[name] = abbr
    }
    return m
})()

export interface RankedBookSuggestion {
    book: string
    /** 1-based book number (matches the index convention used everywhere). */
    bookIndex: number
    matchType: 'abbrev' | 'prefix' | 'fuzzy'
    /** A short abbreviation to show as a hint, if one exists. */
    abbrev?: string
    /** Indexes into `book` that matched the query — for character highlighting. */
    matchIndexes?: number[]
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

/**
 * Ranked, fuzzy book suggestions for the search-input autocomplete.
 *
 * Ranking, best first: exact abbreviation (e.g. "jn" → John) > canonical
 * prefix match (in bible order, so "jo" yields Job, John, Joel, Jonah,
 * Joshua before fuzzier hits) > `fuzzysort` fuzzy match for everything
 * else (e.g. "corin" → 1/2 Corinthians, "rvln" → Revelation).
 *
 * Distinct from `getBookSuggestions` (kept as-is for its callers/tests):
 * this returns structured entries with match type + highlight indexes so
 * the UI can render abbreviations and bold the matched characters.
 */
export function getRankedBookSuggestions(query: string, limit = 6): RankedBookSuggestion[] {
    if (!query) return []
    const lq = query.toLowerCase().trim()
    if (!lq || lq.includes(':')) return []

    const results: RankedBookSuggestion[] = []
    const used = new Set<number>()

    const push = (book: string, matchType: RankedBookSuggestion['matchType'], matchIndexes?: number[]) => {
        const idx = bibleBooks.indexOf(book as typeof bibleBooks[number])
        if (idx < 0 || used.has(idx)) return
        used.add(idx)
        results.push({ book, bookIndex: idx + 1, matchType, abbrev: bookToAbbrev[book], matchIndexes })
    }

    // 1. Exact abbreviation (ignoring internal spaces, e.g. "1 jn" → 1 John).
    const lqNoSpace = lq.replace(/\s+/g, '')
    const abbrHit = bookAbbreviations[lqNoSpace]
    if (abbrHit) push(abbrHit, 'abbrev')

    // 2. Prefix matches, canonical order. Space-insensitive on both sides so a
    //    numbered book types cleanly as it's built — "1j", "1jo", "1john", and
    //    "1 john" all prefix-match "1 John" (the space used to break them).
    for (const b of bibleBooks) {
        if (results.length >= limit) break
        const bl = b.toLowerCase()
        if (bl.startsWith(lq)) push(b, 'prefix', range(lq.length))
        else if (bl.replace(/\s+/g, '').startsWith(lqNoSpace)) push(b, 'prefix')
    }

    // 3. Fuzzy fill for the remainder.
    if (results.length < limit) {
        const pool = bibleBooks.filter((_, i) => !used.has(i))
        const fz = fuzzysort.go(lq, pool, { limit: limit - results.length })
        for (const r of fz) {
            const idxs = (r as { indexes?: ArrayLike<number> }).indexes
            push(r.target, 'fuzzy', idxs ? Array.from(idxs) : undefined)
        }
    }

    return results.slice(0, limit)
}

export interface VerseRow {
    bookIndex: number
    chapter: number
    verse: number
    scripture: string
    reference: string
    displayLabel: string
    isCurrent: boolean
    source: 'reference' | 'semantic' | 'neighbor'
    showChapterHeader: boolean
    chapterHeaderLabel: string
    score?: number
}

export interface BibleVerseLike {
    chapter: number
    verse: number
    scripture: string
}

export interface SemanticResultLike {
    bookNumber: number
    chapter: number
    verse: number
    text: string
    reference: string
    score: number
}

export function buildVerseRows(
    hasSearched: boolean,
    currentBookIndex: number | null,
    currentChapter: number | null,
    currentVerses: BibleVerseLike[],
    neighborVerses: { prev: BibleVerseLike[]; next: BibleVerseLike[] },
    semanticResults: SemanticResultLike[],
): VerseRow[] {
    const rows: VerseRow[] = []
    if (hasSearched && currentBookIndex && currentChapter) {
        let prevChapter: number | null = null
        for (const nv of neighborVerses.prev) {
            const showHeader = prevChapter !== null && nv.chapter !== prevChapter
            const headerLabel = nv.chapter !== currentChapter
                ? `${bibleBooks[currentBookIndex - 1]} ${nv.chapter}`
                : ''
            rows.push({
                bookIndex: currentBookIndex,
                chapter: nv.chapter,
                verse: nv.verse,
                scripture: nv.scripture,
                reference: `${bibleBooks[currentBookIndex - 1]} ${nv.chapter}:${nv.verse}`,
                displayLabel: `${nv.verse}`,
                isCurrent: false,
                source: 'neighbor',
                showChapterHeader: showHeader,
                chapterHeaderLabel: headerLabel,
            })
            prevChapter = nv.chapter
        }
        for (const cv of currentVerses) {
            const showHeader = prevChapter !== null && cv.chapter !== prevChapter
            rows.push({
                bookIndex: currentBookIndex,
                chapter: currentChapter,
                verse: cv.verse,
                scripture: cv.scripture,
                reference: `${bibleBooks[currentBookIndex - 1]} ${currentChapter}:${cv.verse}`,
                displayLabel: `${cv.verse}`,
                isCurrent: true,
                source: 'reference',
                showChapterHeader: showHeader,
                chapterHeaderLabel: '',
            })
            prevChapter = cv.chapter
        }
        for (const nv of neighborVerses.next) {
            const showHeader = nv.chapter !== prevChapter
            const headerLabel = nv.chapter !== currentChapter
                ? `${bibleBooks[currentBookIndex - 1]} ${nv.chapter}`
                : ''
            rows.push({
                bookIndex: currentBookIndex,
                chapter: nv.chapter,
                verse: nv.verse,
                scripture: nv.scripture,
                reference: `${bibleBooks[currentBookIndex - 1]} ${nv.chapter}:${nv.verse}`,
                displayLabel: `${nv.verse}`,
                isCurrent: false,
                source: 'neighbor',
                showChapterHeader: showHeader,
                chapterHeaderLabel: headerLabel,
            })
            prevChapter = nv.chapter
        }
    }
    if (!hasSearched) {
        for (const sr of semanticResults) {
            rows.push({
                bookIndex: sr.bookNumber,
                chapter: sr.chapter,
                verse: sr.verse,
                scripture: sr.text,
                reference: sr.reference,
                displayLabel: sr.reference,
                isCurrent: false,
                source: 'semantic',
                showChapterHeader: false,
                chapterHeaderLabel: '',
                score: sr.score,
            })
        }
    }
    return rows
}