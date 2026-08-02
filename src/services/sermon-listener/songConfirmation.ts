/**
 * Soft-posterior confirmation for song auto-detect (Phase 2 upgrade).
 *
 * Before this, {@link import('../../hooks/useSongAutoDetect').useSongAutoDetect}
 * confirmed a song with a single ref: `{ songId, count }`, requiring the exact
 * same songId on two consecutive windows, and wiping it to null on ANY window
 * that didn't produce that same match (including a window that simply failed
 * the singing pre-gate, or a window whose match — through no fault of the
 * song — scored just under the local-detector's floor). That's fragile in
 * both directions:
 *  - A false positive only needs the SAME wrong songId to coincidentally win
 *    twice, with no regard for how strong either match was.
 *  - A false negative can be induced by one unlucky window losing all prior
 *    progress, even mid-chorus of a real song.
 *
 * This tracker instead keeps a per-song evidence score that:
 *  - grows by the match's own confidence (already 0..1 from
 *    {@link import('./songIdentification').identifySong}) each time that song
 *    is the best match for a window,
 *  - decays smoothly with real elapsed time otherwise (including through
 *    windows with no match at all, or windows skipped by the singing
 *    pre-gate) rather than being reset to zero,
 *  - and is emitted once it clears a threshold that a single very strong
 *    (near-exact) hit can't reach alone — still wants corroboration — but
 *    that two weaker corroboration-level hits also can't reach as easily as
 *    two strong ones, unlike a flat "matched twice" counter that treats all
 *    evidence as equal.
 *
 * Multiple candidate songs are tracked simultaneously (a small Map, pruned
 * once decayed to near-zero), so a stray one-off match for a different song
 * doesn't discard an otherwise-accumulating hypothesis for the right one.
 */

export interface SongEvidence {
    songId: string
    /** The identifier's own per-window confidence, 0..1. */
    confidence: number
    /** Monotonic position of the query window (e.g. cumulative words seen).
     *  Consecutive matches whose windows overlap heavily are NOT independent
     *  corroboration — the same coincidental phrase re-scored on the next
     *  transcript segment. When provided, a hit is only accumulated if the
     *  window has advanced by `minWindowAdvance` since this song's last
     *  accumulated hit; otherwise it's ignored (decay still applies). This is
     *  the primary defense against the sliding-buffer false positive. */
    windowId?: number
}

export interface SongConfirmationConfig {
    /** Milliseconds for an unsupported hypothesis's score to halve, used until
     *  the real window cadence has been observed (see {@link halfLifeWindows}). */
    halfLifeMs: number
    /**
     * Half-life expressed in *windows* rather than milliseconds, once the
     * tracker has seen how far apart windows actually arrive.
     *
     * A fixed wall-clock half-life silently assumes a window cadence. Get that
     * assumption wrong and confirmation becomes unreachable rather than merely
     * slow: with evidence `c` arriving every `t` ms and a decay factor
     * `d = 0.5^(t/halfLife)` between windows, the accumulated score converges
     * to `c / (1 - d)` — a ceiling. If that ceiling sits below
     * {@link emitThreshold}, no amount of singing ever confirms the song.
     *
     * That is exactly what happened with a 3 s half-life against desktop
     * Whisper, whose finalized segments (this tracker's window source) arrive
     * 5-20 s apart: `d ≈ 0.1`, so even a *perfect* 0.95 match ceilings at ~1.05
     * against a 1.3 threshold. The right song could be sung for ten minutes,
     * matching near-verbatim every single window, and auto-detect would never
     * pull it up.
     *
     * Pegging the half-life to the observed cadence fixes the ceiling in place
     * regardless of how fast windows arrive (`d = 0.5^(1/halfLifeWindows)`, so
     * at 2.5 the ceiling is ~4.1x a single window's confidence), while decay
     * stays a function of real elapsed time — a hypothesis left unsupported
     * while the transcript keeps flowing still fades away.
     */
    halfLifeWindows: number
    /** Bounds on the adapted half-life, so a pathological cadence (a burst of
     *  windows in one tick, or a five-minute gap) can't drive it somewhere
     *  meaningless. */
    minHalfLifeMs: number
    maxHalfLifeMs: number
    /** Accumulated score at/above which a hypothesis is confirmed. Tuned so a
     *  single near-exact hit (confidence ~0.9-1.0) can't clear it alone — real
     *  singing keeps producing matching windows, so requiring the sum of at
     *  least two strong-ish hits (surviving partial decay between them) is a
     *  cheap, meaningful bar against a single lucky window. */
    emitThreshold: number
    /** Hypotheses decayed below this are pruned so the map doesn't grow
     *  unbounded over a multi-hour service. */
    pruneBelow: number
    /** Minimum window advance (in `windowId` units) required between two
     *  accumulated hits for the SAME song, so overlapping re-scores of one
     *  phrase can't masquerade as independent corroboration. Only enforced
     *  when evidence carries a `windowId`. */
    minWindowAdvance: number
}

export const DEFAULT_SONG_CONFIRMATION_CONFIG: SongConfirmationConfig = {
    halfLifeMs: 3000,
    halfLifeWindows: 2.5,
    minHalfLifeMs: 3000,
    maxHalfLifeMs: 30_000,
    emitThreshold: 1.3,
    pruneBelow: 0.05,
    minWindowAdvance: 6,
}

/** Weight given to the newest observed interval when updating the cadence
 *  estimate. High enough to follow a real change in transcription cadence
 *  within a couple of windows, low enough that one late segment doesn't
 *  redefine it. */
const INTERVAL_EMA_ALPHA = 0.4

interface Hypothesis {
    score: number
    lastUpdatedAt: number
    /** windowId of the last accumulated hit for this song (if any). */
    lastWindowId?: number
}

export class SongConfirmationTracker {
    private hypotheses = new Map<string, Hypothesis>()
    private config: SongConfirmationConfig
    /** Timestamp of the previous `update`, for measuring window cadence. */
    private lastUpdateAt: number | null = null
    /** Smoothed interval between windows, or null before two have been seen. */
    private intervalEmaMs: number | null = null

    constructor(config: Partial<SongConfirmationConfig> = {}) {
        this.config = { ...DEFAULT_SONG_CONFIRMATION_CONFIG, ...config }
    }

    /** Half-life to decay by, adapted to the observed window cadence once
     *  there is one. See {@link SongConfirmationConfig.halfLifeWindows}. */
    private effectiveHalfLifeMs(): number {
        if (this.intervalEmaMs === null) return this.config.halfLifeMs
        const { halfLifeWindows, minHalfLifeMs, maxHalfLifeMs } = this.config
        return Math.min(maxHalfLifeMs, Math.max(minHalfLifeMs, halfLifeWindows * this.intervalEmaMs))
    }

    /** Fold this window's arrival into the cadence estimate. Called *after*
     *  decaying, so the gap being decayed is judged by the cadence observed
     *  before it — otherwise a long silence would widen the half-life by
     *  exactly enough to preserve the stale evidence it should be clearing. */
    private noteInterval(now: number): void {
        const previous = this.lastUpdateAt
        this.lastUpdateAt = now
        if (previous === null) return
        const interval = now - previous
        if (interval <= 0) return
        // A gap longer than the half-life ceiling isn't a cadence, it's a gap —
        // the tracker sat idle (a song was tracking cleanly, the service moved
        // on to preaching) and no windows were offered. Folding it in would
        // stretch the half-life to its maximum on the strength of a period we
        // weren't measuring.
        if (interval > this.config.maxHalfLifeMs) return
        this.intervalEmaMs =
            this.intervalEmaMs === null
                ? interval
                : INTERVAL_EMA_ALPHA * interval + (1 - INTERVAL_EMA_ALPHA) * this.intervalEmaMs
    }

    /** Decay every tracked hypothesis to `now`. Call this on every tick where
     *  searching is active, even when there's no evidence this window (a
     *  no-match window, or one skipped by a pre-gate) — decay models real
     *  elapsed time, not "did we search." */
    private decayAll(now: number): void {
        const { pruneBelow } = this.config
        const halfLifeMs = this.effectiveHalfLifeMs()
        for (const [songId, hyp] of this.hypotheses) {
            const elapsed = now - hyp.lastUpdatedAt
            const decayed = hyp.score * Math.pow(0.5, elapsed / halfLifeMs)
            if (decayed < pruneBelow) {
                this.hypotheses.delete(songId)
            } else {
                hyp.score = decayed
                hyp.lastUpdatedAt = now
            }
        }
    }

    /**
     * Advance the tracker by one window. Always decays first (see
     * {@link decayAll}); if `evidence` is given, adds it to that song's
     * (already-decayed) hypothesis.
     *
     * @returns the songId to confirm/display if its posterior now clears the
     * threshold (its hypothesis is cleared in that case — a fresh search
     * cycle starts from zero); otherwise null.
     */
    update(now: number, evidence: SongEvidence | null): string | null {
        this.decayAll(now)
        this.noteInterval(now)
        if (!evidence) return null

        const existing = this.hypotheses.get(evidence.songId)

        // Independence gate: if this song already has an accumulated hit and
        // the window hasn't advanced enough, treat this as the SAME window
        // re-scored (not new corroboration). Let it decay; don't accumulate.
        if (
            existing &&
            evidence.windowId !== undefined &&
            existing.lastWindowId !== undefined &&
            evidence.windowId - existing.lastWindowId < this.config.minWindowAdvance
        ) {
            return null
        }

        const score = (existing?.score ?? 0) + evidence.confidence
        this.hypotheses.set(evidence.songId, {
            score,
            lastUpdatedAt: now,
            lastWindowId: evidence.windowId ?? existing?.lastWindowId,
        })

        if (score >= this.config.emitThreshold) {
            this.hypotheses.delete(evidence.songId)
            return evidence.songId
        }
        return null
    }

    /** Current accumulated score for a song, 0 if untracked. Test/debug use. */
    scoreFor(songId: string): number {
        return this.hypotheses.get(songId)?.score ?? 0
    }

    /** Drop all tracked hypotheses — e.g. when search stops (a song is now
     *  confidently live/tracking) or a song was just confirmed.
     *
     *  The learned window cadence deliberately survives: it describes the
     *  transcription pipeline, not any one hypothesis, and it is called often
     *  enough (every window while a song tracks cleanly) that re-learning it
     *  each time would leave the next search running on the default again. */
    reset(): void {
        this.hypotheses.clear()
    }
}
