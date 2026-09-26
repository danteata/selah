import { describe, it, expect, vi } from 'vitest'
import { cleanIncrementally, createCleanCache } from '../incrementalClean'

const upper = (t: string) => t.toUpperCase()

describe('cleanIncrementally', () => {
    it('cleans only what was added since the last committed text', () => {
        const cache = createCleanCache()
        const clean = vi.fn(upper)

        cleanIncrementally('in the beginning', clean, cache, 'k', true)
        const result = cleanIncrementally('in the beginning was the word', clean, cache, 'k', true)

        expect(result).toBe('IN THE BEGINNING WAS THE WORD')
        expect(clean).toHaveBeenLastCalledWith('was the word')
    })

    it('does not remember an interim tail', () => {
        const cache = createCleanCache()
        cleanIncrementally('committed', upper, cache, 'k', true)
        expect(cleanIncrementally('committed interim guess', upper, cache, 'k', false)).toBe('COMMITTED INTERIM GUESS')

        const clean = vi.fn(upper)
        cleanIncrementally('committed final words', clean, cache, 'k', true)
        // Built on the committed text, not on the interim guess.
        expect(clean).toHaveBeenLastCalledWith('final words')
    })

    it('cleans in full when the text no longer extends the cache', () => {
        const cache = createCleanCache()
        cleanIncrementally('first sermon', upper, cache, 'k', true)
        const clean = vi.fn(upper)
        cleanIncrementally('after a reset', clean, cache, 'k', true)
        expect(clean).toHaveBeenLastCalledWith('after a reset')
    })

    it('never splits a word at the cache boundary', () => {
        const cache = createCleanCache()
        cleanIncrementally('psalm', upper, cache, 'k', true)
        const clean = vi.fn(upper)
        cleanIncrementally('psalms 23', clean, cache, 'k', true)
        expect(clean).toHaveBeenLastCalledWith('psalms 23')
    })

    it('starts over when the cleaning settings change', () => {
        const cache = createCleanCache()
        cleanIncrementally('hello there', upper, cache, 'en', true)
        const clean = vi.fn(upper)
        cleanIncrementally('hello there friend', clean, cache, 'fr', true)
        expect(clean).toHaveBeenLastCalledWith('hello there friend')
    })
})
