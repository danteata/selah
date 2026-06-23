import { describe, it, expect, afterEach, vi } from 'vitest'
import { parseSermonSummary, summaryToText, summarizeWithLLM } from '../llmSummarization'
import type { LlmConfig } from '../llmClient'

const CONFIG: LlmConfig = { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', enabled: true }

describe('parseSermonSummary', () => {
    it('parses and sanitizes a full result', () => {
        const s = parseSermonSummary({
            summary: '  God is faithful.  ',
            keyPoints: ['Trust God', '', '  Pray daily  ', 42],
            outline: ['Intro', 'Body'],
            application: ['Pray this week'],
        })
        expect(s).toEqual({
            summary: 'God is faithful.',
            keyPoints: ['Trust God', 'Pray daily'],
            outline: ['Intro', 'Body'],
            application: ['Pray this week'],
        })
    })

    it('accepts key-points-only (no summary)', () => {
        const s = parseSermonSummary({ keyPoints: ['A', 'B'] })
        expect(s?.summary).toBe('')
        expect(s?.keyPoints).toEqual(['A', 'B'])
    })

    it('rejects empty/garbage', () => {
        expect(parseSermonSummary({})).toBeNull()
        expect(parseSermonSummary(null)).toBeNull()
        expect(parseSermonSummary({ summary: '', keyPoints: [] })).toBeNull()
    })
})

describe('summaryToText', () => {
    it('prefers the summary, falls back to key points', () => {
        expect(summaryToText({ summary: 'X', keyPoints: ['a'], outline: [], application: [] })).toBe('X')
        expect(summaryToText({ summary: '', keyPoints: ['a', 'b'], outline: [], application: [] })).toBe('a b')
    })
})

describe('summarizeWithLLM', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('returns null when not configured (offline)', async () => {
        expect(await summarizeWithLLM('long enough sermon text here ...', { enabled: false })).toBeNull()
    })

    it('returns null for trivially short text', async () => {
        expect(await summarizeWithLLM('hi', CONFIG)).toBeNull()
    })

    it('parses a structured response when configured', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: JSON.stringify({
                    summary: 'A sermon about grace.',
                    keyPoints: ['Grace is free', 'Respond in faith'],
                    outline: ['What is grace', 'Living it out'],
                    application: ['Extend grace to others'],
                }) } }],
            }),
        }))
        const s = await summarizeWithLLM('A reasonably long transcript about grace and faith and the gospel.', CONFIG)
        expect(s?.summary).toBe('A sermon about grace.')
        expect(s?.keyPoints).toHaveLength(2)
    })

    it('returns null on error (so callers fall back offline)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
        expect(await summarizeWithLLM('A reasonably long transcript about grace and faith.', CONFIG)).toBeNull()
    })
})
