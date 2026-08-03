import type { SongTrackingState } from '../../store/appStore'

/**
 * Whether the audio right now is a congregation singing rather than a preacher
 * speaking, on evidence rather than a mode switch.
 *
 * Scripture detection is built for prose, and worship lyrics defeat it in a
 * particular way: they are scripture-adjacent by design, so the semantic
 * matcher keeps finding verses in them. Observed during one song, from sung
 * lines alone, the listener surfaced Psalms 121:1, Isaiah 15:9 and
 * Philippians 4:1 — "I will look to the hills, from whence cometh my help" is
 * a real allusion to Psalm 121, which is exactly why the match scores well and
 * exactly why putting it on screen is wrong. The congregation is singing, not
 * being read to.
 *
 * It is not only wrong, it is expensive: every window ran an embedding pass and
 * a sliding-window fallback in the renderer, plus an LLM call, throughout a
 * nine-minute song that could never contain a reading.
 *
 * The test is deliberately narrow. Auto-detect being enabled says the operator
 * expects songs, but says nothing about this moment. A song being *live* says
 * little either — one often stays on screen while the preacher starts talking
 * over it. Requiring the tracker to be actively *tracking* means the incoming
 * audio is matching that song's lyrics line by line, which is the only one of
 * the three that is evidence about the audio itself. When preaching starts the
 * tracker stops matching, and scripture detection resumes on its own.
 */
export function isCongregationSinging(songTracking: SongTrackingState): boolean {
    return (
        songTracking.autoDetect &&
        songTracking.status.songId !== null &&
        songTracking.status.phase === 'tracking'
    )
}
