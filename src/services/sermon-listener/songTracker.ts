import type { Song, SongSection } from '../../types'

/**
 * Predictive song-lyric position tracker (Phase 2).
 *
 * Consumes the same transcript stream the sermon listener already produces and
 * answers one question live: **which section should be on the projector right
 * now?** The hard part is that Whisper lags the live audio, so we cannot wait
 * to hear the next section before showing it. Instead we track where the
 * singer *actually* is and, the moment we detect them on the *last line* of the
 * current section, we lead the display to the *next* section. The length of
 * that final line (~1–3 s) is the buffer that hides transcription latency.
 *
 * The tracker keeps two cursors:
 *   - `singer`  — our best estimate of where the vocalist is (section + line).
 *   - `display` — what should be shown, which equals `singer` except at the
 *                 trailing edge, where it leads by one step.
 *
 * It is intentionally pure and synchronous: matching uses a deterministic
 * lexical similarity so the state machine is fully unit-testable without
 * loading any ML model. A semantic scorer can be injected via
 * `config.scorer` later (Phase 2b) without changing the control flow.
 */

// ---------------------------------------------------------------------------
// Text similarity (deterministic, 0..1)
// ---------------------------------------------------------------------------

const STOP_TAIL_WORDS = 14

/** Normalize a line/phrase for comparison: lowercase, strip punctuation. */
export function normalizeLine(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function tokenize(text: string): string[] {
    const n = normalizeLine(text)
    return n ? n.split(' ') : []
}

function bigrams(tokens: string[]): string[] {
    const out: string[] = []
    for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`)
    return out
}

function diceOfSets(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0
    let inter = 0
    for (const x of a) if (b.has(x)) inter++
    return (2 * inter) / (a.size + b.size)
}

/**
 * Similarity between a transcript fragment (`query`) and a candidate lyric
 * `line`, in [0, 1]. Combines unigram + bigram Dice with a coverage term so a
 * short line that appears verbatim inside a longer transcript still scores
 * high. Robust to the extra/garbled words Whisper produces on sung audio.
 */
export function lineSimilarity(query: string, line: string): number {
    const q = tokenize(query)
    const c = tokenize(line)
    if (q.length === 0 || c.length === 0) return 0

    const qSet = new Set(q)
    const cSet = new Set(c)
    const uni = diceOfSets(qSet, cSet)

    // Coverage: how much of the candidate line is present in the query.
    let present = 0
    for (const w of cSet) if (qSet.has(w)) present++
    const coverage = present / cSet.size

    let score = Math.max(uni, coverage * 0.95)

    if (q.length >= 2 && c.length >= 2) {
        const bi = diceOfSets(new Set(bigrams(q)), new Set(bigrams(c)))
        score = Math.max(score, (uni + bi) / 2)
    }

    return Math.min(1, score)
}

export type ScorerFn = (query: string, line: string) => number

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrackerPhase = 'idle' | 'searching' | 'tracking' | 'lost'

export interface TrackerChunk {
    /** Latest transcript text for this speech segment. */
    text: string
    /** Sermon-relative timestamp (ms). Optional; used for instrumental hold. */
    timeMs?: number
    /** Live audio energy 0..1 (RMS). Optional; distinguishes silence from a
     *  loud instrumental break so we hold instead of giving up. */
    audioEnergy?: number
}

export interface TrackerPosition {
    stepIndex: number
    lineIndex: number
    sectionId: string
}

export interface TrackerUpdate {
    phase: TrackerPhase
    /** Best estimate of where the vocalist is, or null before first lock. */
    singer: TrackerPosition | null
    /** Section id that should be displayed now (leads at the trailing edge). */
    displaySectionId: string | null
    /** True on the ingest where `displaySectionId` changed. */
    advanced: boolean
    confidence: number
    reason: string
}

export interface TrackerConfig {
    /** Min score to lock onto a song while searching. */
    searchThreshold: number
    /** Min score to accept a position update while tracking. */
    trackThreshold: number
    /** Min score on the last line to lead the display to the next section. */
    triggerThreshold: number
    /** How many steps ahead to consider as advance candidates. */
    lookahead: number
    /** Consecutive misses (with low audio energy) before going Lost. */
    maxMisses: number
    /** Consecutive confirmations required for a backward / far jump. */
    jumpHysteresis: number
    /** Audio energy at/above which a miss is treated as an instrumental hold. */
    holdEnergy: number
    /** Words of transcript tail to match against. */
    tailWords: number
    /** Pluggable scorer (defaults to lexical {@link lineSimilarity}). */
    scorer: ScorerFn
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
    searchThreshold: 0.5,
    trackThreshold: 0.4,
    triggerThreshold: 0.6,
    lookahead: 2,
    maxMisses: 3,
    jumpHysteresis: 2,
    holdEnergy: 0.08,
    tailWords: STOP_TAIL_WORDS,
    scorer: lineSimilarity,
}

interface Step {
    stepIndex: number
    sectionId: string
    section: SongSection
    lines: string[]
}

interface Candidate {
    stepIndex: number
    lineIndex: number
    sectionId: string
    score: number
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export class SongPositionTracker {
    readonly song: Song
    readonly steps: Step[]
    private config: TrackerConfig

    private phase: TrackerPhase = 'idle'
    private singerStep = -1
    private singerLine = -1
    private displaySectionId: string | null = null
    private confidence = 0
    private consecutiveMisses = 0
    private lastMatchMs: number | null = null

    // Pending non-adjacent jump target awaiting hysteresis confirmation.
    private pendingJump: { stepIndex: number; lineIndex: number; count: number } | null = null

    // Rolling transcript buffer so a phrase split across two chunks still
    // matches. Capped to a few lines' worth of words.
    private buffer: string[] = []

    constructor(song: Song, arrangement?: string[], config?: Partial<TrackerConfig>) {
        this.song = song
        this.config = { ...DEFAULT_TRACKER_CONFIG, ...config }
        this.steps = buildSteps(song, arrangement)
    }

    /** Begin tracking (moves to Searching). Idempotent. */
    start(): void {
        this.reset()
        this.phase = this.steps.length > 0 ? 'searching' : 'idle'
    }

    reset(): void {
        this.phase = 'idle'
        this.singerStep = -1
        this.singerLine = -1
        this.displaySectionId = null
        this.confidence = 0
        this.consecutiveMisses = 0
        this.lastMatchMs = null
        this.pendingJump = null
        this.buffer = []
    }

    getPhase(): TrackerPhase {
        return this.phase
    }

    getState(): TrackerUpdate {
        return this.snapshot(false, this.phase === 'idle' ? 'idle' : 'state')
    }

    /**
     * Manually seat the tracker at a section (operator click-to-jump). Resets
     * tracking state to that section, first line, and shows it.
     */
    seekToSection(sectionId: string): TrackerUpdate {
        const stepIndex = this.steps.findIndex((s) => s.sectionId === sectionId)
        if (stepIndex === -1) return this.snapshot(false, 'seek-unknown-section')
        this.singerStep = stepIndex
        this.singerLine = 0
        this.confidence = 1
        this.consecutiveMisses = 0
        this.pendingJump = null
        this.phase = 'tracking'
        const changed = this.recomputeDisplay()
        return this.snapshot(changed, 'seek')
    }

    /** Feed a transcript chunk; returns the resulting display decision. */
    ingest(chunk: TrackerChunk): TrackerUpdate {
        if (this.phase === 'idle') this.start()
        if (this.steps.length === 0) return this.snapshot(false, 'no-steps')

        const query = this.buildQuery(chunk.text)
        if (!query.trim()) return this.snapshot(false, 'empty-chunk')

        if (this.phase === 'searching' || this.phase === 'lost') {
            return this.handleAcquire(query, chunk)
        }
        return this.handleTracking(query, chunk)
    }

    // --- internal ----------------------------------------------------------

    /**
     * Build the match query from the incoming chunk. Transcripts stream roughly
     * one phrase per segment, so the *current chunk* is the primary signal —
     * using the whole rolling buffer would keep matching earlier lines and stall
     * the cursor. The buffer is only used to give very short fragments enough
     * context to match (cross-chunk bridging).
     */
    private buildQuery(text: string): string {
        const words = tokenize(text)
        this.buffer.push(...words)
        const cap = this.config.tailWords * 2
        if (this.buffer.length > cap) this.buffer = this.buffer.slice(-cap)

        if (words.length >= 4) return words.slice(-this.config.tailWords).join(' ')
        // Short fragment: borrow recent context to have something to match.
        return this.buffer.slice(-this.config.tailWords).join(' ')
    }

    /** Searching / Lost: scan every step's lines to (re)acquire position. */
    private handleAcquire(query: string, chunk: TrackerChunk): TrackerUpdate {
        const best = this.bestCandidate(query, this.allCandidateCoords())
        if (best && best.score >= this.config.searchThreshold) {
            this.singerStep = best.stepIndex
            this.singerLine = best.lineIndex
            this.confidence = best.score
            this.consecutiveMisses = 0
            this.lastMatchMs = chunk.timeMs ?? this.lastMatchMs
            this.pendingJump = null
            this.phase = 'tracking'
            const changed = this.recomputeDisplay()
            return this.snapshot(changed, 'acquired')
        }
        return this.snapshot(false, 'searching')
    }

    /** Tracking: prefer nearby lines, allow far jumps only with hysteresis. */
    private handleTracking(query: string, chunk: TrackerChunk): TrackerUpdate {
        const best = this.bestCandidate(query, this.trackingCandidateCoords())

        if (!best || best.score < this.config.trackThreshold) {
            return this.handleMiss()
        }

        const adjacent = this.isNearby(best.stepIndex, best.lineIndex)
        if (!adjacent) {
            // Guard against transient noise causing a wild jump.
            if (
                this.pendingJump &&
                this.pendingJump.stepIndex === best.stepIndex &&
                this.pendingJump.lineIndex === best.lineIndex
            ) {
                this.pendingJump.count++
            } else {
                this.pendingJump = { stepIndex: best.stepIndex, lineIndex: best.lineIndex, count: 1 }
            }
            if (this.pendingJump.count < this.config.jumpHysteresis) {
                // Not yet confirmed — treat as a soft miss, hold position.
                return this.snapshot(false, 'jump-pending')
            }
        }

        // Accept the position.
        this.pendingJump = null
        this.singerStep = best.stepIndex
        this.singerLine = best.lineIndex
        this.confidence = best.score
        this.consecutiveMisses = 0
        this.lastMatchMs = chunk.timeMs ?? this.lastMatchMs
        this.phase = 'tracking'

        const changed = this.recomputeDisplay()
        return this.snapshot(changed, changed ? 'advanced' : 'tracking')
    }

    private handleMiss(): TrackerUpdate {
        // A miss means transcript arrived that didn't match the current song.
        // (Real instrumental breaks produce no transcript, so the tracker isn't
        // ingested during them — a miss here means words were sung that don't
        // fit this song, i.e. a different/new song.) Decay confidence so the UI
        // reflects the fading match, and count toward 'lost', which is what lets
        // auto-detect go looking for the new song.
        this.consecutiveMisses++
        this.confidence *= 0.6
        if (this.consecutiveMisses >= this.config.maxMisses) {
            this.phase = 'lost'
            this.pendingJump = null
            return this.snapshot(false, 'lost')
        }
        return this.snapshot(false, 'miss')
    }

    /**
     * Recompute the displayed section from the singer position, leading by one
     * step when the singer is on the last line of their section with enough
     * confidence. Returns true if the displayed section changed.
     */
    private recomputeDisplay(): boolean {
        const step = this.steps[this.singerStep]
        if (!step) return false

        const onLastLine = this.singerLine >= step.lines.length - 1
        const hasNext = this.singerStep + 1 < this.steps.length
        const leadAhead =
            onLastLine && hasNext && this.confidence >= this.config.triggerThreshold

        const targetStep = leadAhead ? this.singerStep + 1 : this.singerStep
        const target = this.steps[targetStep].sectionId

        if (target !== this.displaySectionId) {
            this.displaySectionId = target
            return true
        }
        return false
    }

    private isNearby(stepIndex: number, lineIndex: number): boolean {
        if (stepIndex === this.singerStep) {
            // Same section: forward within a couple of lines, or a small back-step.
            return lineIndex >= this.singerLine - 1
        }
        // Next section (natural progression) counts as nearby.
        return stepIndex > this.singerStep && stepIndex <= this.singerStep + this.config.lookahead
    }

    private trackingCandidateCoords(): Array<[number, number]> {
        const coords: Array<[number, number]> = []
        const from = Math.max(0, this.singerStep)
        const to = Math.min(this.steps.length - 1, this.singerStep + this.config.lookahead)
        for (let s = from; s <= to; s++) {
            for (let l = 0; l < this.steps[s].lines.length; l++) coords.push([s, l])
        }
        // Include the first line of every step so an unplanned jump/repeat can
        // still be detected (confirmed via hysteresis before it's accepted).
        for (let s = 0; s < this.steps.length; s++) {
            if (s < from || s > to) coords.push([s, 0])
        }
        return coords
    }

    private allCandidateCoords(): Array<[number, number]> {
        const coords: Array<[number, number]> = []
        for (let s = 0; s < this.steps.length; s++) {
            for (let l = 0; l < this.steps[s].lines.length; l++) coords.push([s, l])
        }
        return coords
    }

    private bestCandidate(query: string, coords: Array<[number, number]>): Candidate | null {
        const EPS = 1e-6
        let best: Candidate | null = null
        for (const [s, l] of coords) {
            const step = this.steps[s]
            const line = step.lines[l]
            if (!line) continue
            const score = this.config.scorer(query, line)
            if (!best || score > best.score + EPS) {
                best = { stepIndex: s, lineIndex: l, sectionId: step.sectionId, score }
            } else if (Math.abs(score - best.score) <= EPS) {
                // Tie: songs move forward, so prefer the candidate that sits
                // just ahead of (or at) the current cursor over an earlier one.
                if (this.forwardRank(s, l) < this.forwardRank(best.stepIndex, best.lineIndex)) {
                    best = { stepIndex: s, lineIndex: l, sectionId: step.sectionId, score }
                }
            }
        }
        return best
    }

    /** Distance of a coord ahead of the current cursor (behind => large). */
    private forwardRank(stepIndex: number, lineIndex: number): number {
        const curStep = Math.max(0, this.singerStep)
        const curLine = Math.max(0, this.singerLine)
        const flat = stepIndex * 1000 + lineIndex
        const cur = curStep * 1000 + curLine
        return flat >= cur ? flat - cur : 1_000_000 + (cur - flat)
    }

    private snapshot(advanced: boolean, reason: string): TrackerUpdate {
        const singer: TrackerPosition | null =
            this.singerStep >= 0
                ? {
                      stepIndex: this.singerStep,
                      lineIndex: this.singerLine,
                      sectionId: this.steps[this.singerStep]?.sectionId ?? '',
                  }
                : null
        return {
            phase: this.phase,
            singer,
            displaySectionId: this.displaySectionId,
            advanced,
            confidence: this.confidence,
            reason,
        }
    }
}

/**
 * Expand a song + arrangement into ordered steps. Falls back to the song's
 * `defaultArrangement`, then to the natural section order. Arrangement entries
 * referencing unknown section ids are skipped.
 */
function buildSteps(song: Song, arrangement?: string[]): Step[] {
    const sections = song.sections ?? []
    if (sections.length === 0) return []

    const byId = new Map<string, SongSection>()
    for (const s of sections) byId.set(s.id, s)

    const order =
        arrangement && arrangement.length > 0
            ? arrangement
            : song.defaultArrangement && song.defaultArrangement.length > 0
              ? song.defaultArrangement
              : sections.map((s) => s.id)

    const steps: Step[] = []
    for (const sectionId of order) {
        const section = byId.get(sectionId)
        if (!section) continue
        const lines = section.lines.filter((l) => l.trim().length > 0)
        if (lines.length === 0) continue
        steps.push({ stepIndex: steps.length, sectionId, section, lines })
    }
    return steps
}
