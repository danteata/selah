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

describe('applyCustomWords — does not lose words (Handy #2203a82 parity)', () => {
    // Regression: the greedy longest-first match consumed the following ordinary
    // word whenever it shared a Soundex code with the custom word. The 3-gram
    // "Charge B, che" scored well against "ChargeBee" (both code C626) and the
    // "che" vanished from the transcript.
    it('does not consume a following word across a punctuation boundary', () => {
        const result = applyCustomWords('il cui nome è Charge B, che permette', ['ChargeBee'], 0.5)
        expect(result).toBe('il cui nome è ChargeBee, che permette')
    })

    // Closest-match (rather than longest-match) keeps the following word when a
    // shorter n-gram scores better.
    it('prefers the closest n-gram over the longest one', () => {
        expect(applyCustomWords('Chat G P the answer', ['ChatGPT'], 0.5)).toBe('ChatGPT the answer')
        expect(applyCustomWords('the Charge B and more', ['ChargeBee'], 0.5)).toBe(
            'the ChargeBee and more',
        )
    })

    // KNOWN LIMITATION, shared with Handy's implementation: the score is
    // normalised by the longer of the two strings, which slightly rewards an
    // n-gram for absorbing extra characters. With no punctuation to close the
    // candidate, "Charge B the" can still beat "Charge B" against "ChargeBee"
    // and swallow the "the". Pinned so a future scoring change surfaces here
    // rather than silently altering transcripts.
    it('can still over-consume when no punctuation closes the candidate', () => {
        expect(applyCustomWords('Charge B the answer', ['ChargeBee'], 0.5)).toBe(
            'ChargeBee answer',
        )
    })

    it('leaves every word present when nothing matches', () => {
        const input = 'and then the pastor read from the book'
        expect(applyCustomWords(input, ['ChargeBee', 'ChatGPT'], 0.5).split(/\s+/)).toHaveLength(
            input.split(/\s+/).length,
        )
    })
})

describe('applyCustomWords — non-ASCII vocabulary is left alone', () => {
    // Soundex discards every non-A-Z character, so a non-ASCII word collapses to
    // a near-empty code and then matches unrelated vocabulary of similar length.
    // These words must pass through untouched rather than be corrupted.
    it('does not fuzzily rewrite Twi words', () => {
        // Twi ɛ/ɔ: without the ASCII gate "ɛkɔm" and "ɔdɔ" reduce to "km"/"d"
        // and collide with short custom words.
        const result = applyCustomWords('ɔdɔ ne ɛkɔm', ['Odom', 'Ekom'], 0.5)
        expect(result).toBe('ɔdɔ ne ɛkɔm')
    })

    it('does not fuzzily rewrite accented Spanish', () => {
        expect(applyCustomWords('la oración', ['Oration'], 0.5)).toBe('la oración')
    })

    it('skips non-ASCII entries in the custom vocabulary', () => {
        // A non-ASCII custom word is not a usable fuzzy target; ASCII entries in
        // the same list must still work.
        const result = applyCustomWords('grace and truth', ['ɔdɔ', 'Grace'], 0.5)
        expect(result).toBe('Grace and truth')
    })

    it('still corrects ASCII words in a sentence containing non-ASCII ones', () => {
        const result = applyCustomWords('ɔdɔ means gracee', ['grace'], 0.5)
        expect(result).toBe('ɔdɔ means grace')
    })
})
