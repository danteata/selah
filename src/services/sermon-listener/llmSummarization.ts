/**
 * LLM-backed sermon summarization (structured output).
 *
 * Uses the same optional OpenAI-compatible client as verse extraction
 * (`llmClient`). When configured it produces a genuinely abstractive summary
 * plus a structured outline — far better than the local extractive/heuristic
 * fallbacks. When not configured, callers fall back to the offline path
 * (Transformers.js abstractive → embedding extractive → heuristic).
 */

import { isLlmConfigured, llmChatJson, type LlmConfig } from './llmClient'

export interface SermonSummary {
    /** 2–4 sentence plain-language overview. */
    summary: string
    /** Main teaching points, in the order preached. */
    keyPoints: string[]
    /** Optional sermon flow / section headings. */
    outline: string[]
    /** Practical application / takeaways. */
    application: string[]
}

const SYSTEM_PROMPT = [
    'You are an assistant that produces structured notes from a sermon transcript.',
    'The transcript may contain ASR noise; infer intent and ignore obvious errors.',
    'Return ONLY a JSON object with this exact shape:',
    '{ "summary": string, "keyPoints": string[], "outline": string[], "application": string[] }.',
    'summary: 2–4 sentences capturing the central message.',
    'keyPoints: 3–7 concise main teaching points, in the order preached.',
    'outline: optional section headings showing the sermon flow (empty array if unclear).',
    'application: 1–4 practical, actionable takeaways for the listener.',
    'Do not include scripture lookups or invent content not supported by the transcript.',
].join(' ')

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
}

/** Parse + sanitize a raw model response into a SermonSummary. */
export function parseSermonSummary(raw: unknown): SermonSummary | null {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const summary = typeof r.summary === 'string' ? r.summary.trim() : ''
    const keyPoints = asStringArray(r.keyPoints)
    const outline = asStringArray(r.outline)
    const application = asStringArray(r.application)

    // Need at least a summary or some key points to be useful.
    if (!summary && keyPoints.length === 0) return null
    return { summary, keyPoints, outline, application }
}

/**
 * Summarize a transcript with the configured LLM. Returns `null` when the LLM
 * is not configured or the call fails, so callers fall back to offline methods.
 */
export async function summarizeWithLLM(
    text: string,
    config: Partial<LlmConfig> | null | undefined,
    signal?: AbortSignal,
): Promise<SermonSummary | null> {
    if (!isLlmConfigured(config)) return null
    const trimmed = text.trim()
    if (trimmed.length < 50) return null

    try {
        const raw = await llmChatJson(config, SYSTEM_PROMPT, trimmed, { signal, timeoutMs: 30000 })
        return parseSermonSummary(raw)
    } catch (err) {
        console.warn('[llmSummarization] LLM summary failed (falling back to offline):', err)
        return null
    }
}

/** Render a SermonSummary as a flat plain-text summary (for the summary field). */
export function summaryToText(s: SermonSummary): string {
    if (s.summary) return s.summary
    return s.keyPoints.join(' ')
}
