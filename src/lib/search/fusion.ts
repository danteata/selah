/**
 * Fragment collapse + weighted Reciprocal Rank Fusion.
 *
 * BM25 scores and cosine similarities live on different, incomparable scales,
 * so we fuse RANKS, not raw scores. RRF is robust to that scale mismatch and
 * needs no per-query calibration. Each retriever contributes
 * weight / (k + rank); a retriever that didn't surface a candidate
 * contributes nothing.
 */

import type { CanonicalCandidate, DenseCandidate } from './types'
import { toCanonicalVerseId } from './canonicalVerse'

/**
 * Collapse dense rows (which may be clause fragments of the same verse) to one
 * entry per canonical verse, keeping the strongest cosine, then assign a
 * dense rank by that best score. Prevents one verse from occupying several
 * ranks and distorting fusion.
 */
export function collapseDenseToCanonical(dense: DenseCandidate[]): CanonicalCandidate[] {
    const best = new Map<string, CanonicalCandidate>()
    for (const d of dense) {
        const id = toCanonicalVerseId(d.canonicalVerseId)
        const existing = best.get(id)
        if (!existing || d.cosineSimilarity > (existing.cosineSimilarity ?? -Infinity)) {
            best.set(id, {
                canonicalVerseId: id,
                reference: id,
                text: d.text,
                cosineSimilarity: d.cosineSimilarity,
                matchedRowId: d.canonicalVerseId,
                matchedClause: d.canonicalVerseId !== id ? d.canonicalVerseId : undefined,
            })
        }
    }
    return [...best.values()]
        .sort((a, b) => (b.cosineSimilarity ?? 0) - (a.cosineSimilarity ?? 0))
        .map((c, i) => ({ ...c, denseRank: i + 1 }))
}

export interface RrfParams {
    lexical: CanonicalCandidate[]
    dense: CanonicalCandidate[]
    k: number
    lexicalWeight: number
    denseWeight: number
}

/**
 * Fuse the two ranked lists into a single set of canonical candidates carrying
 * a fused score plus each retriever's rank/score for downstream promotion,
 * guarding, and debugging.
 */
export function weightedRRF(params: RrfParams): Map<string, CanonicalCandidate & { rrfScore: number }> {
    const { lexical, dense, k, lexicalWeight, denseWeight } = params
    const merged = new Map<string, CanonicalCandidate & { rrfScore: number }>()

    const ensure = (id: string, reference: string, text: string) => {
        let entry = merged.get(id)
        if (!entry) {
            entry = { canonicalVerseId: id, reference, text, rrfScore: 0 }
            merged.set(id, entry)
        }
        return entry
    }

    for (const c of lexical) {
        const rank = c.lexicalRank ?? 0
        if (rank <= 0) continue
        const entry = ensure(c.canonicalVerseId, c.reference, c.text)
        entry.rrfScore += lexicalWeight / (k + rank)
        entry.lexicalRank = rank
        entry.bm25Score = c.bm25Score
    }

    for (const c of dense) {
        const rank = c.denseRank ?? 0
        if (rank <= 0) continue
        const entry = ensure(c.canonicalVerseId, c.reference, c.text)
        entry.rrfScore += denseWeight / (k + rank)
        entry.denseRank = rank
        entry.cosineSimilarity = c.cosineSimilarity
        if (c.matchedClause) entry.matchedClause = c.matchedClause
    }

    return merged
}
