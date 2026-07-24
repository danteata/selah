/**
 * Lexical retrieval: BM25 ranking + exact-phrase detection over the locally
 * bundled canonical verse text. Works for every version on web and desktop,
 * with no embeddings and no network — this is the reliable backbone of the
 * hybrid pipeline; dense retrieval only enhances it when an index exists.
 */

import type { BibleVerse } from '../../types'
import type { CanonicalCandidate, NormalizedQuery } from './types'
import { normalizeText } from './normalizeText'
import { versePartsFromRow } from './canonicalVerse'
import { Bm25Index } from './bm25'

interface VersionIndex {
    bm25: Bm25Index
    byId: Map<string, { reference: string; text: string; paddedNorm: string }>
}

// Built once per version and reused (the corpus never changes at runtime).
const indexCache = new Map<string, VersionIndex>()

/** Clear cached indexes (after a re-download, or in tests). */
export function clearLexicalIndex(version?: string): void {
    if (version) indexCache.delete(version)
    else indexCache.clear()
}

function buildIndex(version: string, corpus: BibleVerse[]): VersionIndex {
    const cached = indexCache.get(version)
    if (cached) return cached

    const byId = new Map<string, { reference: string; text: string; paddedNorm: string }>()
    const docs = corpus.map((v) => {
        const parts = versePartsFromRow(v)
        const norm = normalizeText(v.scripture)
        byId.set(parts.reference, {
            reference: parts.reference,
            text: v.scripture,
            paddedNorm: ` ${norm} `,
        })
        return { id: parts.reference, tokens: norm ? norm.split(' ') : [] }
    })

    const built: VersionIndex = { bm25: new Bm25Index(docs), byId }
    indexCache.set(version, built)
    return built
}

export interface LexicalSearchResult {
    /** BM25-ranked candidates (canonical verses). */
    candidates: CanonicalCandidate[]
    /** Canonical ids whose text contains the verbatim normalized phrase. */
    exactPhraseIds: Set<string>
}

/**
 * Return the top BM25 candidates plus the set of verses containing the exact
 * normalized phrase. Exact-phrase detection scans the full corpus (not just
 * the BM25 top-K) so a verbatim quote can never be missed by candidate
 * truncation.
 */
export function lexicalSearch(
    version: string,
    corpus: BibleVerse[],
    query: NormalizedQuery,
    topK: number,
): LexicalSearchResult {
    if (!query.phrase) return { candidates: [], exactPhraseIds: new Set() }
    const index = buildIndex(version, corpus)

    const hits = index.bm25.search(query.tokens, topK)
    const candidates: CanonicalCandidate[] = hits.map((h, i) => {
        const doc = index.byId.get(h.id)!
        return {
            canonicalVerseId: h.id,
            reference: h.id,
            text: doc.text,
            bm25Score: h.score,
            lexicalRank: i + 1,
        }
    })

    // Exact-phrase scan over the whole corpus (cheap substring test).
    const exactPhraseIds = new Set<string>()
    const needle = ` ${query.phrase} `
    // A single word ("mercy") isn't a "phrase" worth verbatim promotion;
    // require ≥2 tokens here and let BM25 handle single-word queries.
    if (query.tokens.length >= 2) {
        for (const [id, doc] of index.byId) {
            if (doc.paddedNorm.includes(needle)) exactPhraseIds.add(id)
        }
    }

    return { candidates, exactPhraseIds }
}

/** Look up a single canonical verse's text (for reference resolution). */
export function getVerseText(version: string, corpus: BibleVerse[], reference: string): string | null {
    const index = buildIndex(version, corpus)
    return index.byId.get(reference)?.text ?? null
}
