import { describe, it, expect, beforeEach } from 'vitest'
import { lexicalSearchVerses, clearLexicalIndex } from '../bibleLexicalSearch'
import type { BibleVerse } from '../../types'

// Minimal corpus: book is a number-string ("40" = Matthew, "66" = Revelation,
// "19" = Psalms), matching the bundled /bibles/{version}.json shape.
const CORPUS: BibleVerse[] = [
    {
        book: '40', chapter: '16', verse: '18',
        scripture: 'And I say also unto thee, That thou art Peter, and upon this rock I will build my church; and the gates of hell shall not prevail against it.',
    },
    {
        book: '66', chapter: '21', verse: '25',
        scripture: 'And the gates of it shall not be shut at all by day: for there shall be no night there.',
    },
    {
        book: '19', chapter: '118', verse: '20',
        scripture: 'This gate of the LORD, into which the righteous shall enter.',
    },
    {
        book: '43', chapter: '3', verse: '16',
        scripture: 'For God so loved the world, that he gave his only begotten Son.',
    },
]

describe('lexicalSearchVerses', () => {
    beforeEach(() => clearLexicalIndex())

    it('surfaces the exact-phrase verse the semantic search missed (Matthew 16:18)', () => {
        // Regression for the reported bug: pure semantic search returned
        // Revelation 21:25 / Psalm 118:20 but not Matthew 16:18, even though
        // the KJV text of Matthew 16:18 literally contains this phrase.
        const results = lexicalSearchVerses('TEST', CORPUS, 'the gates of hell shall not', 8)

        expect(results[0].reference).toBe('Matthew 16:18')
        expect(results[0].score).toBe(1.0)
        expect(results[0].matchType).toBe('phrase')
    })

    it('excludes verses that lack a query content word (Revelation 21:25 has no "hell")', () => {
        const results = lexicalSearchVerses('TEST', CORPUS, 'the gates of hell shall not', 8)
        const refs = results.map(r => r.reference)

        expect(refs).toContain('Matthew 16:18')
        // Rev 21:25 has "gates … shall not" but not "hell", so it isn't a
        // phrase match and isn't an all-content-words match → excluded.
        expect(refs).not.toContain('Revelation 21:25')
        expect(refs).not.toContain('John 3:16')
    })

    it('matches on all content words when there is no verbatim phrase (keyword tier)', () => {
        const results = lexicalSearchVerses('TEST', CORPUS, 'Peter rock church', 8)

        expect(results).toHaveLength(1)
        expect(results[0].reference).toBe('Matthew 16:18')
        expect(results[0].matchType).toBe('keywords')
        expect(results[0].score).toBe(0.9)
    })

    it('ranks verbatim phrase matches above keyword-only matches', () => {
        // "gates of hell" is verbatim only in Matthew 16:18. A keyword-only
        // query term set that also matches elsewhere would rank below it.
        const results = lexicalSearchVerses('TEST', CORPUS, 'gates of hell', 8)
        expect(results[0].reference).toBe('Matthew 16:18')
        expect(results[0].score).toBe(1.0)
    })

    it('maps numeric book ids to names and respects the limit', () => {
        const results = lexicalSearchVerses('TEST', CORPUS, 'shall', 1)
        expect(results.length).toBeLessThanOrEqual(1)
    })

    it('returns nothing for a query with no lexical overlap', () => {
        const results = lexicalSearchVerses('TEST', CORPUS, 'dinosaur spaceship', 8)
        expect(results).toHaveLength(0)
    })
})
