import type { Song, SongSection } from '../../types'
import { codeSimilarity, phoneticCode, phoneticSimilarity, TOKEN_MATCH_FLOOR } from './phoneticMatch'
import { getContentWords } from '../../lib/semanticRetrievalPolicy'
import { sectionsForSong } from '../../lib/songSections'
import { spellOutNumbers } from '../../lib/spokenNumbers'

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

/** Normalize a line/phrase for comparison: numbers as words (transcripts
 *  write "10,000", lyrics "ten thousand"), lowercase, strip punctuation. */
export function normalizeLine(text: string): string {
    return spellOutNumbers(text)
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

/** A line's content words (stopwords dropped), as spoken tokens. Cached:
 *  the same few hundred lines are scored against every window. */
const contentTokenCache = new Map<string, string[]>()
function contentTokens(line: string): string[] {
    let cached = contentTokenCache.get(line)
    if (!cached) {
        cached = Array.from(new Set(tokenize(line).filter((w) => getContentWords(w).length > 0)))
        if (contentTokenCache.size > 5000) contentTokenCache.clear()
        contentTokenCache.set(line, cached)
    }
    return cached
}

/**
 * Whether `query` contains at least one of `line`'s content words, spelled the
 * same or sounding the same. A line with no content words passes.
 *
 * Coverage-based scoring rewards a short line for being present in the
 * window, and for a three-word line two function words are most of it: a
 * leader's "put your hands in there" scored 0.67 against "in your vineyard"
 * and put a song's last verse on screen before anyone sang. Requiring one
 * shared content word stops that while keeping misheard lyrics ("the splendor
 * of a key" still shares "splendour").
 */
export function sharesContentWord(query: string, line: string): boolean {
    const wanted = contentTokens(line)
    if (wanted.length === 0) return true
    const heard = tokenize(query)
    for (const w of wanted) {
        const code = phoneticCode(w)
        for (const q of heard) {
            if (q === w) return true
            if (code && codeSimilarity(code, phoneticCode(q)) >= TOKEN_MATCH_FLOOR) return true
        }
    }
    return false
}

/** Score given to a line that shares no content word with the query: below
 *  every threshold, so it can neither acquire, track nor jump. */
const NO_CONTENT_SCORE = 0.2

/**
 * Similarity between a transcript fragment and a lyric line, taking the kinder
 * of the lexical and phonetic views.
 *
 * Sung audio does not reach the transcript as words. "Clothed in Majesty"
 * arrives as "cloth and majesty" and "The splendour of a King" as "the splendor
 * of a key" — spelled almost nothing alike, sounding almost identical. Scoring
 * both ways and keeping the better one recovers those without giving up the
 * lexical path's precision on lines that did transcribe cleanly.
 *
 * Measured on real mis-transcriptions (see `__tests__/lyricMatchFixtures.ts`,
 * captured from live runs rather than invented): at the near-exact threshold
 * that identifies a song from a single line, true-line hits go from 3/15 to
 * 5/15, with no decoy line from an unrelated song crossing any threshold.
 */
export function lyricSimilarity(query: string, line: string): number {
    return Math.max(lineSimilarity(query, line), phoneticSimilarity(query, line))
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

/**
 * How much of the section must still be left, by the line-timing model, for a
 * predicted lead to be taken back. A lead made on the clock assumes each line
 * is sung once, in order; worship repeats lines and whole sections, so the
 * prediction is often early. When fresher transcript shows the singers this
 * far from the end, the projector is showing lyrics nobody is singing yet.
 */
export const RETRACT_REMAINING_MS = 2500

/** Timings are only trusted once this many have been observed — below it a
 *  single oddly-segmented utterance would dominate the estimate. */
const MIN_LINE_TIMING_SAMPLES = 2

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
    /** Minimum score for a window to count towards confirming a far jump. A
     *  weaker match holds position instead — neither confirming the jump nor
     *  counting as a miss. */
    jumpMinScore: number
    /** Words of transcript tail to match against. */
    tailWords: number
    /** Pluggable scorer (defaults to {@link lyricSimilarity}). */
    scorer: ScorerFn
    /** Remaining section time (ms, by the line model) above which a predicted
     *  lead is taken back — see {@link SongPositionTracker.reviewLead}. */
    retractRemainingMs: number
    /** After a retraction, the clock may lead that section again only once the
     *  singers are within this many lines of its end; -1 never. */
    rePredictLinesRemaining: number
    /** After a retraction, also stop the last-line rule from leading that
     *  section, so a band looping its ending can't flicker the slides. */
    holdAfterRetract: boolean
    /** Line duration (ms) assumed until enough lines have been timed, or null
     *  to make no prediction until then. Off by default: a guess wrong for a
     *  slow song leads too early, and the retraction that follows then holds
     *  the section back, so the change ends up later than with no guess. */
    defaultLineMs: number | null
    /** Line timings needed before the measured estimate is trusted. */
    minLineSamples: number
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
    searchThreshold: 0.5,
    trackThreshold: 0.4,
    triggerThreshold: 0.6,
    lookahead: 2,
    maxMisses: 3,
    jumpHysteresis: 2,
    jumpMinScore: 0.6,
    tailWords: STOP_TAIL_WORDS,
    scorer: lyricSimilarity,
    retractRemainingMs: RETRACT_REMAINING_MS,
    rePredictLinesRemaining: -1,
    holdAfterRetract: true,
    defaultLineMs: null,
    minLineSamples: MIN_LINE_TIMING_SAMPLES,
}

/** Words at the end of a transcript used to place the singers on a later
 *  line of the matched section ({@link SongPositionTracker.lineAtTail}). */
const TAIL_WORDS = 5
/** Shorter transcripts are a single line or less; there is no tail to read. */
const TAIL_MIN_QUERY_WORDS = 8

/** Line timings kept for the rolling duration estimate. */
const LINE_TIMING_HISTORY = 8
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
    /** Where the latest transcript *ended* within the singer's section — at or
     *  after `singerLine`. Used only to time the clock lead; see {@link lineAtTail}. */
    private tailLine = -1
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

    /** Display step put up by {@link leadDisplay} (a prediction), or -1. */
    private predictedLeadStep = -1
    /** Step whose predicted lead was taken back. The clock may lead it again
     *  only once the transcript puts the singers in its last two lines —
     *  see {@link reviewLead}. */
    private noPredictStep = -1

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
        this.tailLine = -1
        this.displayStep = -1
        this.confidence = 0
        this.consecutiveMisses = 0
        this.lastMatchMs = null
        this.lastMatchAbsLine = null
        this.lineDurations = []
        this.pendingJump = null
        this.buffer = []
        this.predictedLeadStep = -1
        this.noPredictStep = -1
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
        this.tailLine = 0
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
        if (
            this.singerStep === this.noPredictStep &&
            (this.config.rePredictLinesRemaining < 0 || this.linesRemaining() > this.config.rePredictLinesRemaining)
        ) {
            return this.snapshot(false, 'lead-blocked')
        }
        const changed = this.setDisplayStep(next)
        if (changed) this.predictedLeadStep = next
        return this.snapshot(changed, 'lead-predicted')
    }

    /**
     * Take back a predicted lead the transcript has since contradicted.
     *
     * Called after each finalized transcript, with how far behind the audio
     * that transcript runs. If the display was led on the clock and the singer
     * is still at least {@link RETRACT_REMAINING_MS} from the end of their
     * section — they repeated a line, or the whole section — the slide goes
     * back to the one being sung. The clock may not lead that section again
     * until the transcript places the singers in its last two lines: they have
     * shown it doesn't follow the timing model, and re-predicting from the same
     * stale position would only flicker the slides. Seeing its last line still
     * leads it normally.
     */
    reviewLead(lagMs: number): TrackerUpdate | null {
        if (this.phase !== 'tracking' || this.singerStep < 0) return null
        if (this.displayStep !== this.singerStep + 1 || this.displayStep !== this.predictedLeadStep) return null
        const lineMs = this.estimatedLineMs()
        if (lineMs === null) return null
        // Judged from the best-matching line, not the tail: retracting is a claim
        // that the singers are still well inside the section, so it should rest
        // on the line the transcript most clearly placed them on.
        const step = this.steps[this.singerStep]
        const remainingLines = Math.max(0, step.lines.length - 1 - this.singerLine)
        const remainingMs = remainingLines * lineMs - lagMs
        if (remainingMs < this.config.retractRemainingMs) return null
        this.predictedLeadStep = -1
        this.noPredictStep = this.singerStep
        this.setDisplayStep(this.singerStep)
        return this.snapshot(true, 'lead-retracted')
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
        const best = this.bestCandidate(query, this.allCandidateCoords(), this.phase === 'searching')
        if (best && best.score >= this.config.searchThreshold) {
            this.singerStep = best.stepIndex
            this.singerLine = best.lineIndex
            this.tailLine = this.lineAtTail(query, best.stepIndex, best.lineIndex)
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

            // A far jump needs real evidence. Speech over a vamp — a leader
            // exhorting the congregation while the band keeps playing — scores
            // around 0.5 against *some* line by sharing a few words, and two
            // such windows used to confirm a jump to an unrelated section and
            // hold it on screen for twenty seconds. Weak windows neither confirm
            // the jump nor count as a miss: the singers are most likely still
            // where they were.
            if (best.score < this.config.jumpMinScore) return this.snapshot(false, 'jump-weak')

            // Guard against transient noise causing a wild jump. A second window
            // corroborates the pending target if it lands on it again *or
            // carries on from it* — the next line or two, or the next section.
            // Requiring the identical line meant singers who kept moving never
            // confirmed anything: after a wrong lock, each window matched the
            // verse they had reached by then, and the display sat on the wrong
            // verse for three verses.
            if (this.pendingJump && this.continuesFrom(this.pendingJump, best.stepIndex, best.lineIndex)) {
                this.pendingJump = { stepIndex: best.stepIndex, lineIndex: best.lineIndex, count: this.pendingJump.count + 1 }
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
        this.tailLine = this.lineAtTail(query, best.stepIndex, best.lineIndex)
        this.confidence = best.score
        if (!interim) this.consecutiveMisses = 0
        this.noteMatchTime(chunk, best.stepIndex, best.lineIndex, interim)
        this.phase = 'tracking'

        const changed = this.recomputeDisplay()
        const reason = interim ? (changed ? 'interim-advanced' : 'interim-tracking') : changed ? 'advanced' : 'tracking'
        return this.snapshot(changed, reason)
    }

    /**
     * The line the singers are on at the *end* of this transcript.
     *
     * A segment often spans several lines — singing rarely pauses long enough
     * to end one sooner — and the best-matching line is wherever the clearest
     * words happened to fall, frequently the first. The segment's last words
     * are the most recent audio, so if they match a later line of the same
     * section, that is where the singers are now. Placing them earlier made
     * every lead late: the clock thought lines were left that had been sung.
     *
     * Only moves forward within the section, and only on a solid match.
     * Line timing still uses the best-matching line (see {@link noteMatchTime}),
     * whose timestamp the segment's start actually describes.
     */
    private lineAtTail(query: string, stepIndex: number, lineIndex: number): number {
        const words = tokenize(query)
        if (words.length < TAIL_MIN_QUERY_WORDS) return lineIndex
        const tail = words.slice(-TAIL_WORDS).join(' ')
        const lines = this.steps[stepIndex]?.lines ?? []
        let at = lineIndex
        for (let l = lineIndex + 1; l < lines.length; l++) {
            if (this.config.scorer(tail, lines[l]) >= this.config.triggerThreshold) at = l
        }
        return at
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
        if (this.lineDurations.length < this.config.minLineSamples) return this.config.defaultLineMs
        const sorted = this.lineDurations.slice().sort((a, b) => a - b)
        const mid = sorted.length >> 1
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }

    /** Lines left in the singer's section after the latest transcript ended —
     *  what the clock lead counts down. */
    private linesRemaining(): number {
        const step = this.steps[this.singerStep]
        if (!step) return 0
        return Math.max(0, step.lines.length - 1 - Math.max(this.singerLine, this.tailLine))
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
        // The bar on re-predicting a section lasts only while it is being sung.
        if (this.noPredictStep !== -1 && this.singerStep !== this.noPredictStep) this.noPredictStep = -1

        const onLastLine = this.singerLine >= step.lines.length - 1
        const hasNext = this.singerStep + 1 < this.steps.length
        const blocked = this.config.holdAfterRetract && this.singerStep === this.noPredictStep
        const leadAhead =
            onLastLine && hasNext && !blocked && this.confidence >= this.config.triggerThreshold

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
        // Any move made other than by `leadDisplay` (which re-marks it) is
        // evidence-driven, not a prediction.
        this.predictedLeadStep = -1
        return true
    }

    /** Whether (stepIndex, lineIndex) is where singing that was at `from`
     *  could plausibly be one window later: the same line, a line or two on,
     *  or the next section. */
    private continuesFrom(from: { stepIndex: number; lineIndex: number }, stepIndex: number, lineIndex: number): boolean {
        if (stepIndex === from.stepIndex) return lineIndex >= from.lineIndex && lineIndex <= from.lineIndex + 2
        return stepIndex === from.stepIndex + 1 && lineIndex <= 1
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
        // Every line of every other step, so a leader who drops into the
        // *middle* of a distant section can be followed there.
        //
        // Only first lines used to be considered outside the lookahead window,
        // on the reasoning that an unplanned jump lands at the top of a
        // section. Worship does not oblige: leaders jump into the middle of a
        // verse, double back to a chorus, vamp. Worse than missing the jump,
        // the restricted set made the tracker take a *wrong* one — with the
        // true line invisible, the best remaining candidate for "freedom is in
        // your hands" was an unrelated nearby line at 0.40, just over the
        // tracking threshold, so it was accepted and put on screen. Seeing
        // every line means an exact match outscores that immediately.
        //
        // This widens what can be *seen*, not what is accepted: a non-adjacent
        // match is still a pending jump needing `jumpHysteresis` corroboration
        // before the cursor moves. Cost is scoring every line of one song per
        // window, which is tens of comparisons.
        for (let s = 0; s < this.steps.length; s++) {
            if (s < from || s > to) {
                for (let l = 0; l < this.steps[s].lines.length; l++) coords.push([s, l])
            }
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

    /**
     * Best-scoring line among `coords`. With `requireContent`, a line sharing
     * no content word with the query (see {@link sharesContentWord}) can't
     * win: used when acquiring, where nothing else stands between a leader's
     * "put your hands in there" and a lock on "in your vineyard". Not applied
     * while tracking, where the cursor's neighbourhood already constrains the
     * match, and where it cost real misheard lines on the reference recording.
     */
    private bestCandidate(query: string, coords: Array<[number, number]>, requireContent = false): Candidate | null {
        const EPS = 1e-6
        let best: Candidate | null = null
        for (const [s, l] of coords) {
            const step = this.steps[s]
            const line = step.lines[l]
            if (!line) continue
            const raw = this.config.scorer(query, line)
            const score = requireContent && raw > NO_CONTENT_SCORE && !sharesContentWord(query, line) ? NO_CONTENT_SCORE : raw
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
    // Derived when the song stores none — otherwise a song with only freeform
    // lyrics expands to zero steps and the tracker silently does nothing.
    const sections = sectionsForSong(song)
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
