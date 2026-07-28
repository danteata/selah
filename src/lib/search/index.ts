export { searchVerses } from './searchVerses'
export { normalizeText, normalizeQuery, tokenize } from './normalizeText'
export { lexicalSearch, clearLexicalIndex, getVerseText } from './lexicalSearch'
export { Bm25Index } from './bm25'
export { collapseDenseToCanonical, weightedRRF } from './fusion'
export { applyQualityGuard, compareCandidates, matchTypeFor } from './ranking'
export { toCanonicalVerseId, isClauseRow, versePartsFromRow } from './canonicalVerse'
export { DEFAULT_SEARCH_OPTIONS } from './types'
export {
    normalizeDictionaryKey, shardForKey, parseDictionaryIndex,
    searchDictionaryIndex, searchDictionaries, formatHeadword,
} from './dictionarySearch'
export type {
    DictionaryIndex, DictionaryIndexRecord, DictionaryMatch, DictionaryMatchType,
    RawDictionaryIndex, RawIndexRecord,
} from './dictionarySearch'
export type {
    NormalizedQuery, CanonicalCandidate, DenseCandidate, DenseRetriever,
    SearchOptions, VerseSearchResult, MatchType,
} from './types'
