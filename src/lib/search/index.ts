export { searchVerses } from './searchVerses'
export { normalizeText, normalizeQuery, tokenize } from './normalizeText'
export { lexicalSearch, clearLexicalIndex, getVerseText } from './lexicalSearch'
export { Bm25Index } from './bm25'
export { collapseDenseToCanonical, weightedRRF } from './fusion'
export { applyQualityGuard, compareCandidates, matchTypeFor } from './ranking'
export { toCanonicalVerseId, isClauseRow, versePartsFromRow } from './canonicalVerse'
export { DEFAULT_SEARCH_OPTIONS } from './types'
export type {
    NormalizedQuery, CanonicalCandidate, DenseCandidate, DenseRetriever,
    SearchOptions, VerseSearchResult, MatchType,
} from './types'
