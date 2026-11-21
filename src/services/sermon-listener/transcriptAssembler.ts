/**
 * Turns an engine's results into the transcript of a listening session:
 * committed utterances with their timing, and the words still being
 * recognised.
 *
 * Engines repeat themselves — a phrase stuttered three times, the tail of one
 * utterance again at the start of the next, an utterance delivered twice — so
 * each result is cleaned before it is kept. A duplicate is not kept at all,
 * but is still handed on: it can carry a voice command.
 *
 * One assembler per listening session; a clear makes a new one. Pure apart
 * from the clock and ids it is given, so all of this is tested directly.
 */

import type { TranscriptSegment } from '../../types/sermon-listener'
import type { EngineSegment, TranscriptionProvider } from './transcriptionEngine'
import { isDuplicateUtterance } from './transcriptDedup'

export interface RawUtterance {
    text: string
    timestamp: number
    confidence?: number
}

export interface TranscriptSnapshot {
    /** The committed transcript. */
    text: string
    segments: TranscriptSegment[]
    /** Words still being recognised. */
    interim: string
    /** Recent utterances as heard, for review and learning. */
    rawUtterances: RawUtterance[]
}

/**
 * What a result amounts to, and what the scripture follower should hear:
 * `hear` is the text to read and `chunk` the newest utterance, where commands
 * are looked for. An interim is meant to be heard after a short pause, once
 * the words settle.
 */
export interface Assembled {
    kind: 'final' | 'duplicate' | 'interim'
    chunk: string
    hear: string
    committed: boolean
}

export interface EngineResult {
    text: string
    isFinal: boolean
    segments?: EngineSegment[]
}

const MAX_RECENT_CHUNKS = 5
const MAX_RAW_UTTERANCES = 200

/** "Okay. Okay. Okay." → "Okay." */
export function cleanRepeatedPhrases(text: string): string {
    if (!text) return text
    // Immediate repetitions of short phrases (1-5 words).
    const patterns = [
        /(\b[\w']+(?:\s+[\w']+){0,4}?[.,!?]?\s*)\1{2,}/gi,
        /(\b[\w']+\b\s*)\1{3,}/gi,
    ]
    let cleaned = text
    for (const pattern of patterns) cleaned = cleaned.replace(pattern, '$1')
    return cleaned
}

/** recent "For God so loved", new "God so loved the world" → "the world" (three words or more). */
export function stripOverlap(newText: string, recentText: string): string {
    if (!newText || !recentText) return newText
    const newWords = newText.split(/\s+/)
    const recentWords = recentText.split(/\s+/)
    for (let len = Math.min(newWords.length, recentWords.length, 10); len >= 3; len--) {
        const suffix = recentWords.slice(-len).join(' ').toLowerCase().replace(/[^\w\s]/g, '')
        const prefix = newWords.slice(0, len).join(' ').toLowerCase().replace(/[^\w\s]/g, '')
        if (suffix === prefix) {
            const remaining = newWords.slice(len).join(' ')
            return remaining || newText
        }
    }
    return newText
}

function newId(now: number): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `seg-${now}-${Math.random().toString(36).slice(2, 9)}`
}

export class TranscriptAssembler {
    private snapshot: TranscriptSnapshot = { text: '', segments: [], interim: '', rawUtterances: [] }
    private readonly listeners = new Set<() => void>()
    private recentChunks: string[] = []
    /** When the engine last started capturing; wall-clock segment times count from here. */
    private runStartedAt = 0
    /** When the utterance now being recognised began (its first interim). */
    private chunkStartedAt = 0

    getSnapshot = (): TranscriptSnapshot => this.snapshot

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    /** The engine started capturing. */
    startRun(now: number): void {
        this.runStartedAt = now
        this.chunkStartedAt = 0
    }

    /** Pick up a transcript restored after a reload. */
    restore({ text, segments }: { text?: string; segments?: TranscriptSegment[] }): void {
        this.update({
            ...(typeof text === 'string' ? { text } : {}),
            ...(segments ? { segments } : {}),
        })
    }

    /** Listening stopped: words still being recognised won't be committed now. */
    clearInterim(): void {
        if (this.snapshot.interim) this.update({ interim: '' })
    }

    take(result: EngineResult, { now, provider, worshipMode }: { now: number; provider: TranscriptionProvider; worshipMode: boolean }): Assembled {
        let chunk = cleanRepeatedPhrases(result.text)
        // Engines often repeat the end of one utterance at the start of the next.
        if (result.isFinal && this.recentChunks.length > 0) {
            chunk = stripOverlap(chunk, this.recentChunks[this.recentChunks.length - 1])
        }

        // Not kept, but still heard: it can carry a voice command.
        if (isDuplicateUtterance(chunk, this.recentChunks, { worshipMode })) {
            return { kind: 'duplicate', chunk, hear: this.snapshot.text, committed: true }
        }

        if (!result.isFinal) {
            if (this.chunkStartedAt === 0) this.chunkStartedAt = now
            this.update({ interim: chunk })
            const hear = `${this.snapshot.text} ${chunk}`.trim()
            return { kind: 'interim', chunk, hear, committed: hear === this.snapshot.text }
        }

        this.recentChunks.push(chunk)
        if (this.recentChunks.length > MAX_RECENT_CHUNKS) this.recentChunks.shift()

        let added: TranscriptSegment[]
        if (result.segments && result.segments.length > 0) {
            // The native engine times its own segments.
            added = result.segments
                .map((seg) => ({ id: newId(now), text: seg.text.trim(), startMs: seg.startMs, endMs: seg.endMs, source: 'whisper' as const }))
                .filter((seg) => seg.text.length > 0)
        } else {
            // Otherwise wall-clock: from when the utterance's first interim
            // arrived (or now, for a final with no interim) since the run began.
            const runStart = this.runStartedAt || now
            const segmentStart = this.chunkStartedAt || now
            added = [{
                id: newId(now),
                text: chunk,
                startMs: Math.max(0, segmentStart - runStart),
                endMs: Math.max(0, now - runStart),
                source: provider === 'native' ? 'whisper' as const : 'web-speech' as const,
            }]
        }
        this.chunkStartedAt = 0

        const addedText = added.map((s) => s.text).join(' ').trim()
        const text = addedText ? `${this.snapshot.text} ${addedText}`.trim() : this.snapshot.text
        this.update({
            text,
            segments: [...this.snapshot.segments, ...added],
            interim: '',
            rawUtterances: [...this.snapshot.rawUtterances, { text: chunk, timestamp: now }].slice(-MAX_RAW_UTTERANCES),
        })
        return { kind: 'final', chunk, hear: text, committed: true }
    }

    private update(patch: Partial<TranscriptSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...patch }
        for (const listener of this.listeners) listener()
    }
}
