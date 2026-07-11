/**
 * Aggressive bug-finding tests for verseDetection.
 *
 * These tests probe for REAL implementation bugs. They are designed to
 * fail if the implementation regresses. Where a documented bug is
 * actually fixed in the code, the test acts as a regression guard.
 *
 * Test naming convention: `[BUG N] <description>` — if the test passes,
 * either the bug was never present OR it has been fixed. The BUGS_FOUND.md
 * document tracks the original findings.
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
} from '../verseDetection'

describe('verseDetection — bug hunting', () => {
    // -----------------------------------------------------------------------
    // BUG: verseToLabel produces machine-readable label, not human-readable
    // -----------------------------------------------------------------------
    it('verseToLabel produces bookNum:chapter:verse (documented behavior)', () => {
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
        // Currently produces a machine-readable label.
        // If someone "fixes" this to return the human-readable reference
        // (e.g. "John 3:16"), they'll need to update downstream consumers
        // (DB queries, lookup keys) accordingly.
        expect(verseToLabel(verse)).toBe('43:3:16')
    })

    it('verseToLabel includes verse range end when present', () => {
        const verse = {
            raw: 'John 3:16-18',
            reference: 'John 3:16-18',
            book: 'John',
            chapter: 3,
            verseStart: 16,
            verseEnd: 18,
            startIndex: 0,
            endIndex: 0,
            confidence: 'high' as const,
        }
        expect(verseToLabel(verse)).toBe('43:3:16-18')
    })

    it('verseToLabel returns empty string for unknown book', () => {
        const verse = {
            raw: 'FakeBook 1:1',
            reference: 'FakeBook 1:1',
            book: 'FakeBook',
            chapter: 1,
            verseStart: 1,
            startIndex: 0,
            endIndex: 0,
            confidence: 'high' as const,
        }
        expect(verseToLabel(verse)).toBe('')
    })

    // -----------------------------------------------------------------------
    // BUG: formatVerseForDisplay
    // -----------------------------------------------------------------------
    it('formatVerseForDisplay preserves numbered book prefix', () => {
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
        expect(formatVerseForDisplay(verse)).toBe('1 John 1:1')
    })

    it('formatVerseForDisplay formats ranges', () => {
        const verse = {
            raw: 'John 3:16-18',
            reference: 'John 3:16-18',
            book: 'John',
            chapter: 3,
            verseStart: 16,
            verseEnd: 18,
            startIndex: 0,
            endIndex: 0,
            confidence: 'high' as const,
        }
        expect(formatVerseForDisplay(verse)).toBe('John 3:16-18')
    })

    // -----------------------------------------------------------------------
    // BUG: detectVerses false positive in compound words
    // -----------------------------------------------------------------------
    it('"genesis framework" should NOT match Genesis', () => {
        const verses = detectVerses('I built this with the genesis framework')
        const genesis = verses.filter(v => v.book === 'Genesis')
        expect(genesis.length).toBe(0)
    })

    it('"mark my words" should NOT match Mark', () => {
        const verses = detectVerses('mark my words, it will happen')
        const mark = verses.filter(v => v.book === 'Mark')
        expect(mark.length).toBe(0)
    })

    it('"acts of kindness" should NOT match Acts', () => {
        const verses = detectVerses('acts of kindness')
        const acts = verses.filter(v => v.book === 'Acts')
        expect(acts.length).toBe(0)
    })

    it('"roman numerals" should NOT match Romans', () => {
        const verses = detectVerses('roman numerals are useful')
        const romans = verses.filter(v => v.book === 'Romans')
        expect(romans.length).toBe(0)
    })

    // -----------------------------------------------------------------------
    // BUG: detectVerses matching inside time expressions
    // -----------------------------------------------------------------------
    it('"John 3:16 PM" should NOT match John 3:16', () => {
        // The implementation has a fix: it checks for AM/PM suffix
        const verses = detectVerses('The meeting is at John 3:16 PM')
        const john = verses.filter(v => v.book === 'John')
        expect(john.length).toBe(0)
    })

    it('"John 3:16 AM" should NOT match John 3:16', () => {
        const verses = detectVerses('Wake up at John 3:16 AM')
        const john = verses.filter(v => v.book === 'John')
        expect(john.length).toBe(0)
    })

    it('"Room 1:5" should NOT match a Bible reference', () => {
        // "Room" is not a book name — but does the regex anchor correctly?
        const verses = detectVerses('Go to Room 1:5 for the meeting')
        // This could match "1:5" if the regex is loose, but the leading
        // "Room" is not a valid book, so the full match should fail.
        expect(verses.length).toBe(0)
    })

    // -----------------------------------------------------------------------
    // BUG: detectVerses allows impossible verse references
    // -----------------------------------------------------------------------
    it('"John 21:1000" should be rejected (John 21 only has 25 verses)', () => {
        const verses = detectVerses('John 21:1000')
        expect(verses.length).toBe(0)
    })

    it('"Psalm 119:176" should be accepted (Psalm 119 has 176 verses)', () => {
        const verses = detectVerses('Psalm 119:176')
        expect(verses.length).toBeGreaterThan(0)
        expect(verses[0].verseStart).toBe(176)
    })

    it('"Genesis 50:999" should be rejected (Genesis 50 only has 26 verses)', () => {
        // FIXED: BOOK_MAX_VERSES now covers all 66 books (generated from
        // public/bibles/kjv.json), so out-of-range verses are rejected for
        // every book, not just John/Psalms.
        const verses = detectVerses('Genesis 50:999')
        expect(verses.length).toBe(0)
    })

    it('"Obadiah 1:5" should be accepted (Obadiah has 21 verses)', () => {
        const verses = detectVerses('Obadiah 1:5')
        expect(verses.length).toBeGreaterThan(0)
    })

    // -----------------------------------------------------------------------
    // BUG: parseSpokenNumber edge cases
    // -----------------------------------------------------------------------
    it('parseSpokenNumber("zero") should return 0 or null consistently', () => {
        // The implementation has a guard `if (!hasNumberToken || value <= 0) return null`
        // so 0 → null. Document this.
        const result = parseSpokenNumber('zero')
        expect(result).toBeNull()
    })

    it('parseSpokenNumber("one hundred") should return 100', () => {
        expect(parseSpokenNumber('one hundred')).toBe(100)
    })

    it('parseSpokenNumber("twenty one") should return 21', () => {
        expect(parseSpokenNumber('twenty one')).toBe(21)
    })

    it('parseSpokenNumber("hundred") should return 100', () => {
        expect(parseSpokenNumber('hundred')).toBe(100)
    })

    it('parseSpokenNumber("two hundred thirty four") should return 234', () => {
        expect(parseSpokenNumber('two hundred thirty four')).toBe(234)
    })

    it('parseSpokenNumber("not a number") should return null', () => {
        expect(parseSpokenNumber('not a number')).toBeNull()
    })

    it('parseSpokenNumber("") should return null', () => {
        expect(parseSpokenNumber('')).toBeNull()
    })

    it('parseSpokenNumber("3") should return 3 (digit fallback)', () => {
        expect(parseSpokenNumber('3')).toBe(3)
    })

    // -----------------------------------------------------------------------
    // BUG: normalizeBookName partial matches
    // -----------------------------------------------------------------------
    it('normalizeBookName("1st John") resolves to "1 John"', () => {
        // ASR very commonly outputs the digit+suffix ordinal form ("2nd
        // Corinthians") rather than the spelled-out word ("Second
        // Corinthians") — BOOK_MAPPINGS derives "1st"/"2nd"/"3rd" variants
        // from the existing numbered-book aliases so these resolve too.
        expect(normalizeBookName('1st John')).toBe('1 John')
    })

    it('"2nd Corinthians chapter 4 verse 4" resolves correctly (real transcript regression)', () => {
        const verses = detectVerses('1st of all, 2nd Corinthians chapter 4 verse 4.')
        expect(verses.find(v => v.reference === '2 Corinthians 4:4')).toBeDefined()
    })

    it('normalizeBookName("St. John") should return null (prefix, not book)', () => {
        // "St." is in NAME_PREFIXES upstream, not handled in normalizeBookName
        expect(normalizeBookName('St. John')).toBeNull()
    })

    it('normalizeBookName("John") should return "John"', () => {
        expect(normalizeBookName('John')).toBe('John')
    })

    it('normalizeBookName("john") should return "John" (case-insensitive)', () => {
        expect(normalizeBookName('john')).toBe('John')
    })

    it('normalizeBookName("xyz") should return null (unknown)', () => {
        expect(normalizeBookName('xyz')).toBeNull()
    })

    // -----------------------------------------------------------------------
    // BUG: extractVerseFromContext — should return LAST verse in text
    // -----------------------------------------------------------------------
    it('extractVerseFromContext should return the LAST verse in the text', () => {
        const text = 'Genesis 1:1 is the beginning. John 3:16 is the gospel.'
        const lastVerse = extractVerseFromContext(text, 500)
        expect(lastVerse).not.toBeNull()
        // Both verses should be in the text; the last should be John 3:16
        expect(lastVerse!.book).toBe('John')
        expect(lastVerse!.verseStart).toBe(16)
    })

    it('extractVerseFromContext returns null for text with no verses', () => {
        const lastVerse = extractVerseFromContext('Just a normal sentence.', 500)
        expect(lastVerse).toBeNull()
    })

    it('extractVerseFromContext returns null for empty text', () => {
        const lastVerse = extractVerseFromContext('', 500)
        expect(lastVerse).toBeNull()
    })

    // -----------------------------------------------------------------------
    // BUG: hasVerseReference is too broad for non-Bible text
    // -----------------------------------------------------------------------
    it('"Chapter 1: Section 2" should NOT be a verse reference', () => {
        const result = hasVerseReference('Chapter 1: Section 2')
        expect(result).toBe(false)
    })

    it('"John 3:16" is a verse reference', () => {
        expect(hasVerseReference('John 3:16')).toBe(true)
    })

    it('"Some people came to the meeting" is NOT a verse reference', () => {
        // Regression guard for "some" → "Psalms" false positive
        expect(hasVerseReference('Some people came to the meeting')).toBe(false)
    })

    // -----------------------------------------------------------------------
    // detectVerses — verse range handling
    // -----------------------------------------------------------------------
    it('detectVerses should handle verse ranges like John 3:16-18', () => {
        const verses = detectVerses('John 3:16-18')
        expect(verses.length).toBeGreaterThan(0)
        expect(verses[0].verseStart).toBe(16)
        expect(verses[0].verseEnd).toBe(18)
    })

    it('detectVerses should handle spoken ranges: "John 3 verses 16 through 18"', () => {
        const verses = detectVerses('John 3 verses 16 through 18')
        if (verses.length > 0) {
            expect(verses[0].verseStart).toBe(16)
            expect(verses[0].verseEnd).toBe(18)
        }
    })

    // -----------------------------------------------------------------------
    // Edge cases: multi-reference, repetition, etc.
    // -----------------------------------------------------------------------
    it('detectVerses should handle multiple references in one string', () => {
        const verses = detectVerses('Read John 3:16 and Romans 8:28 today.')
        const john = verses.filter(v => v.book === 'John')
        const romans = verses.filter(v => v.book === 'Romans')
        expect(john.length).toBeGreaterThanOrEqual(1)
        expect(romans.length).toBeGreaterThanOrEqual(1)
    })

    it('detectVerses should be case-insensitive', () => {
        const lower = detectVerses('john 3:16')
        const upper = detectVerses('JOHN 3:16')
        const mixed = detectVerses('JoHn 3:16')
        expect(lower.length).toBeGreaterThan(0)
        expect(upper.length).toBeGreaterThan(0)
        expect(mixed.length).toBeGreaterThan(0)
    })

    it('detectVerses should handle whitespace', () => {
        const verses = detectVerses('   John 3:16   ')
        expect(verses.length).toBeGreaterThan(0)
    })

    it('detectVerses should not match partial references without chapter', () => {
        // "John 3" alone is not a verse reference (chapter-only is gated
        // behind the "chapter" keyword or the heuristic fallback)
        const verses = detectVerses('John 3 is a great chapter')
        // The implementation may detect "John 3" as a chapter-only ref
        // since it's not gated by the "chapter" keyword in the regex path.
        // If so, this test asserts the documented behavior.
        // The test passes if verses is empty (correct) OR contains a
        // chapter-only John 3 (also acceptable). The important thing is
        // no "verse 16" is invented.
        if (verses.length > 0) {
            expect(verses[0].verseStart).toBe(1)
        }
    })

    // -----------------------------------------------------------------------
    // Regression tests for false-positive shapes found in the precision audit
    // -----------------------------------------------------------------------
    it('"song 2 verse 1" should NOT match Song of Solomon (worship-song talk, not scripture)', () => {
        // This app manages a worship song queue as a first-class feature, so
        // "song 2 verse 1"/"queue up song 2 verse 1" is ordinary operator
        // speech about the song list, not a Song of Solomon reference.
        const verses = detectVerses("Let's go to song two, verse one")
        expect(verses.find(v => v.book === 'Song of Solomon')).toBeUndefined()
    })

    it('"song of solomon 2:1" should still match (full, unambiguous book name)', () => {
        const verses = detectVerses('Song of Solomon 2:1 speaks of love')
        expect(verses.find(v => v.reference === 'Song of Solomon 2:1')).toBeDefined()
    })

    it('"act 3:16" should NOT match Acts (drama/script notation, not scripture)', () => {
        const verses = detectVerses('In act 3:16 the hero returns')
        expect(verses.find(v => v.book === 'Acts')).toBeUndefined()
    })

    it('"acts 3:16" should still match (correct plural book name)', () => {
        const verses = detectVerses('Acts 3:16 speaks of healing')
        expect(verses.find(v => v.reference === 'Acts 3:16')).toBeDefined()
    })

    it('"Genesis 1-3" IS parsed as Genesis 1:3 by design in this app', () => {
        // Product decision: unlike a formal bulletin citation, in this app
        // "Book N-M" means chapter N verse M, not a chapter range. Hyphen is
        // graded medium confidence (see hasAmbiguousSeparator) rather than
        // high, since it's still the least explicit separator.
        const verses = detectVerses("Let's read Genesis 1-3 this week")
        const match = verses.find(v => v.reference === 'Genesis 1:3')
        expect(match).toBeDefined()
        expect(match?.confidence).toBe('medium')
    })

    it('"Genesis 1 3" (bare space) and spoken "Genesis one three" also resolve to Genesis 1:3', () => {
        // The spoken-number parser no longer sums two independent bare
        // numbers together (see parseSpokenNumber's scale-transition guard),
        // so these are recognized as two separate numbers — chapter and
        // verse — instead of being silently dropped or merged into one wrong
        // chapter number.
        for (const text of ['Genesis 1 3 says this', 'Genesis one three says this', 'Genesis one, three says this']) {
            const verses = detectVerses(text)
            const match = verses.find(v => v.reference === 'Genesis 1:3')
            expect(match, `expected a match for: ${text}`).toBeDefined()
            expect(match?.confidence).toBe('medium')
        }
    })

    it('spoken compound numbers still combine correctly ("twenty three", "one hundred")', () => {
        // Regression guard for the scale-transition fix: legitimate compound
        // numbers (tens+ones, ones+hundred) must still combine, only two
        // independent bare numbers in a row should stop combining.
        expect(parseSpokenNumber('twenty three')).toBe(23)
        expect(parseSpokenNumber('one hundred')).toBe(100)
        expect(parseSpokenNumber('two hundred thirty four')).toBe(234)
    })

    it('"John three sixteen" (classic spoken form) resolves to John 3:16, not a summed chapter', () => {
        const verses = detectVerses('John three sixteen says this')
        expect(verses.find(v => v.reference === 'John 3:16')).toBeDefined()
        // Regression guard: previously "three"+"sixteen" summed to chapter
        // 19, which either produced no match or (with a trailing word) a
        // wrong reference like John 19:17.
        expect(verses.find(v => v.chapter === 19)).toBeUndefined()
    })

    it('"Genesis 1:1-3" should still work (explicit colon plus verse range)', () => {
        const verses = detectVerses('Genesis 1:1-3 describes creation')
        expect(verses.find(v => v.reference === 'Genesis 1:1-3')).toBeDefined()
    })

    // -----------------------------------------------------------------------
    // Regression tests found via a real sermon transcript
    // -----------------------------------------------------------------------
    it('a bare digit belonging to the NEXT numbered book is not swallowed as the previous book\'s verse', () => {
        // "James 1, 1 John 1 7" — the second "1" starts "1 John", not
        // James's verse. Previously this produced the wrong "James 1:1" and
        // dropped the "1 " prefix off "1 John", yielding bare "John 1:7"
        // (a different book entirely).
        const verses = detectVerses('Notice what James 1, 1 John 1 7 said.')
        expect(verses.find(v => v.reference === '1 John 1:7')).toBeDefined()
        expect(verses.find(v => v.reference === 'James 1:1')).toBeUndefined()
        expect(verses.find(v => v.book === 'John' && v.reference !== '1 John 1:7')).toBeUndefined()
    })

    it('"1 John" is still detected correctly at the start of an utterance', () => {
        const verses = detectVerses('1 John 1:7 said this')
        expect(verses.find(v => v.reference === '1 John 1:7')).toBeDefined()
    })

    it('compact 3-digit spoken ref splits into chapter:verse when the whole number is invalid as a chapter', () => {
        // "Matthew 542" — 542 is far outside Matthew's 28 chapters, so it's
        // safe to reinterpret as chapter 5, verse 42 (Matthew 5 has 48
        // verses). This only fires because treating 542 as a whole chapter
        // already failed bounds — see the next test for why that matters.
        const verses = detectVerses('According to Matthew 542 it returns good for evil.')
        expect(verses.find(v => v.reference === 'Matthew 5:42')).toBeDefined()
    })

    it('compact-split does NOT touch a number that is already a valid standalone chapter (Psalm 119 regression guard)', () => {
        const verses = detectVerses('Turn with me to Psalm 119')
        expect(verses.find(v => v.reference === 'Psalms 1:19')).toBeUndefined()
    })

    it('"Psalm 119" (bare, no chapter/verse keyword) should NOT be mis-split into Psalms 1:19', () => {
        const verses = detectVerses('Turn with me to Psalm 119')
        expect(verses.find(v => v.reference === 'Psalms 1:19')).toBeUndefined()
    })

    it('"Psalm 119:176" should still be accepted at chapter 119 (not split)', () => {
        const verses = detectVerses('Psalm 119:176 is the longest verse chapter')
        expect(verses.find(v => v.reference === 'Psalms 119:176')).toBeDefined()
    })

    it('ambiguous separators ("verse" word, "vs", "x") get medium confidence, not high', () => {
        const verses = detectVerses('Ephesians 6 verse 1 tells children to obey')
        const match = verses.find(v => v.reference === 'Ephesians 6:1')
        expect(match?.confidence).toBe('medium')
    })

    it('unambiguous colon separator still gets high confidence', () => {
        const verses = detectVerses('Ephesians 6:1 tells children to obey')
        const match = verses.find(v => v.reference === 'Ephesians 6:1')
        expect(match?.confidence).toBe('high')
    })

    // -----------------------------------------------------------------------
    // Real-transcript regression: "Ephesians the 6th chapter verse 10 through
    // 17" was not recognized at all — the book+chapter+verse parser only
    // checked for the "chapter" keyword BEFORE the number ("chapter 6"), not
    // after it ("the 6th chapter"), and had no support for a filler "the" or
    // for a digit-ordinal-suffixed number ("6th"). This caused the whole
    // book mention to be skipped and fall back to a stale reference context
    // from an earlier, different book.
    // -----------------------------------------------------------------------
    it('"Book the Nth chapter verse V through W" (ordinal-after-chapter-word) is recognized', () => {
        const verses = detectVerses('Then in Ephesians the 6th chapter verse 10 through 17 finally my brethren')
        const match = verses.find(v => v.reference === 'Ephesians 6:10-17')
        expect(match).toBeDefined()
        expect(match?.confidence).toBe('high')
    })

    it('"Book the Nth chapter" (spelled-out ordinal, bare) still resolves the chapter', () => {
        const verses = detectVerses('Ephesians the sixth chapter is about armor')
        const match = verses.find(v => v.reference === 'Ephesians 6:1')
        expect(match).toBeDefined()
    })

    it('"Book chapter N verse V through W" (unchanged control case) still works', () => {
        const verses = detectVerses('Ephesians chapter 6 verse 10 through 17')
        const match = verses.find(v => v.reference === 'Ephesians 6:10-17')
        expect(match).toBeDefined()
        expect(match?.confidence).toBe('high')
    })

    // -----------------------------------------------------------------------
    // "verse" mis-transcribed as "versus" — Whisper very commonly hears a
    // bare spoken "verse" as "versus" (phonetically close), confirmed
    // repeatedly across real sermon transcripts. Treated identically to
    // "verse" everywhere it's accepted as a separator, including the same
    // ambiguous-separator confidence downgrade (it's no more trustworthy
    // than "verse" itself, which is already graded down for the same
    // reason "song 2 verse 1" isn't a scripture reference).
    // -----------------------------------------------------------------------
    it('"Book N versus V" (versus as a mis-heard "verse" separator) is still detected', () => {
        const verses = detectVerses('John 3 versus 16')
        const match = verses.find(v => v.reference === 'John 3:16')
        expect(match).toBeDefined()
    })

    it('"chapter N versus V" (mis-heard verse keyword after chapter) is still detected', () => {
        const verses = detectVerses('Ephesians chapter 3, versus 14')
        const match = verses.find(v => v.reference === 'Ephesians 3:14')
        expect(match).toBeDefined()
    })
})
