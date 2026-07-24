/**
 * Hybrid verse-search orchestrator (pure).
 *
 *   normalize → reference lookup? → lexical(BM25 + exact-phrase) ∥ dense top-k
 *   → collapse fragments → weighted RRF → promotion tiers → quality guard
 *   → canonical results.
 *
 * The dense retriever is INJECTED (see DenseRetriever) so this module never
 * imports the embedding stack — it stays deterministic and unit-testable, and
 * degrades cleanly to lexical-only when the retriever returns [] (web /
 * versions without an embedding index).
 */

import type { BibleVerse } from '../../types'
import type {
    DenseRetriever, SearchOptions, VerseSearchResult, CanonicalCandidate,
} from './types'
import { DEFAULT_SEARCH_OPTIONS } from './types'
import { normalizeQuery } from './normalizeText'
import { lexicalSearch, getVerseText } from './lexicalSearch'
import { collapseDenseToCanonical, weightedRRF } from './fusion'
import {
    applyQualityGuard, compareCandidates, matchTypeFor, type FusedCandidate,
} from './ranking'
import { parseReference } from './canonicalVerse'
import { parseBibleQuery } from '../../utils/bibleReference'

function toResult(c: FusedCandidate, score: number): VerseSearchResult {
    const parts = parseReference(c.reference)
    return {
        _id: c.reference,
        verseId: c.canonicalVerseId,
        reference: c.reference,
        book: parts.book,
        bookNumber: parts.bookNumber,
        chapter: parts.chapter,
        verse: parts.verse,
        text: c.text,
        score,
        finalScore: score,
        matchType: matchTypeFor(c),
        bm25Score: c.bm25Score,
        cosineSimilarity: c.cosineSimilarity,
        lexicalRank: c.lexicalRank,
        denseRank: c.denseRank,
        matchedClause: c.matchedClause,
    }
}

/** Direct reference lookup ("Matthew 16:18", "Matt 16:18", ranges). */
function resolveReference(
    version: string,
    corpus: BibleVerse[],
    raw: string,
): VerseSearchResult[] | null {
    const parsed = parseBibleQuery(raw)
    if (!parsed) return null

    const results: VerseSearchResult[] = []
    for (let v = parsed.startVerse; v <= parsed.endVerse; v++) {
        const reference = `${parsed.bookName} ${parsed.chapter}:${v}`
        const text = getVerseText(version, corpus, reference)
        if (text) {
            results.push({
                _id: reference,
                verseId: reference,
                reference,
                book: parsed.bookName,
                bookNumber: parsed.bookIndex,
                chapter: parsed.chapter,
                verse: v,
                text,
                score: 1.0,
                finalScore: 1.0,
                matchType: 'reference',
            })
        }
    }
    return results.length > 0 ? results : null
}

export async function searchVerses(
    rawQuery: string,
    corpus: BibleVerse[],
    denseRetriever: DenseRetriever,
    options: Partial<SearchOptions> & { version: string },
): Promise<VerseSearchResult[]> {
    const opts: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS, ...options }
    const query = normalizeQuery(rawQuery)
    if (!query.phrase) return []

    // 1. Explicit reference → direct lookup, ranked above textual retrieval.
    const referenceResults = resolveReference(opts.version, corpus, query.raw)
    if (referenceResults) return referenceResults.slice(0, opts.resultLimit)

    // 2. Lexical + dense retrieval, independently (dense may return []).
    const lex = lexicalSearch(opts.version, corpus, query, opts.lexicalTopK)
    let denseCandidates: CanonicalCandidate[] = []
    try {
        const dense = await denseRetriever(query, opts.denseTopK)
        denseCandidates = collapseDenseToCanonical(dense)
    } catch {
        // Dense unavailable/failed → lexical-only. Backbone still works.
        denseCandidates = []
    }

    // 3. Fuse ranks.
    const fusedMap = weightedRRF({
        lexical: lex.candidates,
        dense: denseCandidates,
        k: opts.rrfK,
        lexicalWeight: opts.lexicalWeight,
        denseWeight: opts.denseWeight,
    })

    // 4. Attach canonical verse text + exact-phrase promotion metadata.
    const fused: FusedCandidate[] = [...fusedMap.values()].map((c) => {
        const text = getVerseText(opts.version, corpus, c.reference) ?? c.text
        const isExactPhrase =
            lex.exactPhraseIds.has(c.canonicalVerseId) &&
            query.tokens.length >= opts.minPhraseTokensForPromotion
        return {
            ...c,
            text,
            isExactPhrase,
            matchedTokenCount: query.tokens.length,
        }
    })

    // An exact-phrase verse might not have entered the BM25 top-K or the dense
    // top-k (long verse, diluted embedding — exactly the Matthew 16:18 case).
    // Ensure every exact-phrase verse is a candidate regardless of fusion.
    for (const id of lex.exactPhraseIds) {
        if (fusedMap.has(id)) continue
        if (query.tokens.length < opts.minPhraseTokensForPromotion) break
        const text = getVerseText(opts.version, corpus, id)
        if (!text) continue
        fused.push({
            canonicalVerseId: id,
            reference: id,
            text,
            rrfScore: 0,
            isExactPhrase: true,
            matchedTokenCount: query.tokens.length,
        })
    }

    // 5. Quality guard, then deterministic ordering.
    const guarded = applyQualityGuard(fused, opts)
    guarded.sort(compareCandidates)

    // 6. Score for display: reference/exact = 1.0/0.99; fused normalized to
    // its own top so the UI "% Match" stays sensible and monotonic.
    const topRrf = Math.max(...guarded.map((c) => c.rrfScore), 0) || 1
    return guarded.slice(0, opts.resultLimit).map((c) => {
        let score: number
        if (c.matchType === 'reference') score = 1.0
        else if (c.isExactPhrase) score = 0.99
        else if (c.cosineSimilarity !== undefined && c.lexicalRank === undefined) score = c.cosineSimilarity
        else score = Math.max(0.5, Math.min(0.95, (c.rrfScore / topRrf) * 0.95))
        return toResult(c, score)
    })
}
