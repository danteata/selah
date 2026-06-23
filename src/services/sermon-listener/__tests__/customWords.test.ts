import { describe, it, expect } from 'vitest'
import { applyCustomWords, SERMON_PROPER_NOUNS, __testing } from '../customWords'

// Ported from Handy's audio_toolkit/text.rs apply_custom_words test suite.

describe('applyCustomWords — basic matching', () => {
    it('corrects to exact custom words', () => {
        expect(applyCustomWords('hello world', ['Hello', 'World'], 0.5)).toBe('Hello World')
    })

    it('corrects fuzzy (typo) matches', () => {
        expect(applyCustomWords('helo wrold', ['hello', 'world'], 0.5)).toBe('hello world')
    })

    it('returns text unchanged when no custom words', () => {
        expect(applyCustomWords('hello world', [], 0.5)).toBe('hello world')
    })
})

describe('applyCustomWords — n-grams', () => {
    it('joins two words into one custom word', () => {
        const result = applyCustomWords('il cui nome è Charge B, che permette', ['ChargeBee'], 0.5)
        expect(result).toContain('ChargeBee,')
        expect(result).not.toContain('Charge B')
    })

    it('joins three words into one custom word', () => {
        const result = applyCustomWords('use Chat G P T for this', ['ChatGPT'], 0.5)
        expect(result).toContain('ChatGPT')
    })

    it('prefers the longer n-gram', () => {
        expect(applyCustomWords('Open AI GPT model', ['OpenAI', 'GPT'], 0.5)).toBe('OpenAI GPT model')
    })

    it('matches a spaced custom word against split words', () => {
        const result = applyCustomWords('using Mac Book Pro', ['MacBook Pro'], 0.5)
        expect(result).toContain('MacBook')
    })
})

describe('applyCustomWords — case & punctuation preservation', () => {
    it('preserves ALL CAPS', () => {
        expect(applyCustomWords('CHARGE B is great', ['ChargeBee'], 0.5)).toContain('CHARGEBEE')
    })

    it('does not double-count trailing numbers/punctuation', () => {
        const result = applyCustomWords('use GPT4 for this', ['GPT-4'], 0.5)
        expect(result).not.toContain('GPT-44')
    })
})

describe('SERMON_PROPER_NOUNS vocabulary (safe always-on profile)', () => {
    const vocab = [...SERMON_PROPER_NOUNS]
    // Mirrors the wiring in useSermonListener: tight threshold, single-token,
    // no phonetic boost — so it corrects near-misses without cross-word collisions.
    const apply = (t: string) => applyCustomWords(t, vocab, 0.25, { maxNgram: 1, usePhonetic: false })

    it('corrects near-miss proper nouns', () => {
        expect(apply('the prophet Methusela lived long')).toContain('Methuselah')
        expect(apply('Paul wrote to the Thessalonia church')).toContain('Thessalonians')
    })

    it('leaves short common words untouched (length pre-filter)', () => {
        const text = 'we look to the book of Mark and the acts of God'
        expect(apply(text)).toBe(text)
    })

    it('does not swallow adjacent words like "of righteousness"', () => {
        const text = 'this is the gift of righteousness through faith'
        expect(apply(text)).toBe(text)
    })

    it('does not collide phonetically (prophet stays prophet)', () => {
        const text = 'the prophet spoke with great propitiation'
        expect(apply(text)).toBe(text)
    })

    it('does not alter ordinary sermon prose', () => {
        const text = 'today we will talk about grace and the love of the Father'
        expect(apply(text)).toBe(text)
    })
})

describe('customWords — internal helpers', () => {
    it('preserveCasePattern matches Handy semantics', () => {
        const { preserveCasePattern } = __testing
        expect(preserveCasePattern('HELLO', 'world')).toBe('WORLD')
        expect(preserveCasePattern('Hello', 'world')).toBe('World')
        expect(preserveCasePattern('hello', 'WORLD')).toBe('WORLD')
    })

    it('extractPunctuation splits prefix/suffix', () => {
        const { extractPunctuation } = __testing
        expect(extractPunctuation('hello')).toEqual(['', ''])
        expect(extractPunctuation('!hello?')).toEqual(['!', '?'])
        expect(extractPunctuation('...hello...')).toEqual(['...', '...'])
    })

    it('soundex groups phonetically similar words', () => {
        const { soundex } = __testing
        expect(soundex('helo')).toBe(soundex('hello'))
        expect(soundex('wrold')).toBe(soundex('world'))
    })
})
