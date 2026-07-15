/**
 * AGGRESSIVE BUG-FINDING TESTS for referenceContext
 */

import { describe, it, expect, vi } from 'vitest'
import {
    createContext,
    isContextValid,
    updateContextFromVerse,
    resolveBareReferences,
    resolveStandaloneNumberContinuation,
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

    // -----------------------------------------------------------------------
    // "verse" mis-transcribed as "versus" — Whisper very commonly mishears a
    // bare spoken "verse" as "versus" (phonetically close), confirmed
    // repeatedly across real sermon transcripts.
    // -----------------------------------------------------------------------
    it('"versus 5" resolves against context the same as "verse 5"', () => {
        const context = createContext('Hebrews', 13)
        const result = resolveBareReferences('versus 5', context)
        expect(result.length).toBeGreaterThan(0)
        expect(result[0].reference).toBe('Hebrews 13:5')
    })

    // -----------------------------------------------------------------------
    // Real-transcript regression: "Hebrews 13" ... "Five." (said as its own,
    // separate ASR utterance) used to leave the live slide stuck on
    // "Hebrews 13:1" — nothing resolved the bare "Five." into Hebrews 13:5,
    // because every existing bare-reference mechanism requires an explicit
    // "verse"/"versus" keyword, and this utterance has none at all.
    // -----------------------------------------------------------------------
    it('resolveStandaloneNumberContinuation resolves a bare number utterance against fresh context', () => {
        const context = createContext('Hebrews', 13)
        const result = resolveStandaloneNumberContinuation('Five.', context)
        expect(result.length).toBe(1)
        expect(result[0].reference).toBe('Hebrews 13:5')
        expect(result[0].confidence).toBe('medium')
    })

    it('resolveStandaloneNumberContinuation accepts a bare digit utterance', () => {
        const context = createContext('Matthew', 6)
        const result = resolveStandaloneNumberContinuation('22', context)
        expect(result.length).toBe(1)
        expect(result[0].reference).toBe('Matthew 6:22')
    })

    it('resolveStandaloneNumberContinuation does NOT fire on a number embedded in a real sentence', () => {
        // Safety guard: this has no keyword to anchor on, so it must only
        // ever fire when the entire utterance is a bare number — never
        // against an unrelated count/date/quantity inside ordinary speech.
        const context = createContext('Hebrews', 13)
        const result = resolveStandaloneNumberContinuation('He said five things to them.', context)
        expect(result).toEqual([])
    })

    it('resolveStandaloneNumberContinuation does NOT fire once context is older than its (tighter) freshness window', () => {
        vi.useFakeTimers()
        const context = createContext('Hebrews', 13)
        vi.advanceTimersByTime(16_000)
        const result = resolveStandaloneNumberContinuation('Five.', context)
        expect(result).toEqual([])
        vi.useRealTimers()
    })

    it('resolveStandaloneNumberContinuation returns empty for null context', () => {
        expect(resolveStandaloneNumberContinuation('Five.', null)).toEqual([])
    })

    // -----------------------------------------------------------------------
    // Same real-world artifact as above, but for a verse RANGE with no
    // "verse"/"verses" keyword ("Deuteronomy 6" ... "6 to 9.", "2 Chronicles
    // 7" ... "15 through 16") — the single-number continuation above didn't
    // cover this, so these used to fall through to the several-seconds-later
    // LLM extraction pass instead of resolving instantly.
    // -----------------------------------------------------------------------
    it('resolveStandaloneNumberContinuation resolves a bare "N to M" range against fresh context', () => {
        const context = createContext('2 Chronicles', 7)
        const result = resolveStandaloneNumberContinuation('15 through 16', context)
        expect(result.length).toBe(1)
        expect(result[0].reference).toBe('2 Chronicles 7:15-16')
        expect(result[0].verseStart).toBe(15)
        expect(result[0].verseEnd).toBe(16)
        expect(result[0].confidence).toBe('medium')
    })

    it('resolveStandaloneNumberContinuation resolves a bare "N-M" dash range against fresh context', () => {
        const context = createContext('Deuteronomy', 6)
        const result = resolveStandaloneNumberContinuation('6-9', context)
        expect(result.length).toBe(1)
        expect(result[0].reference).toBe('Deuteronomy 6:6-9')
        expect(result[0].verseStart).toBe(6)
        expect(result[0].verseEnd).toBe(9)
    })

    it('resolveStandaloneNumberContinuation does NOT fire a range when the end is before the start', () => {
        const context = createContext('Deuteronomy', 6)
        const result = resolveStandaloneNumberContinuation('9-6', context)
        expect(result).toEqual([])
    })
})
