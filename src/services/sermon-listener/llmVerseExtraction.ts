/**
 * Optional LLM augmentation for sermon transcripts.
 *
 * When (and only when) the user has configured an OpenAI-compatible endpoint,
 * this sends a chunk of transcript to the model and asks for:
 *   1. a lightly cleaned version of the text, and
 *   2. any scripture references it contains, as structured JSON.
 *
 * The point is recall: an LLM understands paraphrased/indirect references the
 * regex + embedding detectors miss ("Paul's letter to the church at Philippi,
 * chapter four" → Philippians 4). Results are validated against the canonical
 * book/chapter/verse tables and de-duplicated against what the local detector
 * already found, so the LLM only ever *adds* verses — it never overrides the
 * fast, free local path. With no config, every function here is a no-op.
 */

import {
    type DetectedVerse,
    normalizeBookName,
    BOOK_MAX_CHAPTER,
    BOOK_MAX_VERSES,
} from './verseDetection'
import { isLlmConfigured, llmChatJson, type LlmConfig } from './llmClient'

const SYSTEM_PROMPT = [
    'You analyze live sermon transcript snippets.',
    'Return ONLY a JSON object with this exact shape:',
    '{ "cleanedText": string, "verses": [ { "book": string, "chapter": number, "verseStart": number, "verseEnd": number | null } ] }.',
    'cleanedText: the input with filler words and obvious transcription noise removed; keep wording otherwise.',
    'verses: every Bible reference mentioned, including indirect ones',
    '("the apostle Paul tells the Philippians in chapter 4" -> book "Philippians", chapter 4).',
    'Use full English book names (e.g. "1 Corinthians", "Psalms", "Revelation").',
    'If a reference has no specific verse, set verseStart to 1 and verseEnd to null.',
    'If there are no references, return an empty verses array. Do not invent references.',
].join(' ')

/** Raw shape we expect back from the model (before validation). */
interface RawExtraction {
    cleanedText?: unknown
    verses?: unknown
}

export interface ExtractionResult {
    cleanedText?: string
    /** New verses not already present in the local detector output. */
    newVerses: DetectedVerse[]
}

const EMPTY: ExtractionResult = { newVerses: [] }

/** Canonical reference string matching the local detector's format. */
function buildReference(book: string, chapter: number, verseStart: number, verseEnd?: number): string {
    const base = `${book} ${chapter}:${verseStart}`
    return verseEnd && verseEnd > verseStart ? `${base}-${verseEnd}` : base
}

/**
 * Validate one raw verse object against the canonical tables. Returns a
 * DetectedVerse or null if the book is unknown or the chapter/verse is out of
 * range (rejects model hallucinations like "Genesis 51").
 */
export function validateExtractedVerse(raw: unknown): DetectedVerse | null {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>

    const bookRaw = typeof r.book === 'string' ? r.book : null
    const chapter = typeof r.chapter === 'number' ? r.chapter : Number(r.chapter)
    let verseStart = typeof r.verseStart === 'number' ? r.verseStart : Number(r.verseStart)
    const verseEndRaw = r.verseEnd == null ? undefined : Number(r.verseEnd)

    if (!bookRaw || !Number.isFinite(chapter)) return null

    const book = normalizeBookName(bookRaw)
    if (!book) return null

    if (chapter < 1) return null
    const maxChapter = BOOK_MAX_CHAPTER[book]
    if (maxChapter && chapter > maxChapter) return null

    if (!Number.isFinite(verseStart) || verseStart < 1) verseStart = 1
    const maxVerses = BOOK_MAX_VERSES[book]?.[chapter] // 1-indexed by chapter
    if (maxVerses && verseStart > maxVerses) return null

    const verseEnd = verseEndRaw && Number.isFinite(verseEndRaw) && verseEndRaw > verseStart
        ? verseEndRaw
        : undefined

    const reference = buildReference(book, chapter, verseStart, verseEnd)
    return {
        raw: reference,
        reference,
        book,
        chapter,
        verseStart,
        verseEnd,
        startIndex: 0,
        endIndex: 0,
        confidence: 'medium',
        detectionType: 'llm',
    }
}

/** Parse + validate a raw model response into DetectedVerses. */
export function parseExtraction(obj: RawExtraction): { cleanedText?: string; verses: DetectedVerse[] } {
    const cleanedText = typeof obj.cleanedText === 'string' ? obj.cleanedText : undefined
    const versesArr = Array.isArray(obj.verses) ? obj.verses : []
    const verses: DetectedVerse[] = []
    const seen = new Set<string>()
    for (const v of versesArr) {
        const detected = validateExtractedVerse(v)
        if (detected && !seen.has(detected.reference)) {
            seen.add(detected.reference)
            verses.push(detected)
        }
    }
    return { cleanedText, verses }
}

/**
 * Drop any extracted verses whose reference the local detector already found
 * (case-insensitive). Returns only the genuinely new ones.
 */
export function mergeNewVerses(extracted: DetectedVerse[], alreadyDetected: Iterable<string>): DetectedVerse[] {
    const existing = new Set<string>()
    for (const ref of alreadyDetected) existing.add(ref.toLowerCase())
    return extracted.filter((v) => !existing.has(v.reference.toLowerCase()))
}

/**
 * Run the optional LLM extraction pass.
 *
 * @param transcript        Recent transcript text to analyze.
 * @param config            LLM config; if not configured this returns EMPTY.
 * @param alreadyDetected   References the local detector already surfaced.
 * @returns cleaned text (if any) and only the NEW verses to add.
 */
export async function extractVersesWithLLM(
    transcript: string,
    config: Partial<LlmConfig> | null | undefined,
    alreadyDetected: Iterable<string> = [],
    signal?: AbortSignal,
): Promise<ExtractionResult> {
    if (!isLlmConfigured(config)) return EMPTY
    const text = transcript.trim()
    if (text.length < 8) return EMPTY

    let raw: RawExtraction
    try {
        raw = await llmChatJson<RawExtraction>(config, SYSTEM_PROMPT, text, { signal })
    } catch (err) {
        // The LLM is a best-effort augmentation — never break listening over it.
        console.warn('[llmVerseExtraction] extraction failed (continuing with local detection):', err)
        return EMPTY
    }

    const { cleanedText, verses } = parseExtraction(raw)
    return {
        cleanedText,
        newVerses: mergeNewVerses(verses, alreadyDetected),
    }
}
