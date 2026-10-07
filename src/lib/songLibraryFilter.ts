/**
 * Telling song lyrics apart from the other things churches keep in their song
 * software.
 *
 * Presentation libraries are used as general slide stores. An EasyWorship
 * library exported from one church held, alongside ~2,800 songs, sermon
 * outlines ("10 reasons why tithing does not work for some people"), prayer
 * points, fasting schedules, announcements and house rules. Indexed as songs,
 * those are the most dangerous entries for automatic song detection: they are
 * written in exactly the language a preacher speaks, so ordinary preaching
 * can match one near-verbatim and put it on the projector as a "song".
 *
 * `nonSongReason` is deliberately conservative — it names a reason only on
 * signals that lyrics essentially never carry (numbered points, verse
 * citations, a title that is a list heading or plainly an admin document) so a
 * real hymn is never dropped. It is used both to keep such entries out of the
 * bundled library and to keep them out of the auto-detect index for libraries
 * churches import themselves, where they stay available to project by hand.
 */

interface SongLike {
    title?: string
    sections?: Array<{ lines: string[] }>
}

/** "1. Point", "2) point", "iv. point" — an outline, not a lyric. */
const NUMBERED_POINT = /^\s*(\d{1,3}|[ivx]{1,5})[.)]\s+\S/i
/** "John 3:16", "1 Cor. 13:4" — sermon notes cite; lyrics don't. */
const VERSE_CITATION = /\b(?:[1-3]\s?)?[A-Z][a-z]{1,15}\.?\s\d{1,3}:\d{1,3}\b/
/** "7 Great principles…", "10 reasons why…", "5 THINGS THAT…": a list heading.
 *  At most three digits, so "10000 Reasons" stays a song. */
const LIST_HEADING = /^\s*\d{1,3}\s+(?:\S+\s+){0,2}(?:reasons?|things|ways|principles|prinicples|keys|signs|levels|channels|qualities|steps|lessons|points|persons|people|voices|anointings?)\b/i
/** Titles that name an admin or teaching document outright. */
const DOCUMENT_TITLE = new RegExp(
    [
        'announcement', 'prayer (?:chart|points?|topics?)', 'programme', 'program\\b', '(?:house|room) rules', 'security\\b',
        'collation', 'sermon', '\\bdevo(?:tion(?:al)?)?\\b', 'word for today', 'fasting', '\\bfast \\d', '\\bday \\d',
        'all night prayers?', 'mid year prayer', 'outline', 'bible study', 'reasons why', 'membership',
        'how to preach', 'preaching for today', '^word\\s*(?:today|for today|[-\\d])',
    ].join('|'),
    'i',
)
/** Citations are an outline's backbone but turn up in real lyrics too — a
 *  rap carol quoting "Matthew 1:23", a chorus with its source verses appended.
 *  So they only count when they are a real share of the entry, or many. */
const CITATION_SHARE = 0.15
const CITATIONS_ALWAYS = 5

export function nonSongReason(song: SongLike): string | null {
    const title = (song.title ?? '').replace(/\s+/g, ' ').trim()
    const lines = (song.sections ?? []).flatMap((s) => s.lines)

    if (LIST_HEADING.test(title)) return 'title is a list heading'
    if (DOCUMENT_TITLE.test(title)) return 'title names a document'

    let numbered = 0
    let citations = 0
    for (const line of lines) {
        if (NUMBERED_POINT.test(line)) numbered++
        if (VERSE_CITATION.test(line)) citations++
    }
    if (numbered >= 3) return `${numbered} numbered points`
    if (citations >= CITATIONS_ALWAYS || (citations >= 2 && citations / Math.max(1, lines.length) >= CITATION_SHARE)) {
        return `${citations} verse citations`
    }
    return null
}

export function isLikelySong(song: SongLike): boolean {
    return nonSongReason(song) === null
}
