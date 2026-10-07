import { describe, it, expect } from 'vitest'
import { isSpokenNumberContext, numberToWords, spellOutNumbers } from '../spokenNumbers'

describe('numberToWords', () => {
    it.each([
        [0, 'zero'],
        [7, 'seven'],
        [21, 'twenty one'],
        [100, 'one hundred'],
        [1000, 'one thousand'],
        [10_000, 'ten thousand'],
        [450_000, 'four hundred fifty thousand'],
        [1_000_000, 'one million'],
    ])('%i → %s', (n, words) => {
        expect(numberToWords(n)).toBe(words)
    })
})

describe('spellOutNumbers', () => {
    it('writes counts the way lyrics do', () => {
        expect(spellOutNumbers('10,000 reasons for my heart to find')).toBe('ten thousand reasons for my heart to find')
        expect(spellOutNumbers('when we have been there 10000 years')).toBe('when we have been there ten thousand years')
    })

    it('drops the "one" after "a", as sung', () => {
        expect(spellOutNumbers('oh for a 1000 tongues to sing')).toBe('oh for a thousand tongues to sing')
        expect(spellOutNumbers('a 100 times')).toBe('a hundred times')
    })

    it('spells ordinals', () => {
        expect(spellOutNumbers('the 1st noel')).toBe('the first noel')
        expect(spellOutNumbers('the 21st century')).toBe('the twenty first century')
    })

    it('leaves decimals and numbers glued to letters alone', () => {
        expect(spellOutNumbers('2.5 times')).toBe('2.5 times')
        expect(spellOutNumbers('track 3a at 9am')).toBe('track 3a at 9am')
    })
})

describe('isSpokenNumberContext', () => {
    it.each([
        'we raised $450,000 last year',
        'give 10% of your income',
        'in 2024 we will grow',
        'turn with me to John 3:16',
        'service starts at 9am',
        'call 0245396621',
        'my son is 12 years old',
    ])('marks speech: %s', (text) => {
        expect(isSpokenNumberContext(text)).toBe(true)
    })

    it.each([
        '10,000 reasons for my heart to find',
        'oh for a 1000 tongues to sing',
        'when we have been there 10000 years',
    ])('lets lyrics through: %s', (text) => {
        expect(isSpokenNumberContext(text)).toBe(false)
    })
})
