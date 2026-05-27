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
    // Classic formats (existing behaviour)
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

    it('does NOT emit chapter-only reference without "chapter" keyword', () => {
        const verses = detectVerses('Genesis 7 1 was destroyed in the flood.')
        const gen = verses.find(v => v.reference === 'Genesis 7:1')
        // Without the "chapter" keyword we should not guess verse=1;
        // the existing "chapter only" path requires explicit "chapter".
        expect(gen).toBeUndefined()
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
})
