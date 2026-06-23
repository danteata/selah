import { describe, it, expect, afterEach, vi } from 'vitest'
import {
    validateExtractedVerse,
    parseExtraction,
    mergeNewVerses,
    extractVersesWithLLM,
} from '../llmVerseExtraction'
import { isLlmConfigured, parseJsonLoose, type LlmConfig } from '../llmClient'

const CONFIG: LlmConfig = {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    enabled: true,
}

describe('llmClient', () => {
    it('isLlmConfigured requires enabled + baseUrl + model', () => {
        expect(isLlmConfigured(null)).toBe(false)
        expect(isLlmConfigured({ baseUrl: 'x', model: 'm', enabled: false })).toBe(false)
        expect(isLlmConfigured({ baseUrl: '', model: 'm', enabled: true })).toBe(false)
        expect(isLlmConfigured({ baseUrl: 'x', model: '', enabled: true })).toBe(false)
        expect(isLlmConfigured({ baseUrl: 'x', model: 'm', enabled: true })).toBe(true)
    })

    it('parseJsonLoose handles plain, fenced, and prose-wrapped JSON', () => {
        expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
        expect(parseJsonLoose<{ a: number }>('```json\n{"a":2}\n```')).toEqual({ a: 2 })
        expect(parseJsonLoose<{ a: number }>('Sure! Here you go: {"a":3} cheers')).toEqual({ a: 3 })
    })
})

describe('validateExtractedVerse', () => {
    it('accepts a valid reference and canonicalizes the book', () => {
        const v = validateExtractedVerse({ book: 'first john', chapter: 4, verseStart: 8, verseEnd: null })
        expect(v).toMatchObject({ book: '1 John', chapter: 4, verseStart: 8, detectionType: 'llm', reference: '1 John 4:8' })
    })

    it('builds a range reference', () => {
        const v = validateExtractedVerse({ book: 'John', chapter: 3, verseStart: 16, verseEnd: 17 })
        expect(v?.reference).toBe('John 3:16-17')
        expect(v?.verseEnd).toBe(17)
    })

    it('defaults a missing verse to 1', () => {
        const v = validateExtractedVerse({ book: 'Philippians', chapter: 4 })
        expect(v).toMatchObject({ chapter: 4, verseStart: 1 })
    })

    it('rejects unknown books', () => {
        expect(validateExtractedVerse({ book: 'Hezekiah', chapter: 1, verseStart: 1 })).toBeNull()
    })

    it('rejects out-of-range chapters (hallucinations)', () => {
        expect(validateExtractedVerse({ book: 'Genesis', chapter: 51, verseStart: 1 })).toBeNull()
    })

    it('rejects malformed input', () => {
        expect(validateExtractedVerse(null)).toBeNull()
        expect(validateExtractedVerse({ chapter: 3 })).toBeNull()
    })
})

describe('parseExtraction', () => {
    it('parses cleanedText and dedupes verses', () => {
        const out = parseExtraction({
            cleanedText: 'For God so loved the world',
            verses: [
                { book: 'John', chapter: 3, verseStart: 16 },
                { book: 'John', chapter: 3, verseStart: 16 }, // dup
                { book: 'Nonsense', chapter: 1, verseStart: 1 }, // invalid
            ],
        })
        expect(out.cleanedText).toBe('For God so loved the world')
        expect(out.verses).toHaveLength(1)
        expect(out.verses[0].reference).toBe('John 3:16')
    })

    it('tolerates a missing verses array', () => {
        expect(parseExtraction({ cleanedText: 'hi' }).verses).toEqual([])
    })
})

describe('mergeNewVerses', () => {
    it('drops verses already detected (case-insensitive)', () => {
        const extracted = parseExtraction({
            verses: [{ book: 'John', chapter: 3, verseStart: 16 }, { book: 'Romans', chapter: 8, verseStart: 28 }],
        }).verses
        const result = mergeNewVerses(extracted, ['john 3:16'])
        expect(result.map((v) => v.reference)).toEqual(['Romans 8:28'])
    })
})

describe('extractVersesWithLLM', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('is a no-op when not configured (offline default)', async () => {
        const result = await extractVersesWithLLM('John 3:16 is great', { enabled: false })
        expect(result).toEqual({ newVerses: [] })
    })

    it('returns only new, validated verses when configured', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: JSON.stringify({
                    cleanedText: 'Paul writes to the Philippians in chapter four',
                    verses: [
                        { book: 'Philippians', chapter: 4, verseStart: 13 },
                        { book: 'Romans', chapter: 8, verseStart: 28 },
                    ],
                }) } }],
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const result = await extractVersesWithLLM(
            'Paul writes to the Philippians in chapter four about contentment',
            CONFIG,
            ['romans 8:28'], // already detected locally
        )

        expect(result.cleanedText).toContain('Philippians')
        expect(result.newVerses.map((v) => v.reference)).toEqual(['Philippians 4:13'])
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('returns EMPTY on network error (never breaks listening)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
        const result = await extractVersesWithLLM('John 3:16', CONFIG)
        expect(result.newVerses).toEqual([])
    })
})
