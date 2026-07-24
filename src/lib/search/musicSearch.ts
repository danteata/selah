/**
 * Lexical search for songs & hymns — the same normalize + BM25 machinery the
 * Bible search uses, generalized to any {title, subtitle, body} item.
 *
 * Replaces the old raw `title/lyrics.toLowerCase().includes(query)` filter,
 * which had no ranking, no typo/punctuation/whitespace tolerance, and failed
 * when a remembered lyric line straddled a newline or used curly quotes. Here:
 *  - all text is normalized through the shared `normalizeText` contract,
 *  - BM25 ranks by term rarity/coverage with title & author field-weighted
 *    above lyrics (a title hit outranks an incidental deep-lyric word),
 *  - verbatim title / phrase matches are promoted to the top.
 *
 * The corpus is small and fully client-side, so the index is built from the
 * loaded list (memoize it on the list in the component) and queried per
 * keystroke.
 */

import { Bm25Index } from './bm25'
import { normalizeText } from './normalizeText'

export interface MusicSearchItem {
    /** Unique within the searched set (song._id||id, or hymn.number). */
    id: string
    title: string
    /** Artist / author (+ e.g. hymn number) — field-weighted below body. */
    subtitle?: string
    /** Full searchable text (song lyrics, or hymn chorus + verses). */
    body?: string
}

export interface MusicSearchResult<T> {
    item: T
    score: number
    matchType: 'title' | 'phrase' | 'lexical'
}

interface IndexedDoc<T> {
    item: T
    titleNorm: string
    bodyNorm: string
}

export interface MusicIndex<T> {
    bm25: Bm25Index
    docs: Map<string, IndexedDoc<T>>
}

// Field weighting via token repetition (a cheap, standard BM25 field boost):
// title terms count 3×, author/subtitle 2×, body 1×.
const TITLE_WEIGHT = 3
const SUBTITLE_WEIGHT = 2

function repeat(tokens: string[], times: number): string[] {
    if (times <= 1) return tokens
    const out: string[] = []
    for (let i = 0; i < times; i++) out.push(...tokens)
    return out
}

export function buildMusicIndex<T extends MusicSearchItem>(items: T[]): MusicIndex<T> {
    const docs = new Map<string, IndexedDoc<T>>()
    const bmDocs = items.map((it) => {
        const titleNorm = normalizeText(it.title)
        const subtitleNorm = normalizeText(it.subtitle ?? '')
        const bodyNorm = normalizeText(it.body ?? '')
        docs.set(it.id, { item: it, titleNorm, bodyNorm })
        const titleTokens = titleNorm ? titleNorm.split(' ') : []
        const subtitleTokens = subtitleNorm ? subtitleNorm.split(' ') : []
        const bodyTokens = bodyNorm ? bodyNorm.split(' ') : []
        return {
            id: it.id,
            tokens: [
                ...repeat(titleTokens, TITLE_WEIGHT),
                ...repeat(subtitleTokens, SUBTITLE_WEIGHT),
                ...bodyTokens,
            ],
        }
    })
    return { bm25: new Bm25Index(bmDocs), docs }
}

/**
 * Rank items for `query`. Verbatim title matches rank first, then verbatim
 * body-phrase matches, then BM25-scored token matches. Returns at most
 * `limit`; an empty/whitespace query returns [].
 */
export function searchMusicIndex<T extends MusicSearchItem>(
    index: MusicIndex<T>,
    query: string,
    limit: number,
): MusicSearchResult<T>[] {
    const phrase = normalizeText(query)
    if (!phrase) return []
    const tokens = phrase.split(' ')

    const hits = index.bm25.search(tokens, Math.max(limit * 4, 40))
    const scored = new Map<string, MusicSearchResult<T>>()
    for (const h of hits) {
        const doc = index.docs.get(h.id)
        if (!doc) continue
        scored.set(h.id, { item: doc.item, score: h.score, matchType: 'lexical' })
    }

    // Phrase / title promotion — scan all docs so a verbatim phrase is never
    // lost to BM25 candidate truncation, mirroring the Bible pipeline.
    const needle = ` ${phrase} `
    for (const [id, doc] of index.docs) {
        const inTitle = ` ${doc.titleNorm} `.includes(needle) || doc.titleNorm === phrase
        const inBody = ` ${doc.bodyNorm} `.includes(needle)
        if (!inTitle && !inBody) continue
        const existing = scored.get(id)
        const base = existing?.score ?? 0
        if (inTitle) scored.set(id, { item: doc.item, score: base + 1000, matchType: 'title' })
        else scored.set(id, { item: doc.item, score: base + 100, matchType: 'phrase' })
    }

    return [...scored.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
}

/** Convenience: build + search in one call (small corpora only). */
export function searchMusic<T extends MusicSearchItem>(
    items: T[],
    query: string,
    limit: number,
): MusicSearchResult<T>[] {
    return searchMusicIndex(buildMusicIndex(items), query, limit)
}
