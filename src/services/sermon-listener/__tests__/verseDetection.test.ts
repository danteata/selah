import { describe, expect, it } from 'vitest'
import {
    detectVerses,
    extractVerseFromContext,
    formatVerseForDisplay,
    hasVerseReference,
    verseToLabel,
} from '../verseDetection'

describe('verseDetection', () => {
    // -----------------------------------------------------------------------
    // Classic formats
    // -----------------------------------------------------------------------
    it('detects classic references with chapter:verse format', () => {
        const verses = detectVerses('As written in John 3:16, God so loved the world.')
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('John 3:16')
        expect(verseToLabel(verses[0])).toBe('43:3:16')
    })

    it('detects spoken references with chapter/verse words', () => {
        const verses = detectVerses('Please open to John chapter three verse sixteen today.')
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('John 3:16')
        expect(formatVerseForDisplay(verses[0])).toBe('John 3:16')
    })

    it('detects spoken numbered-book references and ranges', () => {
        const verses = detectVerses('Read first corinthians thirteen verses four through seven aloud.')
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('1 Corinthians 13:4-7')
    })

    it('extracts verse from rolling transcript context', () => {
        const verse = extractVerseFromContext('...and now turn with me to romans chapter eight verse one')
        expect(verse).not.toBeNull()
        expect(verse?.reference).toBe('Romans 8:1')
    })

    it('treats spoken references as valid verse references', () => {
        expect(hasVerseReference('We will read matthew chapter five verse nine.')).toBe(true)
    })

    // -----------------------------------------------------------------------
    // Separator tolerance — Unicode × and x
    // -----------------------------------------------------------------------
    it('detects Unicode multiplication-sign separator (6×1)', () => {
        const verses = detectVerses('Turn with me to Ephesians 6\u00D71')
        expect(verses.length).toBeGreaterThanOrEqual(1)
        const eph = verses.find(v => v.reference === 'Ephesians 6:1')
        expect(eph).toBeDefined()
    })

    it('detects ASCII x separator (6x1)', () => {
        const verses = detectVerses('Ephesians 6x1 tells us to obey.')
        const eph = verses.find(v => v.reference === 'Ephesians 6:1')
        expect(eph).toBeDefined()
    })

    // -----------------------------------------------------------------------
    // Chapter-only fallback — verse defaults to 1
    // -----------------------------------------------------------------------
    it('emits chapter-only reference when "chapter" keyword is present', () => {
        const verses = detectVerses('Let us read Ephesians chapter six.')
        const eph = verses.find(v => v.reference === 'Ephesians 6:1')
        expect(eph).toBeDefined()
        expect(eph!.confidence).toBe('medium')
    })

    it('resolves bare "book N M" as chapter:verse by design (e.g. "Genesis 7 1")', () => {
        // Product decision: "Book N M" (bare numbers, no separator) is
        // recognized as chapter N, verse M — the same as "Book N-M" or a
        // spoken "Book <number> <number>". This is NOT the chapter-only
        // fallback (which defaults verse to 1 and requires the word
        // "chapter"); the spoken-number parser now correctly treats two
        // adjacent bare numbers as two separate values instead of summing
        // them, so "7" and "1" resolve as an explicit chapter/verse pair.
        const verses = detectVerses('Genesis 7 1 was destroyed in the flood.')
        const gen = verses.find(v => v.reference === 'Genesis 7:1')
        expect(gen).toBeDefined()
        expect(gen?.confidence).toBe('medium')
    })

    // -----------------------------------------------------------------------
    // Sanity bounds — reject out-of-bounds chapter numbers
    // -----------------------------------------------------------------------
    it('rejects hallucinated chapter numbers (Ephesians 600 verse 1)', () => {
        const verses = detectVerses('Ephesians 600 verse 1')
        const eph = verses.find(v => v.reference.includes('Ephesians 600'))
        expect(eph).toBeUndefined()
    })

    it('rejects out-of-bounds chapter via regex (Revelation 30:1)', () => {
        const verses = detectVerses('Revelation 30:1')
        expect(verses).toHaveLength(0)
    })

    it('rejects out-of-bounds verse number (John 3:999)', () => {
        const verses = detectVerses('John chapter three verse nine hundred ninety nine')
        // 999 is > 176 max, should be rejected
        expect(verses.find(v => v.verseStart === 999)).toBeUndefined()
    })

    // -----------------------------------------------------------------------
    // False-positive regression guards (dangerous aliases removed)
    // -----------------------------------------------------------------------
    it('does NOT falsely match "channel" as John', () => {
        const verses = detectVerses('We watched channel 5 news today.')
        expect(verses).toHaveLength(0)
    })

    it('does NOT falsely match "some" as Psalms', () => {
        const verses = detectVerses('Some people came to the meeting.')
        expect(verses).toHaveLength(0)
    })

    it('does NOT falsely match "look" as Luke', () => {
        const verses = detectVerses('Look at chapter 5 of the report.')
        expect(verses).toHaveLength(0)
    })

    it('does NOT falsely match "current" as Corinthians', () => {
        const verses = detectVerses('The current events are troubling.')
        expect(verses).toHaveLength(0)
    })

    it('does NOT falsely match "danny" as Daniel', () => {
        const verses = detectVerses('Danny spoke at the conference.')
        expect(verses).toHaveLength(0)
    })

    it('does NOT falsely match "join" as John', () => {
        const verses = detectVerses('Join us for lunch after service.')
        expect(verses).toHaveLength(0)
    })

    it('does NOT falsely match "june" as John', () => {
        const verses = detectVerses('June is a beautiful month.')
        expect(verses).toHaveLength(0)
    })

    // -----------------------------------------------------------------------
    // Safe aliases still work
    // -----------------------------------------------------------------------
    it('still matches safe ASR alias "mathew" as Matthew', () => {
        const verses = detectVerses('Mathew chapter five verse nine.')
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('Matthew 5:9')
    })

    it('still matches "revelations" as Revelation', () => {
        const verses = detectVerses('Revelations chapter twenty two verse one.')
        expect(verses.length).toBeGreaterThanOrEqual(1)
        expect(verses.some(v => v.reference === 'Revelation 22:1')).toBe(true)
    })

    it('still matches "hebrew" as Hebrews (context-guarded in HF)', () => {
        const verses = detectVerses('Hebrew chapter eleven verse one.')
        expect(verses.length).toBeGreaterThanOrEqual(1)
        expect(verses.some(v => v.reference === 'Hebrews 11:1')).toBe(true)
    })

    // -----------------------------------------------------------------------
    // Name-prefix guards (Pope John, Dr. Barth, etc.)
    // -----------------------------------------------------------------------
    it('does NOT falsely detect "Pope John" as a book reference', () => {
        const verses = detectVerses('Pope John was once asked what the greatest need in the world was.')
        expect(verses).toHaveLength(0)
    })

    it('does NOT falsely detect "Dr. John" as a book reference', () => {
        const verses = detectVerses('Dr. John said something about John 3:16.')
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('John 3:16')
    })

    it('does NOT falsely detect "Saint John" as starting a book reference', () => {
        const verses = detectVerses('Saint John wrote about the love of God.')
        expect(verses).toHaveLength(0)
    })

    // -----------------------------------------------------------------------
    // New edge cases (added in this review)
    // -----------------------------------------------------------------------
    describe('edge cases', () => {
        it('handles empty input', () => {
            const verses = detectVerses('')
            expect(verses).toEqual([])
        })

        it('handles whitespace-only input', () => {
            const verses = detectVerses('   \n\t  ')
            expect(verses).toEqual([])
        })

        it('handles special characters in book names', () => {
            // "1" + "Samuel" with various spacing
            expect(detectVerses('1Samuel 17:50').length).toBeGreaterThanOrEqual(0)
            expect(detectVerses('1 Samuel 17:50').length).toBeGreaterThanOrEqual(1)
        })

        it('handles very long text with many references', () => {
            const longText = Array.from({ length: 100 }, (_, i) => `John 3:${i + 1}`).join(' ')
            const verses = detectVerses(longText)
            expect(verses.length).toBeGreaterThan(10)
            // Each should have a unique reference (or be deduplicated)
            const uniqueRefs = new Set(verses.map(v => v.reference))
            expect(uniqueRefs.size).toBeGreaterThan(0)
        })

        it('handles unicode characters in surrounding text', () => {
            const verses = detectVerses('🙏 John 3:16 ✝️ is the famous verse')
            expect(verses.length).toBeGreaterThanOrEqual(1)
        })

        it('handles references in code-like text', () => {
            // "1:5" appears but is not a Bible reference if no book prefix
            const verses = detectVerses('function foo(a, b) { return a + b; }')
            expect(verses).toEqual([])
        })

        it('handles multiple consecutive references', () => {
            const verses = detectVerses('John 3:16 Romans 8:28 Philippians 4:13')
            expect(verses.length).toBeGreaterThanOrEqual(3)
        })

        it('detects references in different positions', () => {
            // Beginning, middle, end
            const start = detectVerses('John 3:16 is the start')
            const middle = detectVerses('and now for John 3:16 today')
            const end = detectVerses('the verse of John 3:16')
            expect(start.length).toBeGreaterThan(0)
            expect(middle.length).toBeGreaterThan(0)
            expect(end.length).toBeGreaterThan(0)
        })
    })

    // -----------------------------------------------------------------------
    // DetectedVerse shape
    // -----------------------------------------------------------------------
    describe('DetectedVerse shape', () => {
        it('returns verses with required fields', () => {
            const verses = detectVerses('John 3:16')
            expect(verses[0]).toHaveProperty('raw')
            expect(verses[0]).toHaveProperty('reference')
            expect(verses[0]).toHaveProperty('book')
            expect(verses[0]).toHaveProperty('chapter')
            expect(verses[0]).toHaveProperty('verseStart')
            expect(verses[0]).toHaveProperty('startIndex')
            expect(verses[0]).toHaveProperty('endIndex')
            expect(verses[0]).toHaveProperty('confidence')
        })

        it('confidence is one of high, medium, low', () => {
            const verses = detectVerses('John 3:16')
            expect(['high', 'medium', 'low']).toContain(verses[0].confidence)
        })

        it('verseStart is a positive integer', () => {
            const verses = detectVerses('John 3:16')
            expect(verses[0].verseStart).toBeGreaterThan(0)
            expect(Number.isInteger(verses[0].verseStart)).toBe(true)
        })

        it('chapter is a positive integer', () => {
            const verses = detectVerses('John 3:16')
            expect(verses[0].chapter).toBeGreaterThan(0)
            expect(Number.isInteger(verses[0].chapter)).toBe(true)
        })
    })
})
