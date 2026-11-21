/**
 * Whether the slide on air was put there by the sermon listener itself, or by
 * the operator.
 *
 * It matters when a song is stepped away from. An operator who puts a verse
 * or an announcement up mid-song chose to; auto-detect bringing the same song
 * straight back over it would undo that choice. A verse the listener put up on
 * its own — a leader saying "Psalm 121" mid-song — is only the listener's
 * guess, and clear singing should outweigh it.
 *
 * Only the latest listener change is remembered, and only briefly: the
 * question is asked as the change lands, and a slide the listener showed
 * earlier and the operator clicks again later is the operator's choice.
 */

/** How long after the listener puts a slide on air the change is still its. */
const FRESH_MS = 2000

let last: { slideId: string; at: number } | null = null

/** Record that the sermon listener is putting this slide on air. */
export function noteListenerPutOnAir(slideId: string, now = Date.now()): void {
    last = { slideId, at: now }
}

/** Whether `slideId` went on air just now at the sermon listener's hand. */
export function wasPutOnAirByListener(slideId: string | null, now = Date.now()): boolean {
    return slideId !== null && last !== null && last.slideId === slideId && now - last.at < FRESH_MS
}
