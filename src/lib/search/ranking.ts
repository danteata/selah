/**
 * Final ordering: deterministic promotion tiers on top of the fused set, plus
 * the post-fusion quality guard.
 *
 * Ordering (highest first):
 *   1. Explicit Bible-reference match  (direct lookup, not a relevance guess)
 *   2. Exact normalized-phrase match
 *   3. Everything else, by weighted-RRF score
 * with stable canonical tie-breakers. This replaces the old "any lexical
 * overlap beats any semantic hit" behavior: exact matches are promoted, but
 * partial lexical and semantic signals compete fairly through RRF.
 */

import type { CanonicalCandidate, MatchType, SearchOptions } from './types'
import { parseReference } from './canonicalVerse'

export interface FusedCandidate extends CanonicalCandidate {
    rrfScore: number
    isExactPhrase?: boolean
    matchedTokenCount?: number
    /** Set to 'reference' for a direct reference lookup; otherwise derived. */
    matchType?: MatchType
}

const TIER = { reference: 3, exact_phrase: 2, fused: 1 } as const

function tierOf(c: FusedCandidate): number {
    if (c.matchType === 'reference') return TIER.reference
    if (c.isExactPhrase) return TIER.exact_phrase
    return TIER.fused
}

/** Stable comparator: tier → (RRF within fused / coverage within exact) → canonical order. */
export function compareCandidates(a: FusedCandidate, b: FusedCandidate): number {
    const ta = tierOf(a), tb = tierOf(b)
    if (ta !== tb) return tb - ta

    if (ta === TIER.exact_phrase) {
        // Within exact phrase: higher query coverage, then better BM25/dense rank.
        const cov = (b.matchedTokenCount ?? 0) - (a.matchedTokenCount ?? 0)
        if (cov !== 0) return cov
        const lr = (a.lexicalRank ?? Infinity) - (b.lexicalRank ?? Infinity)
        if (lr !== 0) return lr
        const dr = (a.denseRank ?? Infinity) - (b.denseRank ?? Infinity)
        if (dr !== 0) return dr
    } else if (ta === TIER.fused) {
        if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore
    }

    // Canonical Bible order as the final stable tie-break.
    const pa = parseReference(a.reference), pb = parseReference(b.reference)
    return pa.bookNumber - pb.bookNumber || pa.chapter - pb.chapter || pa.verse - pb.verse
}

/**
 * Keep a candidate only if it has a real reason to be shown. This runs AFTER
 * fusion — the RRF score itself is NOT a relevance threshold (it depends on
 * list positions and config), so we gate on concrete evidence instead.
 */
export function applyQualityGuard(candidates: FusedCandidate[], opts: SearchOptions): FusedCandidate[] {
    return candidates.filter((c) => {
        if (c.matchType === 'reference') return true
        if (c.isExactPhrase) return true
        const strongLexical = (c.bm25Score ?? 0) >= opts.lexicalMinScore
        const strongDense = (c.cosineSimilarity ?? 0) >= opts.denseSafetyFloor
        // Appears in BOTH retrievers → agreement is itself a signal.
        const inBoth = c.lexicalRank !== undefined && c.denseRank !== undefined
        return strongLexical || strongDense || inBoth
    })
}

export function matchTypeFor(c: FusedCandidate): MatchType {
    if (c.matchType === 'reference') return 'reference'
    if (c.isExactPhrase) return 'exact_phrase'
    if (c.lexicalRank !== undefined && c.denseRank !== undefined) return 'hybrid'
    if (c.lexicalRank !== undefined) return 'lexical'
    return 'semantic'
}
