/**
 * Which transcript segments a consumer (the song tracker, song auto-detect)
 * hasn't seen yet.
 *
 * Kept by the id of the last segment seen, not by a count. Counting assumed a
 * shorter list meant a new session — but a transcript cleared while stopped
 * grows back past the old count before anyone looks, so its first segments
 * were skipped; and segments restored after a reload were all taken for new
 * speech.
 */

interface Segment {
    id: string
}

export class SegmentCursor {
    private lastSeenId: string | null = null

    /** Count everything now in `segments` as seen. */
    markSeen(segments: readonly Segment[] | undefined): void {
        this.lastSeenId = segments && segments.length > 0 ? segments[segments.length - 1].id : null
    }

    /**
     * The segments after the last one seen, which are then seen. `cleared`
     * when the last one seen is no longer there — the transcript was cleared
     * since, and everything in it now is new.
     */
    take<T extends Segment>(segments: readonly T[] | undefined): { fresh: T[]; cleared: boolean } {
        const list = segments ?? []
        let from = 0
        let cleared = false
        if (this.lastSeenId !== null) {
            let at = -1
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].id === this.lastSeenId) {
                    at = i
                    break
                }
            }
            if (at === -1) cleared = true
            else from = at + 1
        }
        this.markSeen(list)
        return { fresh: list.slice(from), cleared }
    }
}
