/**
 * AGGRESSIVE BUG-FINDING TESTS for referenceContext
 */

import { describe, it, expect, vi } from 'vitest'
import {
    createContext,
    isContextValid,
    updateContextFromVerse,
    resolveBareReferences,
    type ActiveReferenceContext,
} from '../referenceContext'

describe('referenceContext — BUG HUNTING', () => {
    // -----------------------------------------------------------------------
    // BUG 17: Context TTL is hardcoded, no way to extend
    // -----------------------------------------------------------------------
    it('[BUG 17] context should expire after default TTL (120s)', () => {
        const context = createContext('John', 3)
        expect(isContextValid(context)).toBe(true)

        // Fast-forward 121 seconds
        vi.useFakeTimers()
        vi.advanceTimersByTime(121_000)
        expect(isContextValid(context)).toBe(false)
        vi.useRealTimers()
    })

    // -----------------------------------------------------------------------
    // BUG 18: resolveBareReferences with null context should not crash
    // -----------------------------------------------------------------------
    it('[BUG 18] resolveBareReferences with null context should return empty', () => {
        const result = resolveBareReferences('verse 16', null)
        expect(result).toEqual([])
    })

    // -----------------------------------------------------------------------
    // BUG 19: resolveBareReferences with expired context should not use stale data
    // -----------------------------------------------------------------------
    it('[BUG 19] resolveBareReferences with expired context should return empty', () => {
        vi.useFakeTimers()
        const context = createContext('John', 3)
        vi.advanceTimersByTime(121_000)

        const result = resolveBareReferences('verse 16', context)
        // Should not resolve because context is expired
        expect(result.length).toBe(0)
        vi.useRealTimers()
    })

    // -----------------------------------------------------------------------
    // BUG 20: resolveBareReferences matches "verse" in unrelated words
    // -----------------------------------------------------------------------
    it('[BUG 20] "adverse" should NOT match bare verse pattern', () => {
        const context = createContext('John', 3)
        const result = resolveBareReferences('adverse conditions', context)
        // "adverse" contains "verse" substring
        const adverseMatches = result.filter(r => r.raw.includes('adverse'))
        expect(adverseMatches.length).toBe(0)
    })

    it('[BUG 20] "university" should NOT match bare verse pattern', () => {
        const context = createContext('John', 3)
        const result = resolveBareReferences('at the university', context)
        expect(result.length).toBe(0)
    })

    // -----------------------------------------------------------------------
    // BUG 21: Bare chapter references ignore context book
    // -----------------------------------------------------------------------
    it('[BUG 21] "chapter 4" should use context book', () => {
        const context = createContext('Ephesians', 6)
        const result = resolveBareReferences('and in chapter 4', context)
        expect(result.length).toBeGreaterThan(0)
        expect(result[0].book).toBe('Ephesians')
        expect(result[0].chapter).toBe(4)
    })

    // -----------------------------------------------------------------------
    // BUG 22: Verse ranges with written numbers
    // -----------------------------------------------------------------------
    it('[BUG 22] "verse five to ten" should resolve to verse 5-10', () => {
        const context = createContext('Psalms', 23)
        const result = resolveBareReferences('verse five to ten', context)
        expect(result.length).toBeGreaterThan(0)
        expect(result[0].verseStart).toBe(5)
        expect(result[0].verseEnd).toBe(10)
    })

    // -----------------------------------------------------------------------
    // BUG 23: updateContextFromVerse doesn't preserve existing chapter on same-book reference
    // -----------------------------------------------------------------------
    it('[BUG 23] updateContextFromVerse should create fresh context with Date.now()', () => {
        const verse = {
            raw: 'John 3:16',
            reference: 'John 3:16',
            book: 'John',
            chapter: 3,
            verseStart: 16,
            startIndex: 0,
            endIndex: 0,
            confidence: 'high' as const,
        }
        const context = updateContextFromVerse(verse)
        expect(context.book).toBe('John')
        expect(context.chapter).toBe(3)
        expect(context.setAt).toBeGreaterThan(0)
    })
})
