import { describe, it, expect, afterEach, vi } from 'vitest'
import {
    validateExtractedVerse,
    parseExtraction,
    mergeNewVerses,
    extractVersesWithLLM,
} from '../llmVerseExtraction'
import { isLlmConfigured, parseJsonLoose, llmChatJson, resetLlmRateLimitState, type LlmConfig } from '../llmClient'

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

    it('clamps a range end past the end of the chapter', () => {
        // Jude is a single 25-verse chapter. An invented end must not pass just
        // because the start is valid — this is how two separate spoken
        // references got fused into one impossible span.
        const v = validateExtractedVerse({ book: 'Jude', chapter: 1, verseStart: 1, verseEnd: 40 })
        expect(v?.verseEnd).toBe(25)
        expect(v?.reference).toBe('Jude 1:1-25')
    })

    it('drops a range end that would clamp below the start', () => {
        const v = validateExtractedVerse({ book: 'Jude', chapter: 1, verseStart: 25, verseEnd: 40 })
        expect(v?.verseEnd).toBeUndefined()
        expect(v?.reference).toBe('Jude 1:25')
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

    // A passage read aloud gets re-extracted as the transcript grows. One live
    // sermon emitted Isaiah 43:1, then 43:1-3, then 43:1-17 as separate cards.
    it('drops a widened range over an already-detected verse', () => {
        const extracted = parseExtraction({
            verses: [{ book: 'Isaiah', chapter: 43, verseStart: 1, verseEnd: 17 }],
        }).verses
        expect(mergeNewVerses(extracted, ['Isaiah 43:1'])).toEqual([])
    })

    it('drops a range that overlaps an already-detected range', () => {
        const extracted = parseExtraction({
            verses: [{ book: 'Colossians', chapter: 3, verseStart: 12, verseEnd: 17 }],
        }).verses
        expect(mergeNewVerses(extracted, ['Colossians 3:12-13'])).toEqual([])
    })

    it('keeps a non-overlapping range in the same chapter', () => {
        const extracted = parseExtraction({
            verses: [{ book: 'Colossians', chapter: 3, verseStart: 18, verseEnd: 20 }],
        }).verses
        expect(mergeNewVerses(extracted, ['Colossians 3:12-17']).map((v) => v.reference))
            .toEqual(['Colossians 3:18-20'])
    })

    it('keeps the same verse numbers in a different chapter', () => {
        const extracted = parseExtraction({
            verses: [{ book: 'Colossians', chapter: 4, verseStart: 12 }],
        }).verses
        expect(mergeNewVerses(extracted, ['Colossians 3:12']).map((v) => v.reference))
            .toEqual(['Colossians 4:12'])
    })
})

describe('llmChatJson rate-limit circuit breaker', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        resetLlmRateLimitState()
    })

    it('backs off after a 429 instead of hitting the network again immediately', async () => {
        // Shared across verse extraction (fires every few seconds while
        // listening) and sermon-notes summarization (fires once at the end) —
        // without this, a 429 from one just gets retried instantly by the
        // other against the same still-exhausted quota.
        const fetchMock = vi.fn().mockResolvedValue({ status: 429, text: async () => '{"error":"quota"}' })
        vi.stubGlobal('fetch', fetchMock)

        await expect(llmChatJson(CONFIG, 'sys', 'user')).rejects.toThrow(/429/)
        expect(fetchMock).toHaveBeenCalledOnce()

        // Immediately retrying should short-circuit locally, not hit fetch again.
        await expect(llmChatJson(CONFIG, 'sys', 'user')).rejects.toThrow(/rate-limited/)
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('resumes hitting the network once the cooldown clears', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ status: 429, text: async () => '{"error":"quota"}' })
            .mockResolvedValueOnce({
                status: 200,
                text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
            })
        vi.stubGlobal('fetch', fetchMock)

        await expect(llmChatJson(CONFIG, 'sys', 'user')).rejects.toThrow(/429/)
        resetLlmRateLimitState() // simulate the cooldown window having elapsed
        await expect(llmChatJson(CONFIG, 'sys', 'user')).resolves.toEqual({ ok: true })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('honors a Retry-After header instead of guessing via exponential backoff', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            status: 429,
            headers: { get: (name: string) => (name === 'retry-after' ? '1' : null) },
            text: async () => '{"error":"quota"}',
        })
        vi.stubGlobal('fetch', fetchMock)

        await expect(llmChatJson(CONFIG, 'sys', 'user')).rejects.toThrow(/429/)
        // Still within the 1s Retry-After window — short-circuits locally.
        await expect(llmChatJson(CONFIG, 'sys', 'user')).rejects.toThrow(/rate-limited/)
        expect(fetchMock).toHaveBeenCalledOnce()

        await new Promise((r) => setTimeout(r, 1100))
        await expect(llmChatJson(CONFIG, 'sys', 'user')).rejects.toThrow(/429/) // hits network again, not blocked locally
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not inherit a cooldown from a different provider/model config', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ status: 429, text: async () => '{"error":"quota"}' })
        vi.stubGlobal('fetch', fetchMock)

        await expect(llmChatJson(CONFIG, 'sys', 'user')).rejects.toThrow(/429/)
        // Same config again — still cooling down, short-circuits locally.
        await expect(llmChatJson(CONFIG, 'sys', 'user')).rejects.toThrow(/rate-limited/)
        expect(fetchMock).toHaveBeenCalledOnce()

        // A different model (e.g. the user switched providers/fixed billing on
        // a new config) should not be blocked by the old config's cooldown.
        const otherConfig: LlmConfig = { ...CONFIG, model: 'other-model' }
        fetchMock.mockResolvedValueOnce({
            status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        })
        await expect(llmChatJson(otherConfig, 'sys', 'user')).resolves.toEqual({ ok: true })
        expect(fetchMock).toHaveBeenCalledTimes(2)
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
            status: 200,
            text: async () => JSON.stringify({
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
