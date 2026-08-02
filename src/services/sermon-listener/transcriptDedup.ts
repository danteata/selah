/**
 * Duplicate-utterance suppression for the transcript stream.
 *
 * What this exists for is ASR stutter: the same utterance re-emitted, or a
 * chunk that re-states the tail of the one before it. That is an *adjacent*
 * phenomenon — the recognizer revising or repeating what it just produced.
 *
 * Scanning a whole window of recent chunks for a repeat makes a different and
 * much stronger claim: "we have heard this before, so it can't be new." During
 * worship that claim is simply false. A chorus coming round again is the point
 * of a chorus. A song whose hook repeats every few lines — "we fall down, but
 * we get up" — lands in the history on its first pass, and from then on every
 * later pass is discarded as a duplicate. The visible symptom is that the
 * transcript stops dead partway through the song while audio is plainly still
 * arriving, and the song tracker, which is fed from that transcript, freezes on
 * whatever slide it was holding.
 *
 * So the comparison window is narrowed in worship mode to the immediately
 * preceding chunk: real stutter is still caught, a returning chorus is not.
 * Sermon mode keeps the wider history, where a phrase recurring within a
 * handful of consecutive utterances is more likely to be recognizer noise than
 * intent.
 */

/** Below this length a "duplicate" is more likely a common short filler than a
 *  repeated utterance, and dropping it loses more than it saves. */
const MIN_LENGTH_TO_COMPARE = 5

/** How much of a longer recent chunk the new text must account for before
 *  containment counts as duplication rather than genuine continuation. */
const CONTAINMENT_RATIO = 0.85

export interface DedupOptions {
    /**
     * True when the listener is in worship mode (song auto-detect on), where
     * lyrics repeat by design and only the previous chunk may be compared.
     */
    worshipMode?: boolean
}

/**
 * True if `text` should be dropped as a repeat of something in `recentChunks`
 * (oldest first, so the last entry is the immediately preceding utterance).
 */
export function isDuplicateUtterance(
    text: string,
    recentChunks: readonly string[],
    { worshipMode = false }: DedupOptions = {},
): boolean {
    if (!text || text.length < MIN_LENGTH_TO_COMPARE) return false

    const normalized = text.toLowerCase().trim()
    const window = worshipMode ? recentChunks.slice(-1) : recentChunks

    for (const recent of window) {
        const normalizedRecent = recent.toLowerCase().trim()

        if (normalized === normalizedRecent) return true

        // Containment: only a near-complete overlap counts. A chunk that
        // extends a previous one is new content, not a repeat.
        if (
            normalizedRecent.includes(normalized) &&
            normalized.length / normalizedRecent.length > CONTAINMENT_RATIO
        ) {
            return true
        }
    }

    return false
}
