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
