import { describe, it, expect, beforeEach } from 'vitest'
import { searchVerses } from '../searchVerses'
import { clearLexicalIndex } from '../lexicalSearch'
import { normalizeText, normalizeQuery, tokenize } from '../normalizeText'
import { Bm25Index } from '../bm25'
import { collapseDenseToCanonical, weightedRRF } from '../fusion'
import { toCanonicalVerseId } from '../canonicalVerse'
import type { DenseRetriever, CanonicalCandidate } from '../types'
import { FIXTURE_CORPUS } from './eval/fixture'

const noDense: DenseRetriever = async () => []
const refs = (rs: { reference: string }[]) => rs.map(r => r.reference)

describe('normalizeText', () => {
    it('lowercases, strips punctuation, collapses whitespace', () => {
        expect(normalizeText('And the GATES  of hell!')).toBe('and the gates of hell')
    })
    it('folds curly apostrophes/quotes', () => {
        expect(normalizeText('God’s “word”')).toBe('god s word')
    })
    it('preserves negations and stop words', () => {
        expect(tokenize('shall not prevail')).toEqual(['shall', 'not', 'prevail'])
    })
    it('handles empty input', () => {
        expect(normalizeQuery('   ').tokens).toEqual([])
    })
})

describe('Bm25Index', () => {
    it('ranks the doc with more/rarer query terms higher', () => {
        const idx = new Bm25Index([
            { id: 'a', tokens: 'the gates of hell shall not prevail'.split(' ') },
            { id: 'b', tokens: 'the gates shall not be shut'.split(' ') },
            { id: 'c', tokens: 'in the beginning god created'.split(' ') },
        ])
        const hits = idx.search('gates hell prevail'.split(' '), 3)
        expect(hits[0].id).toBe('a')
        expect(hits.find(h => h.id === 'c')).toBeUndefined()
    })
})

describe('canonical + fusion', () => {
    it('collapses clause rows to the base verse keeping best cosine', () => {
        expect(toCanonicalVerseId('Matthew 16:18__clause_4')).toBe('Matthew 16:18')
        const collapsed = collapseDenseToCanonical([
            { canonicalVerseId: 'Matthew 16:18__clause_4', reference: 'Matthew 16:18', text: 'x', cosineSimilarity: 0.6 },
            { canonicalVerseId: 'Matthew 16:18', reference: 'Matthew 16:18', text: 'x', cosineSimilarity: 0.8 },
        ])
        expect(collapsed).toHaveLength(1)
        expect(collapsed[0].cosineSimilarity).toBe(0.8)
        expect(collapsed[0].denseRank).toBe(1)
    })

    it('weighted RRF sums rank contributions from both retrievers', () => {
        const lexical: CanonicalCandidate[] = [{ canonicalVerseId: 'v1', reference: 'v1', text: '', lexicalRank: 1 }]
        const dense: CanonicalCandidate[] = [
            { canonicalVerseId: 'v2', reference: 'v2', text: '', denseRank: 1 },
            { canonicalVerseId: 'v1', reference: 'v1', text: '', denseRank: 2 },
        ]
        const fused = weightedRRF({ lexical, dense, k: 60, lexicalWeight: 1.2, denseWeight: 1.0 })
        // v1 is in both → outranks v2 which is dense-only.
        expect(fused.get('v1')!.rrfScore).toBeGreaterThan(fused.get('v2')!.rrfScore)
    })
})

describe('searchVerses — integration', () => {
    beforeEach(() => clearLexicalIndex())

    it('REGRESSION: "the gates of hell shall not" returns Matthew 16:18 first', async () => {
        const results = await searchVerses('the gates of hell shall not', FIXTURE_CORPUS, noDense, { version: 'T' })
        expect(results[0].reference).toBe('Matthew 16:18')
        expect(results[0].matchType).toBe('exact_phrase')
    })

    it('surfaces the exact-phrase verse even when dense ranks other "gates" verses', async () => {
        // Dense loves Revelation 21:25 (also "gates … shall not"); exact phrase
        // must still promote Matthew 16:18 above it.
        const denseFavorsRev: DenseRetriever = async () => ([
            { canonicalVerseId: 'Revelation 21:25', reference: 'Revelation 21:25', text: '', cosineSimilarity: 0.9 },
            { canonicalVerseId: 'Psalms 118:20', reference: 'Psalms 118:20', text: '', cosineSimilarity: 0.7 },
        ])
        const results = await searchVerses('the gates of hell shall not', FIXTURE_CORPUS, denseFavorsRev, { version: 'T' })
        expect(results[0].reference).toBe('Matthew 16:18')
    })

    it('resolves explicit references (incl. abbreviations) as a direct lookup', async () => {
        const full = await searchVerses('Matthew 16:18', FIXTURE_CORPUS, noDense, { version: 'T' })
        expect(full[0].reference).toBe('Matthew 16:18')
        expect(full[0].matchType).toBe('reference')

        const abbr = await searchVerses('Matt 16:18', FIXTURE_CORPUS, noDense, { version: 'T' })
        expect(abbr[0].reference).toBe('Matthew 16:18')
    })

    it('resolves a verse range', async () => {
        const results = await searchVerses('Matthew 16:18-19', FIXTURE_CORPUS, noDense, { version: 'T' })
        expect(refs(results)).toEqual(['Matthew 16:18', 'Matthew 16:19'])
    })

    it('keyword query finds the right verse without an exact phrase', async () => {
        const results = await searchVerses('gates shut day night', FIXTURE_CORPUS, noDense, { version: 'T' })
        expect(results[0].reference).toBe('Revelation 21:25')
    })

    it('returns [] for a no-match query rather than unrelated verses', async () => {
        const results = await searchVerses('quantum spaceship dinosaur', FIXTURE_CORPUS, noDense, { version: 'T' })
        expect(results).toHaveLength(0)
    })

    // A deterministic "semantic" proxy (token-overlap) standing in for the
    // embedding model, so these tests exercise the fused pipeline.
    const BOOK_NAMES: Record<string, string> = { '1': 'Genesis', '19': 'Psalms', '40': 'Matthew', '43': 'John', '66': 'Revelation' }
    const overlapDense: DenseRetriever = async (query) => {
        const q = new Set(query.tokens)
        return FIXTURE_CORPUS
            .map((v) => {
                const vt = new Set(v.scripture.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean))
                let inter = 0
                for (const t of q) if (vt.has(t)) inter++
                const cosineSimilarity = inter / (q.size + vt.size - inter || 1)
                const reference = `${BOOK_NAMES[v.book] ?? v.book} ${v.chapter}:${v.verse}`
                return { canonicalVerseId: reference, reference, text: v.scripture, cosineSimilarity }
            })
            .filter((x) => x.cosineSimilarity > 0)
            .sort((a, b) => b.cosineSimilarity - a.cosineSimilarity)
    }

    it('REGRESSION (#2): exact-phrase dwelling query ranks the target, not a house/lord flood', async () => {
        const results = await searchVerses('i will dwell in the house of the lord', FIXTURE_CORPUS, noDense, { version: 'T' })
        expect(results[0].reference).toBe('Psalms 23:6')
        expect(results[0].matchType).toBe('exact_phrase')
    })

    it('REGRESSION (#2): a common-word paraphrase does not flood with identical scores', async () => {
        // "be" (not "dwell") → no verbatim phrase, only common words house/lord.
        // The old keyword tier returned every house+lord verse at an identical
        // 90%, ordered by Bible position (a wall of Genesis). The hybrid must
        // instead rank them with varied scores.
        const results = await searchVerses('i will be in the house of the lord', FIXTURE_CORPUS, overlapDense, { version: 'T' })
        expect(results.length).toBeGreaterThan(0)
        expect(results.length).toBeLessThanOrEqual(8)
        // Not all the same score (the flood symptom).
        expect(new Set(results.map((r) => Math.round(r.score * 100))).size).toBeGreaterThan(1)
        // A house-of-the-LORD Psalm outranks the Genesis "house" decoys.
        const psalmRank = results.findIndex((r) => r.reference === 'Psalms 23:6' || r.reference === 'Psalms 27:4')
        const genesisRank = results.findIndex((r) => r.reference.startsWith('Genesis'))
        expect(psalmRank).toBeGreaterThanOrEqual(0)
        if (genesisRank >= 0) expect(psalmRank).toBeLessThan(genesisRank)
    })

    it('does not emit clause ids as separate results', async () => {
        const denseClauses: DenseRetriever = async () => ([
            { canonicalVerseId: 'Matthew 16:18__clause_4', reference: 'Matthew 16:18', text: '', cosineSimilarity: 0.8 },
            { canonicalVerseId: 'Matthew 16:18', reference: 'Matthew 16:18', text: '', cosineSimilarity: 0.7 },
        ])
        const results = await searchVerses('rock church', FIXTURE_CORPUS, denseClauses, { version: 'T' })
        const matthew = results.filter(r => r.reference === 'Matthew 16:18')
        expect(matthew).toHaveLength(1)
        expect(results.every(r => !r.reference.includes('__'))).toBe(true)
    })
})
