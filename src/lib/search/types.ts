/**
 * Shared types for the hybrid verse-search pipeline.
 *
 * The pipeline is: normalize → (reference | exact-phrase | lexical BM25 +
 * dense top-k) → collapse fragments to canonical verses → weighted RRF →
 * promotion → quality guard → ranked results. Everything except the dense
 * retriever is pure and deterministic so it can be unit-tested and evaluated
 * without the embedding model.
 */

/** Two representations of the user's query. `phrase` keeps stop words so
 *  exact quotations ("shall not prevail") match; `tokens` feed BM25. */
export interface NormalizedQuery {
    raw: string
    phrase: string
    tokens: string[]
}

/** A verse identified canonically (fragment/clause rows collapse to this). */
export interface CanonicalCandidate {
    canonicalVerseId: string
    reference: string
    text: string
    bm25Score?: number
    cosineSimilarity?: number
    /** 1-based rank within each retriever (best = 1); absent if not retrieved. */
    lexicalRank?: number
    denseRank?: number
    /** The row that produced the match (clause id), for highlighting/debug. */
    matchedRowId?: string
    matchedClause?: string
}

export type MatchType = 'reference' | 'exact_phrase' | 'hybrid' | 'lexical' | 'semantic'

export interface VerseSearchResult {
    _id: string
    verseId: string
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
    text: string
    /** Unified ranking score for display ("% Match"): 1.0 reference/exact,
     *  otherwise the fused/retriever score. */
    score: number
    finalScore: number
    matchType: MatchType
    bm25Score?: number
    cosineSimilarity?: number
    lexicalRank?: number
    denseRank?: number
    matchedClause?: string
}

/** A single dense (embedding) hit, as returned by the injected retriever. */
export interface DenseCandidate {
    canonicalVerseId: string
    reference: string
    text: string
    cosineSimilarity: number
    matchedRowId?: string
}

/** Injected so the pure orchestrator never imports the embedding stack.
 *  Returns [] when no embedding index exists for this version/platform. */
export type DenseRetriever = (query: NormalizedQuery, topK: number) => Promise<DenseCandidate[]>

export interface SearchOptions {
    version: string
    resultLimit: number
    lexicalTopK: number
    denseTopK: number
    rrfK: number
    lexicalWeight: number
    denseWeight: number
    /** Permissive dense floor — a sanity gate only, NOT the relevance cutoff. */
    denseSafetyFloor: number
    /** Min BM25 score for a lexical-only candidate to survive the guard. */
    lexicalMinScore: number
    /** Min content tokens before exact-phrase promotion applies. */
    minPhraseTokensForPromotion: number
}

export const DEFAULT_SEARCH_OPTIONS: Omit<SearchOptions, 'version'> = {
    resultLimit: 8,
    lexicalTopK: 80,
    denseTopK: 100,
    rrfK: 60,
    lexicalWeight: 1.2,
    denseWeight: 1.0,
    denseSafetyFloor: 0.30,
    lexicalMinScore: 1.0,
    minPhraseTokensForPromotion: 2,
}
