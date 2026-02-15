import { describe, expect, it } from 'vitest'
import {
    detectVerses,
    extractVerseFromContext,
    formatVerseForDisplay,
    hasVerseReference,
    verseToLabel,
} from '../verseDetection'

describe('verseDetection', () => {
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
})
