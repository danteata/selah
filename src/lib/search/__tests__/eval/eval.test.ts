/**
 * Evaluation harness (CI-safe).
 *
 * Runs the full hybrid pipeline over the labeled fixture and asserts Recall@k
 * / MRR floors. The dense retriever here is a DETERMINISTIC token-overlap stub
 * — it stands in for embeddings so the pipeline's deterministic behavior is
 * locked in without loading the model (which OOMs in this environment).
 *
 * Real semantic quality (paraphrases) must be measured with the actual model
 * in a separate, opt-in script — NOT asserted here. Do not tune RRF weights
 * or thresholds against this stub alone.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { searchVerses } from '../../searchVerses'
import { clearLexicalIndex } from '../../lexicalSearch'
import { normalizeText } from '../../normalizeText'
import { versePartsFromRow } from '../../canonicalVerse'
import type { DenseRetriever } from '../../types'
import { FIXTURE_CORPUS, EVAL_CASES } from './fixture'
import { aggregate, recallAtK } from './metrics'

// Deterministic "semantic" proxy: cosine ≈ token-overlap (Jaccard) between the
// query and each verse. Crude, but stable and dependency-free.
const stubDense: DenseRetriever = async (query, topK) => {
    const q = new Set(query.tokens)
    if (q.size === 0) return []
    return FIXTURE_CORPUS
        .map((v) => {
            const vt = new Set(normalizeText(v.scripture).split(' '))
            let inter = 0
            for (const t of q) if (vt.has(t)) inter++
            const union = q.size + vt.size - inter
            const cosineSimilarity = union > 0 ? inter / union : 0
            const parts = versePartsFromRow(v)
            return { canonicalVerseId: parts.reference, reference: parts.reference, text: v.scripture, cosineSimilarity }
        })
        .filter((c) => c.cosineSimilarity > 0)
        .sort((a, b) => b.cosineSimilarity - a.cosineSimilarity)
        .slice(0, topK)
}

// Lexical-only mode (no embeddings — the web / non-KJV situation).
const noDense: DenseRetriever = async () => []

describe('hybrid searchVerses — evaluation', () => {
    beforeEach(() => clearLexicalIndex())

    it('meets Recall@k / MRR floors on the labeled fixture', async () => {
        const perQuery = []
        for (const c of EVAL_CASES) {
            const results = await searchVerses(c.query, FIXTURE_CORPUS, stubDense, { version: 'TEST' })
            perQuery.push({ results, expectedIds: c.expectedVerseIds })
        }
        const m = aggregate(perQuery)
        // Visible in test output for tracking.
        console.log('[eval] metrics', m)

        expect(m.recallAt1).toBeGreaterThanOrEqual(0.8)
        expect(m.recallAt5).toBeGreaterThanOrEqual(0.9)
        expect(m.mrr).toBeGreaterThanOrEqual(0.85)
    })

    it('reference + exact-quote categories are perfect at rank 1 (deterministic)', async () => {
        const strict = EVAL_CASES.filter(c => c.category === 'reference' || c.category === 'exact_quote')
        for (const c of strict) {
            const results = await searchVerses(c.query, FIXTURE_CORPUS, stubDense, { version: 'TEST' })
            expect(recallAtK(results, c.expectedVerseIds, 1)).toBe(1)
        }
    })

    it('degrades to lexical-only (no dense) without losing exact/keyword recall', async () => {
        const lexicalCases = EVAL_CASES.filter(
            c => c.category !== 'paraphrase' && c.category !== 'no_match'
        )
        for (const c of lexicalCases) {
            const results = await searchVerses(c.query, FIXTURE_CORPUS, noDense, { version: 'TEST' })
            expect(recallAtK(results, c.expectedVerseIds, 5)).toBe(1)
        }
    })

    it('returns nothing for a no-match query', async () => {
        const results = await searchVerses('quantum spaceship dinosaur', FIXTURE_CORPUS, stubDense, { version: 'TEST' })
        expect(results).toHaveLength(0)
    })
})
