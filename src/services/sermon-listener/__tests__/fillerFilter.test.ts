import { describe, it, expect } from 'vitest'
import { filterFillers } from '../fillerFilter'

// Ported from Handy's audio_toolkit/text.rs test suite, adapted to the
// filterFillers() TS API. Verifies language-aware filler removal and
// stutter collapsing behave identically to the Rust original.

describe('filterFillers — filler words', () => {
    it('removes English fillers', () => {
        expect(filterFillers('So uhm I was thinking uh about this', { lang: 'en' }))
            .toBe('So I was thinking about this')
    })

    it('is case-insensitive', () => {
        expect(filterFillers('UHM this is UH a test', { lang: 'en' }))
            .toBe('this is a test')
    })

    it('strips trailing punctuation attached to fillers', () => {
        expect(filterFillers('Well, uhm, I think, uh. that\'s right', { lang: 'en' }))
            .toBe('Well, I think, that\'s right')
    })

    it('removes standalone "um" for English', () => {
        expect(filterFillers('um I think um this is good', { lang: 'en' }))
            .toBe('I think this is good')
    })

    it('preserves Portuguese "um" (means "a/an")', () => {
        expect(filterFillers('um gato bonito', { lang: 'pt' })).toBe('um gato bonito')
    })

    it('preserves Spanish "ha" (means "has")', () => {
        expect(filterFillers('ha sido un buen día', { lang: 'es' })).toBe('ha sido un buen día')
    })

    it('normalizes a region code (pt-BR → pt)', () => {
        expect(filterFillers('um gato bonito', { lang: 'pt-BR' })).toBe('um gato bonito')
    })

    it('unknown language uses conservative fallback', () => {
        expect(filterFillers('uh I think uhm this works', { lang: 'xx' }))
            .toBe('I think this works')
    })

    it('fallback does NOT remove "um"', () => {
        expect(filterFillers('um I think this works', { lang: 'xx' }))
            .toBe('um I think this works')
    })
})

describe('filterFillers — custom filler list', () => {
    it('overrides language defaults', () => {
        expect(filterFillers('okay so I think right this works', {
            lang: 'en',
            customFillerWords: ['okay', 'right'],
        })).toBe('so I think this works')
    })

    it('empty custom list disables filler removal', () => {
        expect(filterFillers('So uhm I was thinking uh about this', {
            lang: 'en',
            customFillerWords: [],
        })).toBe('So uhm I was thinking uh about this')
    })
})

describe('filterFillers — stutter collapse', () => {
    it('collapses long stutter runs but keeps the first/distinct tokens', () => {
        expect(filterFillers('w wh wh wh wh wh wh wh wh wh why', { lang: 'en' }))
            .toBe('w wh why')
    })

    it('collapses repeated short words', () => {
        expect(filterFillers('I I I I think so so so so', { lang: 'en' }))
            .toBe('I think so')
    })

    it('collapses repeated longer words', () => {
        expect(filterFillers('Check data doc doc doc doc documentation.', { lang: 'en' }))
            .toBe('Check data doc documentation.')
    })

    it('collapses mixed-case repetitions', () => {
        expect(filterFillers('No NO no NO no', { lang: 'en' })).toBe('No')
    })

    it('preserves exactly two repetitions (deliberate emphasis)', () => {
        expect(filterFillers('no no is fine', { lang: 'en' })).toBe('no no is fine')
    })
})

describe('filterFillers — whitespace & passthrough', () => {
    it('collapses multiple spaces', () => {
        expect(filterFillers('Hello    world   test', { lang: 'en' })).toBe('Hello world test')
    })

    it('trims leading/trailing whitespace', () => {
        expect(filterFillers('  Hello world  ', { lang: 'en' })).toBe('Hello world')
    })

    it('handles a combined case', () => {
        expect(filterFillers('  Uhm, so I was, uh, thinking about this  ', { lang: 'en' }))
            .toBe('so I was, thinking about this')
    })

    it('leaves clean text untouched', () => {
        expect(filterFillers('This is a completely normal sentence.', { lang: 'en' }))
            .toBe('This is a completely normal sentence.')
    })

    it('returns empty/whitespace input unchanged', () => {
        expect(filterFillers('', { lang: 'en' })).toBe('')
        expect(filterFillers('   ', { lang: 'en' })).toBe('   ')
    })
})
