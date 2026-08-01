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
    /** Sermon-relative timestamp (ms). Drives the line-duration estimate that
     *  lets callers advance the display on a timer instead of waiting for the
     *  next transcript — see {@link TrackerUpdate.estimatedLineMs}. */
    timeMs?: number
    /**
     * True for a live, still-being-revised partial transcript rather than a
     * finalized segment.
     *
     * Interim text arrives 1-3 s before the final for the same utterance, which
     * is most of the latency this tracker exists to hide — so it is worth using,
     * but only for what it is reliable for. An interim chunk may move the cursor
     * *along the expected path* and lead the display; it may not acquire a song,
     * confirm a jump, or push the tracker toward Lost. Those decisions stay with
     * finalized text, because interim text is revised repeatedly (the same
     * phrase re-arrives, growing, several times) and would otherwise supply its
     * own corroboration for a mistake.
     */
    interim?: boolean
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
    /** Arrangement step that should be displayed now, or null. Distinct from
     *  `displaySectionId` when a section repeats: `['v1','c1','v2','c1']` has
     *  one chorus *section* at two different *steps*. */
    displayStepIndex: number | null
    /** True on the ingest where the displayed step changed. */
    advanced: boolean
    confidence: number
    reason: string
    /** Lines left in the singer's current section *after* the line they're on.
     *  With {@link estimatedLineMs} this is how long the current section has
     *  left to run. */
    linesRemaining: number
    /** Rolling estimate of how long one line takes to sing (ms), or null until
     *  enough line-to-line timings have been observed to be worth trusting. */
    estimatedLineMs: number | null
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
    tailWords: STOP_TAIL_WORDS,
    scorer: lineSimilarity,
}

/** Line timings kept for the rolling duration estimate. */
const LINE_TIMING_HISTORY = 8
/** Timings are only trusted once this many have been observed — below it a
 *  single oddly-segmented utterance would dominate the estimate. */
const MIN_LINE_TIMING_SAMPLES = 3
/** Plausible bounds for one sung line. Outside these the "advance" almost
 *  certainly spans a gap we didn't observe (an instrumental, a missed line, a
 *  pause between songs) rather than a line actually taking that long. */
const MIN_LINE_MS = 500
const MAX_LINE_MS = 15_000

interface Step {
    stepIndex: number
    sectionId: string
    section: SongSection
    lines: string[]
    /** Number of lines in all preceding steps — lets a (step, line) pair be
     *  flattened to a single absolute line number, so the distance between two
     *  cursor positions is a real line count even across a section boundary. */
    lineOffset: number
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
    /** Arrangement step currently displayed, or -1. Indexed by *step* rather
     *  than section id: a section that repeats in the arrangement occupies
     *  several steps, and keying the display on its id makes those steps
     *  indistinguishable — the cursor can't tell the second chorus from the
     *  first, so it leads into whatever followed the first one. */
    private displayStep = -1
    private confidence = 0
    private consecutiveMisses = 0

    // Timing model. `lastMatchMs`/`lastMatchAbsLine` are the previous accepted
    // cursor position on the audio timeline; the gap between two of them,
    // divided by the number of lines crossed, is one observation of how long a
    // line takes to sing.
    private lastMatchMs: number | null = null
    private lastMatchAbsLine: number | null = null
    private lineDurations: number[] = []

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
        this.displayStep = -1
        this.confidence = 0
        this.consecutiveMisses = 0
        this.lastMatchMs = null
        this.lastMatchAbsLine = null
        this.lineDurations = []
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
     *
     * Where the section repeats in the arrangement, seats at the occurrence
     * *nearest the current cursor* rather than the first. The operator's UI can
     * only identify a slide — and every repeat of a section shares one slide —
     * so clicking the chorus during the second chorus used to rewind the tracker
     * to the first, after which it would lead into whatever followed that one.
     */
    seekToSection(sectionId: string): TrackerUpdate {
        const stepIndex = this.nearestStepFor(sectionId)
        if (stepIndex === -1) return this.snapshot(false, 'seek-unknown-section')
        return this.seekToStep(stepIndex)
    }

    /** Seat the tracker at an exact arrangement step. */
    seekToStep(stepIndex: number): TrackerUpdate {
        if (stepIndex < 0 || stepIndex >= this.steps.length) {
            return this.snapshot(false, 'seek-unknown-step')
        }
        this.singerStep = stepIndex
        this.singerLine = 0
        this.confidence = 1
        this.consecutiveMisses = 0
        this.pendingJump = null
        this.phase = 'tracking'
        // The cursor moved for a reason unrelated to the audio timeline, so the
        // previous match is not a valid start point for a line-duration
        // measurement — the next gap would span the operator's jump.
        this.lastMatchMs = null
        this.lastMatchAbsLine = null
        const changed = this.recomputeDisplay()
        return this.snapshot(changed, 'seek')
    }

    /** Index of the occurrence of `sectionId` closest to the current cursor. */
    private nearestStepFor(sectionId: string): number {
        let best = -1
        let bestDistance = Infinity
        const from = Math.max(0, this.singerStep)
        for (const step of this.steps) {
            if (step.sectionId !== sectionId) continue
            const distance = Math.abs(step.stepIndex - from)
            if (distance < bestDistance) {
                bestDistance = distance
                best = step.stepIndex
            }
        }
        return best
    }

    /**
     * Advance the display one step ahead of the singer, on a caller's schedule
     * rather than in response to a transcript.
     *
     * This is the predictive path: a caller that knows how long the current
     * section has left to run (from {@link TrackerUpdate.estimatedLineMs}) and
     * how far behind the transcript is can lead the projector at the right
     * moment, instead of waiting for text matching the section's last line to
     * arrive — which for a short section arrives after the singers have already
     * moved on. Refuses to lead more than one step past the singer, so a
     * mis-timed call can't run away from them.
     */
    leadDisplay(): TrackerUpdate {
        if (this.phase !== 'tracking' || this.singerStep < 0) {
            return this.snapshot(false, 'lead-not-tracking')
        }
        const next = Math.max(this.singerStep, this.displayStep) + 1
        if (next >= this.steps.length) return this.snapshot(false, 'lead-at-end')
        if (next > this.singerStep + 1) return this.snapshot(false, 'lead-already-ahead')
        const changed = this.setDisplayStep(next)
        return this.snapshot(changed, 'lead-predicted')
    }

    /** Feed a transcript chunk; returns the resulting display decision. */
    ingest(chunk: TrackerChunk): TrackerUpdate {
        if (this.phase === 'idle') this.start()
        if (this.steps.length === 0) return this.snapshot(false, 'no-steps')

        // Interim text can follow a song but not find one: acquiring from a
        // partial, still-changing transcript is how the tracker would lock onto
        // a garbled first guess and then have to fight its way back out.
        if (chunk.interim && this.phase !== 'tracking') {
            return this.snapshot(false, 'interim-not-tracking')
        }

        const query = this.buildQuery(chunk.text, chunk.interim === true)
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
    private buildQuery(text: string, interim = false): string {
        const words = tokenize(text)
        if (interim) {
            // Deliberately does NOT touch the rolling buffer. Interim text is
            // the same utterance re-sent as it grows, so appending every
            // revision would fill the buffer with duplicates of one phrase and
            // starve the cross-chunk bridging the buffer exists for.
            return words.slice(-this.config.tailWords).join(' ')
        }
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
            this.noteMatchTime(chunk, best.stepIndex, best.lineIndex, false)
            this.pendingJump = null
            this.phase = 'tracking'
            const changed = this.recomputeDisplay()
            return this.snapshot(changed, 'acquired')
        }
        return this.snapshot(false, 'searching')
    }

    /** Tracking: prefer nearby lines, allow far jumps only with hysteresis. */
    private handleTracking(query: string, chunk: TrackerChunk): TrackerUpdate {
        const interim = chunk.interim === true
        const best = this.bestCandidate(query, this.trackingCandidateCoords())

        if (!best || best.score < this.config.trackThreshold) {
            // An interim miss is not evidence of anything: the utterance is
            // still being revised, and its early guesses routinely match
            // nothing. Counting it toward Lost would hand the song back to
            // auto-detect several times per verse.
            if (interim) return this.snapshot(false, 'interim-miss')
            return this.handleMiss()
        }

        const adjacent = this.isNearby(best.stepIndex, best.lineIndex)
        if (!adjacent) {
            // Interim text must not confirm a jump. Each revision of one
            // utterance would arrive as a separate "confirmation" of the same
            // wrong target, so hysteresis — which exists precisely to require
            // independent evidence — would be satisfied by a single phrase.
            if (interim) return this.snapshot(false, 'interim-jump-ignored')

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
        if (!interim) this.pendingJump = null
        this.singerStep = best.stepIndex
        this.singerLine = best.lineIndex
        this.confidence = best.score
        if (!interim) this.consecutiveMisses = 0
        this.noteMatchTime(chunk, best.stepIndex, best.lineIndex, interim)
        this.phase = 'tracking'

        const changed = this.recomputeDisplay()
        const reason = interim ? (changed ? 'interim-advanced' : 'interim-tracking') : changed ? 'advanced' : 'tracking'
        return this.snapshot(changed, reason)
    }

    /**
     * Record one observation of how long a line takes to sing, from the gap
     * between this accepted match and the previous one.
     *
     * Only finalized chunks contribute: interim timestamps describe when we
     * *heard about* a phrase mid-revision, not when it was sung. Only forward
     * moves of one or two lines contribute either — a longer jump spans
     * something we didn't observe (a missed line, an instrumental, a repeat),
     * so dividing the elapsed time by it would inflate the estimate.
     */
    private noteMatchTime(
        chunk: TrackerChunk,
        stepIndex: number,
        lineIndex: number,
        interim: boolean,
    ): void {
        if (interim || chunk.timeMs === undefined) return
        const absLine = this.absoluteLine(stepIndex, lineIndex)
        if (this.lastMatchMs !== null && this.lastMatchAbsLine !== null) {
            const lines = absLine - this.lastMatchAbsLine
            const elapsed = chunk.timeMs - this.lastMatchMs
            if (lines >= 1 && lines <= 2 && elapsed > 0) {
                const perLine = elapsed / lines
                if (perLine >= MIN_LINE_MS && perLine <= MAX_LINE_MS) {
                    this.lineDurations.push(perLine)
                    if (this.lineDurations.length > LINE_TIMING_HISTORY) this.lineDurations.shift()
                }
            }
        }
        this.lastMatchMs = chunk.timeMs
        this.lastMatchAbsLine = absLine
    }

    /** Flatten a (step, line) pair to an absolute line number in the arrangement. */
    private absoluteLine(stepIndex: number, lineIndex: number): number {
        return (this.steps[stepIndex]?.lineOffset ?? 0) + lineIndex
    }

    /**
     * Median observed line duration, or null before there are enough samples.
     * Median rather than mean: one line held long at the end of a chorus, or
     * one segment that bundled two lines, shouldn't drag the estimate.
     */
    private estimatedLineMs(): number | null {
        if (this.lineDurations.length < MIN_LINE_TIMING_SAMPLES) return null
        const sorted = this.lineDurations.slice().sort((a, b) => a - b)
        const mid = sorted.length >> 1
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }

    /** Lines left in the singer's section after the one they're on. */
    private linesRemaining(): number {
        const step = this.steps[this.singerStep]
        if (!step) return 0
        return Math.max(0, step.lines.length - 1 - this.singerLine)
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
            this.lastMatchMs = null
            this.lastMatchAbsLine = null
            // Nothing confident is playing anymore — clear the display target so
            // callers stop re-asserting this section onto the live output (which
            // otherwise fights any other detector, e.g. Bible-verse auto-detect,
            // that tries to take over the live slide once this song is lost).
            const changed = this.displayStep !== -1
            this.displayStep = -1
            return this.snapshot(changed, 'lost')
        }
        return this.snapshot(false, 'miss')
    }

    /**
     * Recompute the displayed step from the singer position, leading by one
     * step when the singer is on the last line of their section with enough
     * confidence. Returns true if the displayed step changed.
     */
    private recomputeDisplay(): boolean {
        const step = this.steps[this.singerStep]
        if (!step) return false

        const onLastLine = this.singerLine >= step.lines.length - 1
        const hasNext = this.singerStep + 1 < this.steps.length
        const leadAhead =
            onLastLine && hasNext && this.confidence >= this.config.triggerThreshold

        let target = leadAhead ? this.singerStep + 1 : this.singerStep

        // Hold a lead we already committed to. Once the display has been led one
        // step ahead — by the trailing-edge rule or by a caller's predictive
        // `leadDisplay()` — a later match placing the singer back in the section
        // they are still finishing must not yank the projector backwards. Only a
        // genuine backward move (which puts the display further than one step
        // ahead) pulls it back.
        if (this.displayStep === this.singerStep + 1 && target === this.singerStep) {
            target = this.displayStep
        }

        return this.setDisplayStep(target)
    }

    /** Move the display to `stepIndex`; true if that changed anything. */
    private setDisplayStep(stepIndex: number): boolean {
        if (stepIndex === this.displayStep) return false
        this.displayStep = stepIndex
        return true
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
            displaySectionId: this.displayStep >= 0 ? this.steps[this.displayStep]?.sectionId ?? null : null,
            displayStepIndex: this.displayStep >= 0 ? this.displayStep : null,
            advanced,
            confidence: this.confidence,
            reason,
            linesRemaining: this.linesRemaining(),
            estimatedLineMs: this.estimatedLineMs(),
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
    let lineOffset = 0
    for (const sectionId of order) {
        const section = byId.get(sectionId)
        if (!section) continue
        const lines = section.lines.filter((l) => l.trim().length > 0)
        if (lines.length === 0) continue
        steps.push({ stepIndex: steps.length, sectionId, section, lines, lineOffset })
        lineOffset += lines.length
    }
    return steps
}
