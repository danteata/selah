/**
 * What was actually being sung, when — the reference every other number here
 * has been standing in for.
 *
 * Until now the eval could only report proxies: how many windows the tracker
 * called "tracking", its mean match confidence, how often the slides moved
 * backwards. None of those say whether the *right* slide was up, and the first
 * one saturates — once locked the tracker reports tracking on nearly every
 * window whether the position is right or not. So a run could look healthy and
 * be wrong throughout.
 *
 * HOW THIS WAS DERIVED, and why that matters. The spans below were read off the
 * *vocal-stem/whisper* transcript (`HEARD_VOCALS_WHISPER`), which is much the
 * clearest account of what was sung, and are used to score the
 * *mix/parakeet* run (`HEARD`). Labelling from the same transcript one then
 * grades would measure agreement with itself: where the text is clear both the
 * labeller and the tracker see the same thing, and where it is garbled neither
 * does. Deriving the labels from a different, better recording of the same
 * performance breaks that.
 *
 * It is still a human reading of a transcript rather than of the audio, so
 * treat the boundaries as good to a second or two, not to the window.
 *
 * `sectionId: null` means no correct answer exists, and those windows are
 * excluded from scoring rather than counted as failures. Three kinds:
 *   - the opening ad-lib ("Hallelujah", "Precious Jesus"), which is not in the
 *     stored lyrics,
 *   - transitional passages too garbled to label honestly,
 *   - 6:35-7:10, where the performance moves into "your name is your name / at
 *     the mention of the name Jesus / every knee shall bow, every tongue shall
 *     confess" — material that is not in the library's copy of this song at
 *     all. Worth stating plainly: for 35 seconds of a nine-minute rendition
 *     there is nothing correct for the tracker to show, and no amount of
 *     matching work changes that. The fix for that span is editing the song.
 */

export interface GroundTruthSpan {
    fromMs: number
    toMs: number
    /** Section id from `parseLyricsIntoSections`, or null where none applies. */
    sectionId: string | null
    note?: string
}

export const GROUND_TRUTH: GroundTruthSpan[] = [
    { fromMs: 0, toMs: 44_000, sectionId: null, note: 'opening ad-lib, not in the stored lyrics' },
    { fromMs: 44_000, toMs: 56_000, sectionId: 'v1', note: 'hills, mountains and valleys' },
    { fromMs: 56_000, toMs: 67_000, sectionId: 'v2', note: 'searched through humanity' },
    { fromMs: 67_000, toMs: 137_000, sectionId: 'v3', note: 'how you love me, through supply all my needs, then repeated' },
    { fromMs: 137_000, toMs: 154_000, sectionId: null, note: 'transition, too garbled to label' },
    { fromMs: 154_000, toMs: 164_000, sectionId: 'v4', note: 'carry my problems, favour is in your hands' },
    { fromMs: 164_000, toMs: 196_000, sectionId: 'v5', note: 'carry my yoke, freedom; then praise, victory' },
    { fromMs: 196_000, toMs: 242_000, sectionId: 'v3', note: 'back to how you love me / said in your word' },
    { fromMs: 242_000, toMs: 244_000, sectionId: null, note: 'unintelligible' },
    { fromMs: 244_000, toMs: 264_000, sectionId: 'v4', note: 'carry my burden, victory is in your hands' },
    { fromMs: 264_000, toMs: 294_000, sectionId: 'v5', note: 'carry my yoke, freedom; carry my praise' },
    { fromMs: 294_000, toMs: 395_000, sectionId: 'v6', note: 'prayer answering God / you have heard me, at length' },
    { fromMs: 395_000, toMs: 430_000, sectionId: null, note: 'name above all names — NOT in the stored lyrics' },
    { fromMs: 430_000, toMs: 561_000, sectionId: 'v6', note: 'back to the vamp, interleaved with exhortation' },
]

/** The section that should be on screen at `atMs`, or null if none applies. */
export function expectedSectionAt(atMs: number): string | null {
    const span = GROUND_TRUTH.find((s) => atMs >= s.fromMs && atMs < s.toMs)
    return span?.sectionId ?? null
}

/** Milliseconds of the recording for which a correct answer exists. */
export function labelledMs(): number {
    return GROUND_TRUTH.filter((s) => s.sectionId !== null).reduce(
        (total, s) => total + (s.toMs - s.fromMs),
        0,
    )
}
