/**
 * Cheap lexical pre-gate distinguishing sung lyrics from spoken sermon
 * narrative, run BEFORE song identification (and before any external lyric
 * lookup) ever attempts a match. Without it, the matching thresholds in
 * {@link import('./songIdentification').identifySong} only have to be beaten
 * by *some* window of a multi-hour service — and ordinary preaching is full
 * of short worship-adjacent phrases ("oh Lord", "hallelujah", "let's pray")
 * that can coincidentally clear them. This is not a classifier: it's a fast,
 * deliberately precision-biased filter (favor missing a real song over
 * pulling up a wrong one) that keeps the matcher from ever being exercised
 * against text that plainly was never sung.
 *
 * The two signals below are chosen because they're close to unique to spoken
 * narrative and essentially absent from song lyrics:
 *  - Real numbers (money, ages, dates, counts) — sermons cite figures
 *    constantly ("$450,000", "12 years old"); worship lyrics essentially
 *    never do.
 *  - Reporting-speech verbs in reported/past form ("he said", "I told him") —
 *    the connective tissue of storytelling, which lyrics don't need because
 *    they aren't narrating.
 *
 * Deliberately does NOT flag base/imperative forms like "say"/"tell"/"ask" or
 * logical connectives like "because" — those show up constantly in real
 * lyrics ("Because He Lives", "Go Tell It on the Mountain", "say that You are
 * my God") and are not reliably narrative on their own.
 */

/** Reporting-speech verbs in a form (past tense, or otherwise decisively
 *  narrative) that's close to unique to storytelling — a single occurrence is
 *  enough to disqualify. Base/imperative/present forms ("say", "tell", "ask")
 *  are deliberately excluded: they're common in lyrics and not decisive. */
const STRONG_NARRATIVE_MARKERS = new Set([
    'said', 'told', 'reply', 'replied', 'replies',
    'answered', 'answers', 'therefore', 'however',
    'understand', 'understood', 'explain', 'explained',
])

/** Words that lean narrative/expository but occasionally show up in worship
 *  lyrics too ("today", "chapter" in a hymn about scripture, "remember me" in
 *  a communion song) — a single occurrence shouldn't disqualify a window on
 *  its own, but a cluster of them should. */
const WEAK_NARRATIVE_MARKERS = new Set([
    'ask', 'asks', 'asked', 'asking', 'answer', 'remember',
    'verse', 'verses', 'chapter', 'chapters', 'sermon', 'scripture',
    'yesterday', 'tomorrow', 'today', 'congregation', 'preach', 'preaching',
    'preacher', 'pastor', 'meanwhile', 'basically', 'actually', 'obviously',
    'apparently', 'suppose', 'supposed', 'imagine', 'example',
])

/** Weak markers at/above this count disqualify a window. Deliberately an
 *  absolute count rather than a ratio: a ratio threshold flips on window
 *  length alone (the same single incidental hit passes in a 9-word window
 *  but fails in a 7-word one), which real transcript windows vary across
 *  constantly. Requiring a *second* co-occurring weak marker is a much more
 *  stable signal that this is actually exposition, not lyrics. */
const WEAK_HIT_CEILING = 2

/**
 * True if `text` plausibly represents something actually sung. False (i.e.
 * "don't even try to match a song") for text that reads like ordinary spoken
 * sermon content.
 */
export function looksLikeSinging(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false

    // Real digits (money, ages, dates, counts) are essentially unique to
    // narrated speech — hymn/worship lyrics don't cite figures.
    if (/\d/.test(trimmed)) return false

    const words = trimmed
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
    if (words.length === 0) return false

    if (words.some((w) => STRONG_NARRATIVE_MARKERS.has(w))) return false

    let weakHits = 0
    for (const w of words) if (WEAK_NARRATIVE_MARKERS.has(w)) weakHits++
    if (weakHits >= WEAK_HIT_CEILING) return false

    return true
}
