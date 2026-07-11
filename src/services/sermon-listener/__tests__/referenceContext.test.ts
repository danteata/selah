import { describe, expect, it } from 'vitest'
import {
    createContext,
    isContextValid,
    updateContextFromVerse,
    resolveBareReferences,
} from '../referenceContext'
import type { DetectedVerse } from '../verseDetection'

describe('referenceContext', () => {
    const mockVerse: DetectedVerse = {
        raw: 'Ephesians 6:1',
        reference: 'Ephesians 6:1',
        book: 'Ephesians',
        chapter: 6,
        verseStart: 1,
        startIndex: 0,
        endIndex: 0,
        confidence: 'high',
    }

    it('creates context from a detected verse', () => {
        const ctx = updateContextFromVerse(mockVerse)
        expect(ctx.book).toBe('Ephesians')
        expect(ctx.chapter).toBe(6)
        expect(ctx.setAt).toBeGreaterThan(0)
    })

    it('validates context within TTL', () => {
        const ctx = createContext('Romans', 8)
        expect(isContextValid(ctx, 120_000)).toBe(true)
    })

    it('invalidates context past TTL', () => {
        const ctx = { book: 'John', chapter: 3, setAt: Date.now() - 200_000 }
        expect(isContextValid(ctx, 120_000)).toBe(false)
    })

    it('resolves bare "verse 6" with context', () => {
        const ctx = createContext('Ephesians', 6)
        const verses = resolveBareReferences('and now verse 6', ctx)
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('Ephesians 6:6')
        // Medium confidence: unlike bare "chapter 3", `context` is only ever
        // set from an explicit book+chapter reference, so "verse 6" while
        // that's still fresh is normal continued quoting, not ambiguous.
        expect(verses[0].confidence).toBe('medium')
    })

    it('resolves bare "verses 4 to 7" range with context', () => {
        const ctx = createContext('Ephesians', 6)
        const verses = resolveBareReferences('verses 4 to 7', ctx)
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('Ephesians 6:4-7')
    })

    it('resolves spoken bare verse "verse six" with context', () => {
        const ctx = createContext('John', 3)
        const verses = resolveBareReferences('and verse sixteen', ctx)
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('John 3:16')
    })

    it('resolves bare "chapter 3" as chapter-only with context', () => {
        const ctx = createContext('Romans', 8)
        const verses = resolveBareReferences('chapter 3', ctx)
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('Romans 3:1')
        expect(verses[0].confidence).toBe('low')
    })

    it('does NOT resolve bare chapter when verse matches exist', () => {
        // If the text contains both "verse 5" and "chapter 3",
        // only the verse reference should be emitted.
        const ctx = createContext('Romans', 8)
        const verses = resolveBareReferences('verse 5 and chapter 3', ctx)
        expect(verses).toHaveLength(1)
        expect(verses[0].reference).toBe('Romans 8:5')
    })

    it('returns empty array when context is null', () => {
        const verses = resolveBareReferences('verse 6', null)
        expect(verses).toHaveLength(0)
    })

    it('returns empty array when context has expired', () => {
        const ctx = { book: 'Genesis', chapter: 1, setAt: Date.now() - 200_000 }
        const verses = resolveBareReferences('verse 6', ctx, 120_000)
        expect(verses).toHaveLength(0)
    })

    it('returns empty array when no bare references in text', () => {
        const ctx = createContext('John', 3)
        const verses = resolveBareReferences('God so loved the world.', ctx)
        expect(verses).toHaveLength(0)
    })

    it('does NOT match "universe" or "adverse" as verse', () => {
        const ctx = createContext('John', 3)
        const verses = resolveBareReferences('The universe is vast and adverse conditions exist.', ctx)
        expect(verses).toHaveLength(0)
    })

    it('bare "verse one" resolves at medium confidence once a book is already in context', () => {
        // With a book+chapter already explicitly mentioned, "verse one/two/
        // three" overwhelmingly means the same passage's next verse — this
        // is normal continued quoting, not the same ambiguity as a cold bare
        // chapter number.
        const ctx = createContext('Ephesians', 6)
        const verses = resolveBareReferences('and verse one says this', ctx)
        expect(verses).toHaveLength(1)
        expect(verses[0].confidence).toBe('medium')
    })
})
