import type { TrackerUpdate } from './songTracker'

/**
 * When to put the next section of a song on screen.
 *
 * Transcribed lyrics arrive seconds after they were sung — a segment can only
 * be transcribed once it ends, and singing rarely pauses long enough to end
 * one early. Waiting for text from a section's last line therefore shows the
 * next section after the singers have started it. Instead the tracker measures
 * how long a line takes to sing and this module turns that, plus how far
 * behind the transcript runs, into a moment on the wall clock: the next
 * section goes up a little before the current one is predicted to end.
 *
 * Pure and clock-free so the real-recording eval can replay it on a simulated
 * clock (`songTracking.eval.test.ts`); `useSongTracker` runs it on the real one.
 */

/** How long before the singers reach the next section it should be on screen. */
export const LEAD_SAFETY_MS = 1200
/** Sanity bound on the measured transcript lag. */
export const MAX_LAG_MS = 8000

/**
 * How far behind the audio the transcript runs.
 *
 * Segment timestamps are sermon-relative (ms since capture started) while
 * scheduling happens on the wall clock, so this keeps the wall-clock instant
 * sermon time zero corresponds to. It starts at the moment listening began —
 * within a few hundred ms of the capture loop's own zero — and is only ever
 * refined *downward* by segments: `received - endMs` is an upper bound on the
 * origin (a segment can't arrive before the audio it covers), but a lag that is
 * systematic, as transcription lag is, would fold entirely into the origin if
 * it were taken as an estimate, leaving the lag reading zero.
 */
export class TranscriptLagEstimator {
    private originMs: number | null = null
    private lag = 0

    /** Listening (re)started at `wallNowMs`. */
    start(wallNowMs: number): void {
        this.originMs = wallNowMs
        this.lag = 0
    }

    stop(): void {
        this.originMs = null
        this.lag = 0
    }

    /** A segment ending at sermon time `endMs` arrived at `receivedAtMs`. */
    observe(receivedAtMs: number, endMs: number): void {
        const bound = receivedAtMs - endMs
        this.originMs = this.originMs === null ? bound : Math.min(this.originMs, bound)
        this.lag = Math.max(0, Math.min(MAX_LAG_MS, receivedAtMs - (this.originMs + endMs)))
    }

    get lagMs(): number {
        return this.lag
    }
}

/**
 * Milliseconds from now until the next section should be shown, or `null` when
 * there is nothing to schedule. `0` means "now": the transcript is already later
 * than the section has left to run, so waiting would only lose more ground.
 *
 * Nothing is scheduled until the tracker has timed enough lines to have an
 * opinion, or when the display already leads, or at the end of the song.
 */
export function leadDelayMs(
    update: TrackerUpdate,
    lagMs: number,
    stepCount: number,
    safetyMs = LEAD_SAFETY_MS,
): number | null {
    if (update.phase !== 'tracking' || update.singer === null) return null
    if (update.estimatedLineMs === null) return null
    if (update.displayStepIndex !== update.singer.stepIndex) return null
    if (update.singer.stepIndex + 1 >= stepCount) return null
    const delay = update.linesRemaining * update.estimatedLineMs - lagMs - safetyMs
    return Math.max(0, delay)
}
