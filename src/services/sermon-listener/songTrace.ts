/**
 * A record of what the song follower decided and why, for working out after a
 * service why a slide didn't move, or moved wrongly.
 *
 * Each entry is one decision: the words it was made on, the line they matched
 * and how well, what the tracker made of it, and whether the slide on air
 * changed — and if not, what stopped it. A stall that looks the same from the
 * desk ("it just didn't move") has several different causes, and only this
 * tells them apart: words that matched nothing, a match too weak to lead, or a
 * section with no slide to move to.
 *
 * Kept in memory (bounded) and written into the dev session sidecar at Stop,
 * so a recorded service can be replayed into a test.
 */

/** Why the slide on air did not change after a decision. */
export type SlideHeld =
    | 'auto-advance-off'
    | 'locked'
    | 'no-section-to-show'
    | 'something-else-on-air'
    | 'step-has-no-slide'
    | 'already-on-air'

export interface SongTraceEntry {
    /** Wall-clock ms. */
    at: number
    /** What prompted the decision. */
    source: 'final' | 'interim' | 'clock' | 'seek' | 'review' | 'state' | 'detect'
    songId: string | null
    /** The words the decision was made on, if any. */
    text?: string
    /** Tracker's reason (`acquired`, `jump-weak`, ...) or auto-detect's. */
    reason: string
    phase?: string
    /** The best line this window matched, and its score. */
    matchedLine?: string
    score?: number
    /** Where the tracker places the singers, as `step:line`. */
    singer?: string
    /** Arrangement step the tracker wants shown. */
    displayStep?: number | null
    singing?: boolean
    /** The slide put on air, when one was. */
    movedTo?: string
    /** Why no slide was put on air, when none was. */
    held?: SlideHeld
}

const MAX_ENTRIES = 3000

let entries: SongTraceEntry[] = []

/** Record a decision, and log it to the console. */
export function traceSong(entry: SongTraceEntry): void {
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
    const outcome = entry.movedTo ? `→ ${entry.movedTo}` : entry.held ? `held: ${entry.held}` : ''
    const match = entry.score !== undefined ? ` ${entry.score.toFixed(2)} "${entry.matchedLine ?? ''}"` : ''
    console.log(`[SongTrace] ${entry.source} ${entry.reason}${match} ${outcome}`, entry)
}

/** Decisions made since `sinceMs` (wall clock), oldest first. */
export function songTraceSince(sinceMs: number): SongTraceEntry[] {
    return entries.filter((e) => e.at >= sinceMs)
}

/** Forget every recorded decision. Tests only. */
export function clearSongTrace(): void {
    entries = []
}
