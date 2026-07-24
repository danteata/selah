/**
 * Retrieval metrics for the eval harness: Recall@k, Mean Reciprocal Rank,
 * and no-match precision. Kept dependency-free so both the CI test and the
 * opt-in dense-eval script can share them.
 */

import type { VerseSearchResult } from '../../types'

export function reciprocalRank(results: VerseSearchResult[], expectedIds: string[]): number {
    if (expectedIds.length === 0) return results.length === 0 ? 1 : 0
    const expected = new Set(expectedIds)
    for (let i = 0; i < results.length; i++) {
        if (expected.has(results[i].reference)) return 1 / (i + 1)
    }
    return 0
}

export function recallAtK(results: VerseSearchResult[], expectedIds: string[], k: number): number {
    if (expectedIds.length === 0) return results.length === 0 ? 1 : 0
    const expected = new Set(expectedIds)
    const topK = results.slice(0, k)
    const found = topK.filter((r) => expected.has(r.reference)).length
    return found / expectedIds.length
}

export interface AggregateMetrics {
    n: number
    recallAt1: number
    recallAt5: number
    recallAt10: number
    mrr: number
}

export function aggregate(
    perQuery: Array<{ results: VerseSearchResult[]; expectedIds: string[] }>,
): AggregateMetrics {
    const n = perQuery.length || 1
    let r1 = 0, r5 = 0, r10 = 0, mrr = 0
    for (const q of perQuery) {
        r1 += recallAtK(q.results, q.expectedIds, 1)
        r5 += recallAtK(q.results, q.expectedIds, 5)
        r10 += recallAtK(q.results, q.expectedIds, 10)
        mrr += reciprocalRank(q.results, q.expectedIds)
    }
    return {
        n: perQuery.length,
        recallAt1: r1 / n,
        recallAt5: r5 / n,
        recallAt10: r10 / n,
        mrr: mrr / n,
    }
}
