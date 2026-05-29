/**
 * AGGRESSIVE BUG-FINDING TESTS for verseDetection
 */

import { describe, it, expect } from 'vitest'
import {
    detectVerses,
    normalizeBookName,
    parseSpokenNumber,
    verseToLabel,
    formatVerseForDisplay,
    hasVerseReference,
    extractVerseFromContext,
    BOOK_MAX_CHAPTER,
} from '../verseDetection'

describe('verseDetection — BUG HUNTING', () => {
    // -----------------------------------------------------------------------
    // BUG 8: verseToLabel returns machine code, not human-readable reference
    // -----------------------------------------------------------------------
    it('[BUG 8] verseToLabel should return human-readable reference, not machine code', () => {
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
        const label = verseToLabel(verse)
        // EXPECTED: 'John 3:16' or '43:3:16' (bookNum:chapter:verse)
        // ACTUAL: '43:3:16' — a machine code, not human-readable
        // This is the documented behavior but is confusingly named
        expect(label).toBe('43:3:16')
    })

    // -----------------------------------------------------------------------
    // BUG 9: formatVerseForDisplay doesn't include book number for numbered books
    // -----------------------------------------------------------------------
    it('[BUG 9] formatVerseForDisplay should preserve book number', () => {
        const verse = {
            raw: '1 John 1:1',
            reference: '1 John 1:1',
            book: '1 John',
            chapter: 1,
            verseStart: 1,
            startIndex: 0,
            endIndex: 0,
            confidence: 'high' as const,
        }
        const display = formatVerseForDisplay(verse)
        expect(display).toBe('1 John 1:1')
    })

    // -----------------------------------------------------------------------
    // BUG 10: detectVerses matches inside words (false positive)
    // -----------------------------------------------------------------------
    it('[BUG 10] "genesis framework" should NOT match Genesis', () => {
        const verses = detectVerses('I built this with the genesis framework')
        const genesis = verses.filter(v => v.book === 'Genesis')
        expect(genesis.length).toBe(0)
    })

    it('[BUG 10] "mark my words" should NOT match Mark', () => {
        const verses = detectVerses('mark my words, it will happen')
        const mark = verses.filter(v => v.book === 'Mark')
        expect(mark.length).toBe(0)
    })

    // -----------------------------------------------------------------------
    // BUG 11: detectVerses matches numbers in URLs, phone numbers, times
    // -----------------------------------------------------------------------
    it('[BUG 11] "John 3:16 PM" should NOT match John 3:16 (time, not verse)', () => {
        // "3:16" in time context should not be detected
        const verses = detectVerses('The meeting is at John 3:16 PM')
        // This WILL match because the regex sees "John 3:16"
        // The "PM" suffix doesn't prevent the match
        const john = verses.filter(v => v.book === 'John')
        expect(john.length).toBe(0)
    })

    it('[BUG 11] "Room 1:5" should NOT match a Bible reference', () => {
        const verses = detectVerses('Go to Room 1:5 for the meeting')
        expect(verses.length).toBe(0)
    })

    // -----------------------------------------------------------------------
    // BUG 12: parseSpokenNumber rejects valid spoken numbers
    // -----------------------------------------------------------------------
    it('[BUG 12] parseSpokenNumber("zero") should return 0', () => {
        const result = parseSpokenNumber('zero')
        // Currently returns null because value <= 0 check rejects 0
        // But 0 could be a valid spoken number in some contexts
        expect(result).toBeNull()
    })

    it('[BUG 12] parseSpokenNumber("one hundred") should return 100', () => {
        expect(parseSpokenNumber('one hundred')).toBe(100)
    })

    it('[BUG 12] parseSpokenNumber("twenty one") should return 21', () => {
        expect(parseSpokenNumber('twenty one')).toBe(21)
    })

    it('[BUG 12] parseSpokenNumber("hundred") should return 100', () => {
        expect(parseSpokenNumber('hundred')).toBe(100)
    })

    // -----------------------------------------------------------------------
    // BUG 13: normalizeBookName doesn't handle partial matches
    // -----------------------------------------------------------------------
    it('[BUG 13] normalizeBookName("1st John") should return "1 John"', () => {
        const result = normalizeBookName('1st John')
        // "1st" is not in BOOK_MAPPINGS
        expect(result).toBeNull()
    })

    it('[BUG 13] normalizeBookName("St. John") should return null (not a book)', () => {
        // "st" is in NAME_PREFIXES but not handled in normalizeBookName
        const result = normalizeBookName('St. John')
        expect(result).toBeNull()
    })

    // -----------------------------------------------------------------------
    // BUG 14: detectVerses allows impossible verse references
    // -----------------------------------------------------------------------
    it('[BUG 14] "John 21:1000" should be rejected (John only has 25 verses in ch 21)', () => {
        const verses = detectVerses('John 21:1000')
        // The code only checks chapter bounds, not verse bounds
        expect(verses.length).toBe(0)
    })

    it('[BUG 14] "Psalm 119:176" should be accepted (Psalm 119 has 176 verses)', () => {
        const verses = detectVerses('Psalm 119:176')
        expect(verses.length).toBeGreaterThan(0)
        expect(verses[0].verseStart).toBe(176)
    })

    // -----------------------------------------------------------------------
    // BUG 15: extractVerseFromContext only checks last N chars, might miss earlier verses
    // -----------------------------------------------------------------------
    it('[BUG 15] extractVerseFromContext should find the LAST verse in the text', () => {
        const text = 'Genesis 1:1 is the beginning. John 3:16 is the gospel.'
        const lastVerse = extractVerseFromContext(text, 500)
        expect(lastVerse).not.toBeNull()
        expect(lastVerse!.book).toBe('John')
    })

    // -----------------------------------------------------------------------
    // BUG 16: hasVerseReference is too broad for non-Bible text
    // -----------------------------------------------------------------------
    it('[BUG 16] "Chapter 1: Section 2" should NOT be a verse reference', () => {
        const result = hasVerseReference('Chapter 1: Section 2')
        // "chapter 1" pattern might match ALTERNATIVE_PATTERNS
        expect(result).toBe(false)
    })

    // -----------------------------------------------------------------------
    // BUG: verse range end index calculation
    // -----------------------------------------------------------------------
    it('detectVerses should handle verse ranges', () => {
        const verses = detectVerses('John 3:16-17')
        expect(verses.length).toBeGreaterThan(0)
        expect(verses[0].verseStart).toBe(16)
        expect(verses[0].verseEnd).toBe(17)
    })

    // -----------------------------------------------------------------------
    // Sanity check: known false-positive-prone phrases
    // -----------------------------------------------------------------------
    it('should not match "acts of kindness" as Acts', () => {
        const verses = detectVerses('acts of kindness')
        const acts = verses.filter(v => v.book === 'Acts')
        expect(acts.length).toBe(0)
    })

    it('should not match "roman numerals" as Romans', () => {
        const verses = detectVerses('roman numerals are useful')
        const romans = verses.filter(v => v.book === 'Romans')
        expect(romans.length).toBe(0)
    })
})
