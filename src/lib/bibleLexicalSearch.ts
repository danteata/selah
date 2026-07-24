/**
 * Lexical (keyword / exact-phrase) Bible search.
 *
 * This complements the semantic embedding search in `useSemanticVerseSearch`.
 * Pure dense-vector retrieval ranks verses by whole-sentence *meaning*, so a
 * verse that literally contains the typed words can still be missed when its
 * overall meaning diverges from the query (e.g. searching "the gates of hell
 * shall not" ranked short verses about gates above Matthew 16:18, whose vector
 * is dominated by "thou art Peter … upon this rock I will build my church").
 *
 * Lexical search closes that recall gap: if the query phrase — or all of its
 * content words — appears verbatim in a verse, that verse is guaranteed to
 * surface. It runs entirely over the locally-bundled verse text
 * (`BibleVerse[]` from `useScripture.downloadBibleVersion`), so it works for
 * EVERY bundled version on both web and desktop, with no embeddings and no
 * network — independent of the KJV/desktop-only semantic pack.
 */

import { getContentWords } from './semanticRetrievalPolicy'
import { NUMBER_TO_BOOK } from '../services/sermon-listener/verseDetection'
import type { BibleVerse } from '../types'

export interface LexicalVerseResult {
    _id: string
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
    text: string
    /**
     * 1.0 for a verbatim phrase match, 0.9 for an all-content-words match.
     * Kept ≥ any realistic semantic cosine (≤ ~0.85) so exact matches rank at
     * the top when merged, and read as a high "% Match" in the UI.
     */
    score: number
    matchType: 'phrase' | 'keywords'
}

const PHRASE_SCORE = 1.0
const KEYWORD_SCORE = 0.9

/** Lowercase, strip punctuation, collapse whitespace. Stop words are KEPT so
 *  exact-phrase substring matching stays faithful to what the user typed. */
function normalizeText(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

interface IndexedVerse {
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
    text: string
    /** ` ${normalizedText} ` — punctuation-stripped, stop words kept, used for
     *  verbatim phrase substring matching. */
    paddedNorm: string
    /** Stop-word-removed, stemmed content words — matched against the query's
     *  content words with the SAME tokenizer so "build"/"built" etc. align. */
    contentSet: Set<string>
}

// One normalized index per version, built lazily on first search and reused.
// Keyed by version id; the corpus for a version never changes at runtime.
const indexCache = new Map<string, IndexedVerse[]>()

function buildIndex(version: string, corpus: BibleVerse[]): IndexedVerse[] {
    const cached = indexCache.get(version)
    if (cached) return cached

    const index: IndexedVerse[] = corpus.map((v) => {
        const bookNumber = Number(v.book)
        // `book` is usually a number-string ("40"); fall back to the raw value
        // if a cached payload stored the name instead.
        const book = (Number.isFinite(bookNumber) && NUMBER_TO_BOOK[bookNumber]) || String(v.book)
        const chapter = Number(v.chapter)
        const verse = Number(v.verse)
        return {
            reference: `${book} ${chapter}:${verse}`,
            book,
            bookNumber: Number.isFinite(bookNumber) ? bookNumber : 0,
            chapter,
            verse,
            text: v.scripture,
            paddedNorm: ` ${normalizeText(v.scripture)} `,
            contentSet: new Set(getContentWords(v.scripture)),
        }
    })
    indexCache.set(version, index)
    return index
}

/** Clear cached indexes (e.g. after a version is re-downloaded). Mostly for tests. */
export function clearLexicalIndex(version?: string): void {
    if (version) indexCache.delete(version)
    else indexCache.clear()
}

/**
 * Rank verses that literally contain the query. Verbatim phrase matches
 * (score 1.0) outrank all-content-words matches (0.9); verses missing any
 * content word are excluded, keeping precision high.
 */
export function lexicalSearchVerses(
    version: string,
    corpus: BibleVerse[],
    query: string,
    limit: number,
): LexicalVerseResult[] {
    const phrase = normalizeText(query)
    if (!phrase) return []

    const index = buildIndex(version, corpus)
    // Content words (stop words removed, stemmed) — same tokenizer applied to
    // each verse, so query and verses compare on equal footing.
    const contentWords = getContentWords(query)
    const paddedPhrase = ` ${phrase}`

    const results: LexicalVerseResult[] = []
    for (const v of index) {
        let score = 0
        let matchType: 'phrase' | 'keywords' | null = null

        if (v.paddedNorm.includes(paddedPhrase)) {
            score = PHRASE_SCORE
            matchType = 'phrase'
        } else if (
            contentWords.length > 0 &&
            contentWords.every((w) => v.contentSet.has(w))
        ) {
            score = KEYWORD_SCORE
            matchType = 'keywords'
        }

        if (matchType) {
            results.push({
                _id: v.reference,
                reference: v.reference,
                book: v.book,
                bookNumber: v.bookNumber,
                chapter: v.chapter,
                verse: v.verse,
                text: v.text,
                score,
                matchType,
            })
        }
    }

    // Phrase matches first, then keyword matches; canonical book/chapter/verse
    // order within a tier so results are stable and read top-to-bottom.
    results.sort((a, b) =>
        b.score - a.score ||
        a.bookNumber - b.bookNumber ||
        a.chapter - b.chapter ||
        a.verse - b.verse
    )
    return results.slice(0, limit)
}
