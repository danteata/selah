import { SongPositionTracker, type TrackerConfig, type TrackerUpdate } from '../songTracker'
import { TranscriptLagEstimator, leadDelayMs } from '../songLead'
import { parseLyricsIntoSections } from '../../../lib/songSections'
import { HEARD, PRAYER_ANSWERING_GOD_LYRICS } from './realSongTranscript'
import { GROUND_TRUTH } from './realSongGroundTruth'
import type { Song } from '../../../types'

/**
 * Does the next section reach the screen before the singers do?
 *
 * `songTracking.eval.test.ts` scores each transcript window at the moment it
 * was *sung*, as if its text reached the tracker instantly. It never does: a
 * segment is transcribed only once it ends, and during continuous singing a
 * segment ends roughly when the next one starts — a median of six seconds here.
 * That delay is the whole problem the lead logic exists to solve, so this
 * replays the same real recording on a simulated clock where it is present:
 *
 *   - segment i arrives when segment i+1 begins (its end), plus engine time;
 *   - the tracker and the lead scheduler (`songLead.ts`) run exactly as
 *     `useSongTracker` runs them, timers included;
 *   - the display is scored continuously against when each section was
 *     actually sung (`realSongGroundTruth.ts`).
 *
 * Reported per section change: how many seconds before (+) or after (-) the
 * singers began it the slide appeared. The thresholds are a ratchet against
 * regression, set just under what the pipeline achieves — see
 * songTiming.eval.test.ts.
 */

/** Transcription time for one segment after it ends (Parakeet on a laptop CPU). */
const ENGINE_MS = 800
/** A segment with no successor is assumed to run this long. */
const LAST_SEGMENT_MS = 4000

const SONG: Song = {
    id: 'prayer-answering-god',
    _id: 'prayer-answering-god',
    title: 'Prayer Answering God',
    lyrics: PRAYER_ANSWERING_GOD_LYRICS,
    sections: parseLyricsIntoSections(PRAYER_ANSWERING_GOD_LYRICS),
} as unknown as Song

interface DisplayChange {
    atMs: number
    sectionId: string | null
}

export interface TimingOptions {
    engineMs?: number
    /** Override the lead rule, to compare candidates. */
    leadDelay?: (u: TrackerUpdate, lagMs: number, stepCount: number) => number | null
    /** Tracker configuration overrides, to compare candidates. */
    tracker?: Partial<TrackerConfig>
    /** Skip `reviewLead` entirely (the behaviour before retraction existed). */
    noReview?: boolean
}

/** Replay the recording on a simulated clock and return the display timeline. */
export function simulate(opts: TimingOptions = {}): DisplayChange[] {
    const engineMs = opts.engineMs ?? ENGINE_MS
    const leadDelay = opts.leadDelay ?? leadDelayMs
    const tracker = new SongPositionTracker(SONG, undefined, opts.tracker)
    tracker.start()
    const lag = new TranscriptLagEstimator()
    lag.start(0)

    const arrivals = HEARD.map((w, i) => {
        const endMs = HEARD[i + 1]?.atMs ?? w.atMs + LAST_SEGMENT_MS
        return { ...w, endMs, arriveMs: endMs + engineMs }
    })

    const timeline: DisplayChange[] = []
    const record = (atMs: number, u: TrackerUpdate) => {
        const last = timeline[timeline.length - 1]
        if (!last || last.sectionId !== u.displaySectionId) timeline.push({ atMs, sectionId: u.displaySectionId })
    }

    let timerAt: number | null = null
    for (const a of arrivals) {
        // A pending lead fires if its moment comes before this arrival.
        if (timerAt !== null && timerAt <= a.arriveMs) {
            record(timerAt, tracker.leadDisplay())
            timerAt = null
        }
        let u = tracker.ingest({ text: a.text, timeMs: a.atMs })
        record(a.arriveMs, u)
        lag.observe(a.arriveMs, a.endMs)
        const retracted = opts.noReview ? null : tracker.reviewLead(lag.lagMs)
        if (retracted) {
            u = retracted
            record(a.arriveMs, u)
        }
        // Every arrival re-arms the lead, exactly as the hook does.
        timerAt = null
        const delay = leadDelay(u, lag.lagMs, tracker.steps.length)
        if (delay === 0) record(a.arriveMs, tracker.leadDisplay())
        else if (delay !== null) timerAt = a.arriveMs + delay
    }
    if (timerAt !== null) record(timerAt, tracker.leadDisplay())
    return timeline
}

function shownAt(timeline: DisplayChange[], atMs: number): string | null {
    let shown: string | null = null
    for (const c of timeline) {
        if (c.atMs > atMs) break
        shown = c.sectionId
    }
    return shown
}

/** Showing the next section up to this long before it is sung is the goal. */
const EARLY_WINDOW_MS = 5000
/** A slide put up and taken down again within this long is a flash. */
const FLASH_MS = 3000

export interface TimingReport {
    /** Per section change: seconds the slide led (+) or trailed (-) the
     *  singers, taking the moment it came up *and stayed*. */
    transitions: Array<{ atMs: number; sectionId: string; leadS: number | null }>
    /** Share of labelled time with the sung section on screen. */
    correct: number
    /** Share showing the next sung section, up to {@link EARLY_WINDOW_MS} early. */
    early: number
    /** Share showing the next section further ahead than that — lyrics the
     *  congregation still needs are already gone. */
    premature: number
    /** Share showing anything else. */
    wrong: number
    /** Share with nothing up. */
    blank: number
    /** Slides shown for less than {@link FLASH_MS} before changing again. */
    flashes: number
}

export function score(timeline: DisplayChange[]): TimingReport {
    const labelled = GROUND_TRUTH.filter((s) => s.sectionId !== null)
    const flashes = timeline.filter((c, i) => i + 1 < timeline.length && timeline[i + 1].atMs - c.atMs < FLASH_MS).length
    // Section changes: a labelled span whose section differs from the previous
    // labelled one. The lead is measured to the last time the slide came up
    // before (or soon after) the singers got there, ignoring earlier flashes.
    const transitions: TimingReport['transitions'] = []
    for (let i = 1; i < labelled.length; i++) {
        const span = labelled[i]
        if (span.sectionId === labelled[i - 1].sectionId) continue
        const candidates = timeline.filter(
            (c) => c.sectionId === span.sectionId && c.atMs >= span.fromMs - 20_000 && c.atMs <= span.fromMs + 30_000,
        )
        // Up when the singers got there: the last time it came up before then.
        // Otherwise: the first time it came up after.
        const upAtStart = shownAt(timeline, span.fromMs) === span.sectionId
        const settled = upAtStart
            ? candidates.filter((c) => c.atMs <= span.fromMs).pop()
            : candidates.find((c) => c.atMs > span.fromMs)
        transitions.push({
            atMs: span.fromMs,
            sectionId: span.sectionId!,
            leadS: settled ? (span.fromMs - settled.atMs) / 1000 : null,
        })
    }

    let correct = 0, early = 0, premature = 0, wrong = 0, blank = 0, total = 0
    for (let i = 0; i < labelled.length; i++) {
        const span = labelled[i]
        const next = labelled[i + 1]
        for (let t = span.fromMs; t < span.toMs; t += 100) {
            total++
            const shown = shownAt(timeline, t)
            if (shown === null) blank++
            else if (shown === span.sectionId) correct++
            else if (next && shown === next.sectionId) {
                if (next.fromMs - t <= EARLY_WINDOW_MS) early++
                else premature++
            } else wrong++
        }
    }
    return {
        transitions,
        correct: correct / total,
        early: early / total,
        premature: premature / total,
        wrong: wrong / total,
        blank: blank / total,
        flashes,
    }
}

export function describeReport(name: string, r: TimingReport): string {
    const leads = r.transitions
        .map((t) => `${t.sectionId}@${(t.atMs / 1000).toFixed(0)}s:${t.leadS === null ? 'missed' : `${t.leadS >= 0 ? '+' : ''}${t.leadS.toFixed(1)}s`}`)
        .join(' ')
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`
    return `${name}: correct ${pct(r.correct)}, early ${pct(r.early)}, premature ${pct(r.premature)}, wrong ${pct(r.wrong)}, blank ${pct(r.blank)}, flashes ${r.flashes}\n  ${leads}`
}

