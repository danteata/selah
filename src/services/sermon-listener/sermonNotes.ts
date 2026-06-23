/**
 * Sermon Notes Generation Service
 *
 * Uses extractive summarization to pick the most representative, coherent
 * sentences from the transcript. Applies aggressive hallucination/gibberish
 * filtering before selection to avoid picking garbled ASR output.
 *
 * Architecture (best → fallback):
 * 1. LLM (optional, OpenAI-compatible): genuine abstractive summary + structured
 *    outline. Used whenever the user configured an endpoint.
 * 2. Local abstractive (Transformers.js distilbart): offline paraphrased summary.
 * 3. Embedding-based extractive: semantic similarity scoring, reuses the verse
 *    embedding model (no extra download).
 * 4. Heuristic: always available, no model dependency.
 */

import type { TranscriptSegment } from '../../types/sermon-listener'
import { embedBatch, isEmbedderReady } from './localEmbeddings'
import { isAbstractiveSummarizerReady, setupAbstractiveSummarizer, summarizeAbstractive } from './abstractiveSummarization'
import { summarizeWithLLM, summaryToText, type SermonSummary } from './llmSummarization'
import { useAppStore } from '../../store/appStore'

// --- Quality filtering ---

/** Common English words that indicate a real sentence. */
const STRONG_CONTENT_WORDS = new Set([
    'god', 'jesus', 'christ', 'lord', 'spirit', 'holy', 'grace', 'faith',
    'love', 'hope', 'peace', 'mercy', 'salvation', 'sin', 'repent',
    'forgive', 'believe', 'trust', 'pray', 'prayer', 'church', 'bible',
    'scripture', 'gospel', 'heaven', 'kingdom', 'righteousness', 'truth',
    'wisdom', 'purpose', 'calling', 'ministry', 'worship', 'praise',
    'serve', 'serving', 'obedience', 'blessing', 'blessed', 'promise',
    'covenant', 'sacrifice', 'cross', 'resurrection', 'eternal', 'life',
    'death', 'buried', 'rose', 'ascended', 'return', 'second', 'coming',
    'pastor', 'sermon', 'preaching', 'teaching', 'congregation', 'flock',
    'shepherd', 'fellowship', 'communion', 'baptism', 'disciple',
    'mission', 'evangelism', 'witness', 'testimony', 'miracle', 'healing',
    'deliverance', 'freedom', 'bondage', 'temptation', 'trial', 'testing',
    'endurance', 'patience', 'perseverance', 'joy', 'gentleness',
    'kindness', 'goodness', 'faithfulness', 'self', 'control',
    'thanksgiving', 'gratitude', 'humility', 'humble', 'proud', 'pride',
    'heart', 'soul', 'mind', 'strength', 'neighbor', 'enemy',
    'brother', 'sister', 'father', 'mother', 'family', 'marriage',
    'children', 'obey', 'honor', 'respect', 'authority', 'government',
    'justice', 'judgment', 'wrath', 'mercy', 'compassion',
    'righteous', 'wicked', 'evil', 'good', 'light', 'darkness',
    'born', 'again', 'transformed', 'renewed', 'sanctified', 'justified',
    'redeemed', 'adopted', 'inheritance', 'heir', 'firstborn', 'creation',
])

/**
 * Score a sentence's quality as a sermon key point.
 * Returns 0-1 where higher means more likely to be real, coherent content.
 */
function scoreSentenceQuality(sentence: string): number {
    const words = sentence.split(/\s+/).filter(Boolean)
    if (words.length < 7 || sentence.length < 40) return 0

    let score = 0

    // Word diversity — garbled output repeats words
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z']/g, '')))
    const diversity = uniqueWords.size / words.length
    if (diversity < 0.5) return 0 // too repetitive
    score += diversity * 0.2

    // Content word ratio — real sentences have substance words
    const contentWords = words.filter(w => {
        const lower = w.toLowerCase().replace(/[^a-z']/g, '')
        return lower.length > 3 || STRONG_CONTENT_WORDS.has(lower)
    })
    const contentRatio = contentWords.length / words.length
    if (contentRatio < 0.35) return 0 // too many filler/short words
    score += contentRatio * 0.2

    // Check for real verb content
    const verbPattern = /\b(is|are|was|were|be|been|have|has|had|do|does|did|will|would|can|could|should|shall|may|might|must|go|goes|went|come|comes|came|make|makes|made|take|takes|took|give|gives|gave|know|knows|knew|think|thinks|thought|say|says|said|see|sees|saw|want|wants|need|needs|tell|tells|told|call|calls|find|finds|found|keep|keeps|let|lets|begin|show|shows|live|lives|love|loves|work|works|help|helps|look|looks|believe|believe|serves|honor|pray|walk|stand|turn|bring|send|build|hold|speak|hear|raise|teach|preach|lead|seek|trust|follow|worship|save|grow|choose|receive|remember|understand|forgive|promise|bless|comfort|encourage|strengthen|deliver|provide|protect|guide|restore|redeem|heal|fulfill)\b/i
    if (!verbPattern.test(sentence)) return 0.05 // extremely low, no real verbs

    // Gibberish detection — words that don't look like English
    const gibberishWords = words.filter(w => {
        const clean = w.toLowerCase().replace(/[^a-z]/g, '')
        if (clean.length <= 2) return false
        // No vowels = likely gibberish (e.g. "utabe" → u-t-a-b-e has vowels, but "kjkl" doesn't)
        if (!/[aeiouy]/i.test(clean)) return true
        // Too many consonants in a row
        if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(clean)) return true
        // Repeating character patterns (e.g. "ho ho ho")
        if (/(..+)\1{2,}/.test(clean)) return true
        return false
    })
    const gibberishRatio = gibberishWords.length / words.length
    if (gibberishRatio > 0.15) return 0 // too much gibberish

    // Unknown word ratio — words that are likely misheard ASR output
    // A word is "unknown" if it's 4+ chars, not in our word lists, and
    // doesn't look like a common English word pattern
    const knownWords = new Set([
        // Top 500 most common English words (enough to filter out obvious non-English)
        'the','be','to','of','and','a','in','that','have','i','it','for','not','on','with','he',
        'as','you','do','at','this','but','his','by','from','they','we','say','her','she','or','an',
        'will','my','one','all','would','there','their','what','so','up','out','if','about','who',
        'get','which','go','me','when','make','can','like','time','no','just','him','know','take',
        'people','into','year','your','good','some','could','them','see','other','than','then','now',
        'look','only','come','its','over','think','also','back','after','use','two','how','our',
        'work','first','well','way','even','new','want','because','any','these','give','day','most',
        'us','great','between','need','large','often','hand','high','place','hold','state','still',
        'own','found','answer','why','down','much','should','before','right','each','around','many',
        'must','through','where','start','world','next','keep','point','change','old','begin','need',
        'help','turn','move','live','thing','man','men','day','run','show','every','long','away',
        'again','home','last','open','small','play','end','put','under','read','old','own','same',
        'big','set','few','may','made','call','off','along','line','house','sit','town',
        // Sermon/religious words (supplementing STRONG_CONTENT_WORDS)
        'pastor','church','sermon','verse','chapter','bible','scripture','christian','faith','prayer',
        'god','jesus','lord','holy','spirit','grace','mercy','love','peace','hope','sin','repent',
        'forgive','believe','trust','serve','obey','honor','glory','heaven','cross','blood','salvation',
        'gospel','king','priest','prophet','angel','soul','eternal','righteous','wicked','judgment',
        // Common names/titles in sermons
        'pastor','brother','sister','father','mother','david','moses','abraham','isaac','jacob',
        'joseph','peter','paul','john','james','matthew','mark','luke','ruth','esther','mary',
        'elisha','elijah','samuel','solomon','daniel','nehemiah','ezra','job','psalms','proverbs',
        'ghana','nigeria','africa','christianity','christians',
    ])
    const unknownWords = words.filter(w => {
        const clean = w.toLowerCase().replace(/[^a-z]/g, '')
        if (clean.length < 4) return false
        if (knownWords.has(clean)) return false
        if (STRONG_CONTENT_WORDS.has(clean)) return false
        // If it starts with a capital letter in the middle of a sentence,
        // it might be a proper noun (name/place) — allow those
        if (w[0] === w[0].toUpperCase() && w.length > 2) return false
        // Unknown 4+ letter word
        return true
    })
    const unknownRatio = unknownWords.length / words.length
    if (unknownRatio > 0.15) return 0 // too many unknown words, likely garbled
    // Penalize (but don't reject) sentences with some unknown words
    score -= unknownRatio * 0.5

    // Sentence length bonus — longer sentences tend to be more substantive
    score += Math.min(words.length / 25, 1) * 0.15

    // Bonus for sermon-specific content words
    const sermonWords = words.filter(w => STRONG_CONTENT_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')))
    score += Math.min(sermonWords.length / 3, 1) * 0.25

    return Math.max(0, Math.min(score, 1))
}

/**
 * Split transcript into sentences and aggressively filter out
 * hallucinated/garbled ASR output before summarization.
 */
function cleanAndSplitSentences(text: string): string[] {
    // Phase 1: Basic cleanup
    let cleaned = text
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    // Phase 2: Remove obvious filler sounds
    cleaned = cleaned.replace(/\b(um+|uh+|ah+|hmm+|heh+|ha+|huh+|you+ know|like|I mean|you see)\b/gi, '')

    // Phase 3: Split into sentences
    const sentences: string[] = []
    let current = ''
    for (const char of cleaned) {
        current += char
        if (/[.!?]/.test(char)) {
            const trimmed = current.trim()
            if (trimmed) sentences.push(trimmed)
            current = ''
        }
    }
    if (current.trim()) sentences.push(current.trim())

    // Phase 4: Filter by quality score
    return sentences
        .map(s => ({ text: s, score: scoreSentenceQuality(s) }))
        .filter(s => s.score > 0.3)
        .sort((a, b) => a.text.localeCompare(b.text) ? 0 : b.score - a.score) // stable-ish
        .map(s => s.text)
}

// --- Embedding-based extractive summarization ---

interface ScoredSentence {
    text: string
    score: number
    index: number
}

async function extractiveSummarizeWithEmbeddings(
    text: string,
    sentenceCount: number = 6
): Promise<string[]> {
    if (!isEmbedderReady()) {
        console.log('[SermonNotes] Embedder not ready, skipping embedding-based extraction')
        return heuristicKeyPoints(text).slice(0, sentenceCount)
    }

    const rawSentences = cleanAndSplitSentences(text)
    if (rawSentences.length === 0) return []

    // Limit to a manageable number of sentences for embedding
    const maxSentences = 30
    const sentences = rawSentences.length > maxSentences
        ? rawSentences
              .map((s, i) => ({ s, i, q: scoreSentenceQuality(s) }))
              .sort((a, b) => b.q - a.q)
              .slice(0, maxSentences)
              .sort((a, b) => a.i - b.i)
              .map(x => x.s)
        : rawSentences

    try {
        const results = await embedBatch(sentences)

        if (!results || results.length === 0) {
            return heuristicKeyPoints(text).slice(0, sentenceCount)
        }

        const validResults = results.filter((r): r is NonNullable<typeof r> => r?.embedding != null && r.embedding.length > 0)
        if (validResults.length === 0) {
            return heuristicKeyPoints(text).slice(0, sentenceCount)
        }

        // Compute centroid from valid embeddings
        const dim = validResults[0].embedding.length
        const centroid = new Float32Array(dim)
        for (const r of validResults) {
            for (let i = 0; i < dim; i++) {
                centroid[i] += r.embedding[i] / validResults.length
            }
        }

        // Score each sentence: cosine similarity to centroid + quality bonus
        const scored: ScoredSentence[] = sentences.map((text, index) => {
            const result = results[index]
            if (!result?.embedding) return { text, score: 0, index }

            const similarity = cosineSimilarity(result.embedding, Array.from(centroid))
            const quality = scoreSentenceQuality(text)
            // Combine: similarity gives relevance, quality discards gibberish
            const combined = similarity * 0.6 + quality * 0.4

            return { text, score: combined, index }
        })

        // Select top sentences, preserving original order
        scored.sort((a, b) => b.score - a.score)
        const selected = scored
            .slice(0, sentenceCount)
            .sort((a, b) => a.index - b.index)

        return selected.map(s => s.text)
    } catch (err) {
        console.warn('[SermonNotes] Embedding-based extraction failed, using heuristic fallback:', err)
        return heuristicKeyPoints(text).slice(0, sentenceCount)
    }
}

function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
}

function heuristicKeyPoints(text: string): string[] {
    const candidates = cleanAndSplitSentences(text)
    if (candidates.length === 0) return []

    // Deduplicate: skip sentences that overlap >60% word content with an earlier one
    const deduped: string[] = []
    for (const s of candidates) {
        const sWords = new Set(s.toLowerCase().split(/\s+/))
        const isDup = deduped.some(d => {
            const dWords = new Set(d.toLowerCase().split(/\s+/))
            const intersection = [...sWords].filter(w => dWords.has(w)).length
            const union = new Set([...sWords, ...dWords]).size
            return union > 0 && intersection / union > 0.6
        })
        if (!isDup) deduped.push(s)
    }

    // Score by quality and pick the best
    const scored = deduped.map(s => ({
        text: s,
        score: scoreSentenceQuality(s),
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 6).map(s => s.text)
}

// --- Public API ---

export interface SummarizeOptions {
    sentenceCount?: number
}

export function isSummarizerReady(): boolean {
    return isAbstractiveSummarizerReady()
}

export async function setupSummarizer(_localModelPath?: string | null): Promise<void> {
    // Fire-and-forget: try to load the local summarization model
    // It downloads ~330MB on first use, so we don't block startup
    setupAbstractiveSummarizer().catch(() => {
        // Model not available — extractive fallback will be used
    })
}

/**
 * Summarize text using the best available method.
 *
 * Priority:
 * 1. LLM (OpenAI-compatible) — genuine abstractive summary, when configured
 * 2. Local abstractive (distilbart via Transformers.js) — offline paraphrased
 * 3. Embedding-based extractive — semantic similarity scoring
 * 4. Heuristic fallback — word frequency + quality scoring
 */
export async function summarizeText(
    text: string,
    options?: SummarizeOptions
): Promise<string> {
    if (!text || text.trim().length < 50) {
        return ''
    }

    const sentenceCount = options?.sentenceCount ?? 6

    // 1. Try the configured LLM (best quality; no-op when not configured)
    const llmConfig = useAppStore.getState().settings.llm
    const llmResult = await summarizeWithLLM(text, llmConfig)
    if (llmResult) {
        console.log('[SermonNotes] Used LLM summarization')
        return summaryToText(llmResult)
    }

    // 2. Try local abstractive model (runs in browser via Web Worker)
    if (isAbstractiveSummarizerReady()) {
        try {
            const result = await summarizeAbstractive(
                text,
                Math.max(sentenceCount * 20, 80),
                Math.max(sentenceCount * 8, 30),
            )
            if (result && result.length > 20) {
                console.log('[SermonNotes] Used local abstractive summarization')
                return result
            }
            console.log('[SermonNotes] Local abstractive returned too short (', result?.length ?? 0, 'chars), skipping')
        } catch (err) {
            console.warn('[SermonNotes] Local abstractive failed, trying extractive:', err)
        }
    } else {
        console.log('[SermonNotes] Local abstractive skipped — model not ready')
    }

    // 3. Fall back to embedding-based extractive summarization
    console.log('[SermonNotes] Falling back to embedding-based extraction')
    try {
        const keyPoints = await extractiveSummarizeWithEmbeddings(text, sentenceCount)
        if (keyPoints.length > 0) {
            console.log('[SermonNotes] Used embedding-based extractive summarization (', keyPoints.length, 'key points)')
            return keyPoints.join(' ')
        }
        console.log('[SermonNotes] Embedding extraction returned 0 key points')
    } catch (err) {
        console.warn('[SermonNotes] Embedding-based extraction failed, using heuristic fallback:', err)
    }

    // Last resort: heuristic extraction
    const heuristic = heuristicKeyPoints(text).slice(0, sentenceCount)
    console.log('[SermonNotes] Used heuristic fallback (', heuristic.length, 'key points)')
    return heuristic.join(' ')
}

/**
 * Generate structured sermon notes from transcript segments and detected verses.
 */
export async function generateSermonNotes(
    segments: TranscriptSegment[],
    detectedVerses: Array<{ reference: string; confidence?: string; book?: string; chapter?: number; verseStart?: number; verseEnd?: number }>,
    _options?: { language?: string }
): Promise<string> {
    const fullText = segments.map(s => s.text).join(' ').trim()

    if (!fullText || fullText.length < 50) {
        return buildHeuristicNotes(segments, detectedVerses, fullText)
    }

    // Prefer rich, structured notes from the LLM when configured.
    const llmConfig = useAppStore.getState().settings.llm
    const llmSummary = await summarizeWithLLM(fullText, llmConfig)
    if (llmSummary) {
        console.log('[SermonNotes] Built notes from LLM structured summary')
        return buildNotesFromLLM(segments, detectedVerses, fullText, llmSummary)
    }

    // Offline path: best-effort summary + heuristic structure.
    let aiSummary = ''
    try {
        aiSummary = await summarizeText(fullText, { sentenceCount: 6 })
    } catch (err) {
        console.warn('[SermonNotes] Summarization failed, using heuristic only:', err)
    }

    return buildStructuredNotes(segments, detectedVerses, fullText, aiSummary)
}

/** Format rich sermon notes from the LLM's structured summary. */
function buildNotesFromLLM(
    segments: TranscriptSegment[],
    detectedVerses: Array<{ reference: string; confidence?: string }>,
    fullText: string,
    summary: SermonSummary,
): string {
    const uniqueVerses = Array.from(
        new Set(detectedVerses.filter(v => v.confidence !== 'low').map(v => v.reference)),
    )

    const lastSegment = segments[segments.length - 1]
    const durationSec = lastSegment ? Math.round(lastSegment.endMs / 1000) : 0
    const durationStr = durationSec > 0
        ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
        : `${(fullText.length / 5).toFixed(0)} words`

    const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━'
    const section = (title: string, body: string) => [divider, title, divider, body, ''].join('\n')

    const parts: string[] = [
        `Sermon Notes — ${new Date().toLocaleString()}`,
        `Duration: ${durationStr}`,
        '',
    ]

    if (summary.summary) parts.push(section('SUMMARY', summary.summary))

    parts.push(section(
        'SCRIPTURE REFERENCES',
        uniqueVerses.length ? uniqueVerses.map(v => `  • ${v}`).join('\n') : '  (No high-confidence verses detected)',
    ))

    if (summary.keyPoints.length) {
        parts.push(section('KEY POINTS', summary.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')))
    }
    if (summary.outline.length) {
        parts.push(section('OUTLINE', summary.outline.map(o => `  • ${o}`).join('\n')))
    }
    if (summary.application.length) {
        parts.push(section('REFLECTION & APPLICATION', summary.application.map(a => `  • ${a}`).join('\n')))
    }

    return parts.join('\n').trimEnd()
}

// --- Note formatting ---

function buildHeuristicNotes(
    segments: TranscriptSegment[],
    detectedVerses: Array<{ reference: string; confidence?: string }>,
    fullText: string
): string {
    const keyPoints = heuristicKeyPoints(fullText).slice(0, 6)
    const verses = detectedVerses.filter(v => v.confidence !== 'low').map(v => v.reference)
    const uniqueVerses = Array.from(new Set(verses))

    const lastSegment = segments[segments.length - 1]
    const durationSec = lastSegment ? Math.round(lastSegment.endMs / 1000) : 0
    const durationStr = durationSec > 0
        ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
        : `${(fullText.length / 5).toFixed(0)} words`

    const timestamp = new Date().toLocaleString()

    return [
        `Sermon Notes — ${timestamp}`,
        `Duration: ${durationStr}`,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'SCRIPTURE REFERENCES',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        uniqueVerses.length ? uniqueVerses.map(v => `  • ${v}`).join('\n') : '  (No high-confidence verses detected)',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'KEY POINTS',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        keyPoints.length > 0
            ? keyPoints.map((p, i) => `${i + 1}. ${p}.`).join('\n\n')
            : '  (Transcript too short for key points)',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'REFLECTION & APPLICATION',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Main takeaway:',
        '',
        'How does this apply to me?',
        '',
        'One action step this week:',
        '',
        'Prayer focus:',
    ].join('\n')
}

function buildStructuredNotes(
    segments: TranscriptSegment[],
    detectedVerses: Array<{ reference: string; confidence?: string; book?: string; chapter?: number; verseStart?: number; verseEnd?: number }>,
    fullText: string,
    aiSummary: string
): string {
    const verses = detectedVerses
        .filter(v => v.confidence !== 'low')
        .map(v => v.reference)
    const uniqueVerses = Array.from(new Set(verses))

    // Derive key points from the AI summary if available, otherwise from full text
    // If we have a good AI summary, use its sentences directly as key points
    let keyPoints: string[]
    if (aiSummary && aiSummary.length > 50) {
        keyPoints = heuristicKeyPoints(aiSummary)
    } else {
        keyPoints = heuristicKeyPoints(fullText)
    }

    const lastSegment = segments[segments.length - 1]
    const durationSec = lastSegment ? Math.round(lastSegment.endMs / 1000) : 0
    const durationStr = durationSec > 0
        ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
        : `${(fullText.length / 5).toFixed(0)} words`

    const timestamp = new Date().toLocaleString()

    const notes = [
        `Sermon Notes — ${timestamp}`,
        `Duration: ${durationStr}`,
        '',
    ]

    if (aiSummary) {
        notes.push(
            '━━━━━━━━━━━━━━━━━━━━━━━━━',
            'SERMON SUMMARY',
            '━━━━━━━━━━━━━━━━━━━━━━━━━',
            aiSummary,
            '',
        )
    }

    notes.push(
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'SCRIPTURE REFERENCES',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        uniqueVerses.length ? uniqueVerses.map(v => `  • ${v}`).join('\n') : '  (No high-confidence verses detected)',
        '',
    )

    if (keyPoints.length > 0) {
        notes.push(
            '━━━━━━━━━━━━━━━━━━━━━━━━━',
            'KEY POINTS',
            '━━━━━━━━━━━━━━━━━━━━━━━━━',
            keyPoints.slice(0, 6).map((p, i) => `${i + 1}. ${p}.`).join('\n\n'),
            '',
        )
    }

    notes.push(
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'REFLECTION & APPLICATION',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Main takeaway:',
        '',
        'How does this apply to me?',
        '',
        'One action step this week:',
        '',
        'Prayer focus:',
    )

    return notes.join('\n')
}