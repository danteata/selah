import type { Song } from '../../types'
import { lyricSimilarity, tokenize } from './songTracker'
import { getContentWords, isTheologicalCommon, isAmbiguousMatch, type ScoredVerseCandidate } from '../../lib/semanticRetrievalPolicy'
import { sectionsForSong } from '../../lib/songSections'
import { isLikelySong } from '../../lib/songLibraryFilter'
import { spellOutNumbers } from '../../lib/spokenNumbers'

/**
 * Song identification from a live transcript (Phase 2 "Searching").
 *
 * Given what's being sung, find which song in the library it is — even when no
 * song is loaded yet — so the app can pull it up automatically, the same way
 * sermon scripture is detected and displayed. This is lexical (people sing the
 * actual words, and Whisper transcribes them closely), so it reuses the
 * tracker's {@link lineSimilarity} rather than embeddings.
 *
 * To stay fast over a few thousand songs (~tens of thousands of lines), lines
 * are indexed by their significant tokens; a query only scores the lines that
 * share a token with it, not the whole corpus.
 */

/** A minimum line length filters out short filler ("oh", "yeah") that would
 *  match many songs and cause false positives. */
const MIN_LINE_WORDS = 4
/**
 * …but length alone doesn't measure how discriminating a line is, because it
 * counts a repeated word once per repetition. "Yeah yeah (yeah yeah)" is four
 * tokens and clears {@link MIN_LINE_WORDS}, yet carries exactly one distinct
 * content word, and a one-word line is a wildcard: {@link lineSimilarity}'s
 * coverage term is `shared / distinct-words-in-line`, so *any* transcript
 * containing "yeah" scores 0.95 against it — above the near-exact threshold
 * that identifies a song on its own, with no corroboration required.
 *
 * That is not hypothetical. A worship set transcribed as "…all will see how
 * great and crazy yeah…" identified an unrelated library song outright on its
 * "yeah yeah (yeah yeah)" line (0.95), while that song's one genuinely
 * relevant lyric scored 0.24 — and the wrong song went to the projector.
 * Requiring two distinct content words keeps real short lines ("How great is
 * our God" → great, god) and drops the wildcards.
 */
const MIN_LINE_DISTINCT_CONTENT = 2
/** Tokens shorter than this are too common to be discriminating. */
const SIG_TOKEN_LEN = 4

export interface SongLineEntry {
    songId: string
    title: string
    sectionId: string
    lineIndex: number
    /** Last line this entry covers: `lineIndex` for a single line, the next
     *  line for a phrase entry (see {@link buildSongIndex}). */
    lastLineIndex: number
    text: string
    /** Distinctive (stopword-filtered, stemmed) words of the line, DEDUPED.
     *  Used to reject matches that only overlap on filler words — which means
     *  it has to count distinct words. Kept as duplicates, one shared word in a
     *  line that repeats it four times counted as four shared words, clearing
     *  both {@link MIN_SHARED_CONTENT} and {@link MIN_DISTINCTIVE_SHARED} (and
     *  the query-coverage gate) on the strength of a single overlap. */
    content: string[]
}

/** Minimum distinctive content words a candidate line must share with the
 *  query to be considered at all — kills "I have made you…" style function-word
 *  matches against unrelated songs. This is only a cheap pre-filter to narrow
 *  candidates; the real accept/reject decision is the full-line similarity
 *  score below (`corrobBest`/`corrobSecond`), which also has to clear its bar. */
const MIN_SHARED_CONTENT = 2
/** Of those shared content words, at least this many must be non-generic
 *  (see {@link isTheologicalCommon}) — otherwise sermon speech full of "God",
 *  "Lord", "praise", "grace" etc. corroborates against almost any worship
 *  song's lyrics on vocabulary alone, with no actual phrase in common. The
 *  Bible-verse detector already gates the same way (see
 *  `validateSemanticMatch`'s `distinctiveOverlap`); song identification is
 *  lexical rather than semantic but faces the identical failure mode.
 *  Requiring *most* (not just one) of the minimum shared words to be
 *  distinctive also guards against two unrelated real songs coincidentally
 *  sharing one distinctive word plus one generic one. */
const MIN_DISTINCTIVE_SHARED = 2
/**
 * What a worship leader calls out between lines, in any song: "everybody put
 * your hands together", "come on, lift your hands", "make some noise" — and
 * the fillers of ordinary talk ("okay", "all right", "gonna"). Some
 * songs carry such a call as a lyric, so a leader saying it four times named
 * that song (Enyo, from the intro of an unrelated recording). Like the generic
 * theological words, these don't count towards {@link MIN_DISTINCTIVE_SHARED}:
 * a match has to rest on words particular to the song. Content-word forms, as
 * `getContentWords` returns them.
 */
const CROWD_CALL_WORDS = new Set([
    'everybody', 'everyone', 'somebody', 'put', 'hand', 'hands', 'together', 'come', 'clap',
    'lift', 'raise', 'shout', 'scream', 'make', 'noise', 'stand', 'feet', 'jump', 'dance',
    'wave', 'say', 'says', 'yeah', 'right', 'now', 'let', 'go',
    'okay', 'alright', 'hey', 'oh', 'ooh', 'whoa', 'la', 'na', 'hallelujah', 'good',
    'gonna', 'wanna', 'gotta',
    // Counting in ("one, two, three, four") is a lyric in some songs and
    // ordinary speech everywhere else.
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
])

function isGenericWord(word: string): boolean {
    // Under three letters is a contraction's leftover ("m" of "I'm", "ll",
    // "re") or a syllable; neither tells songs apart.
    return word.length < 3 || isTheologicalCommon(word) || CROWD_CALL_WORDS.has(word)
}

/** Stems `getContentWords` leaves of a negative contraction ("don't" → "don"). */
const CONTRACTION_STEMS = new Set(['don', 'won', 'can', 'isn', 'aren', 'didn', 'doesn', 'wasn', 'ain', 'couldn', 'wouldn', 'shouldn'])

/**
 * A line's distinct content words, without contraction leftovers. Counting
 * "m" (of "I'm") or "don" and "t" (of "don't") as words let "(I'm going, I'm
 * going)" and "DON'T YOU KNOW" past {@link MIN_LINE_DISTINCT_CONTENT}, and
 * each then matched any sentence with "going" or "know" in it.
 */
function lineContentWords(line: string): string[] {
    return Array.from(new Set(getContentWords(spellOutNumbers(line)))).filter(
        (w) => w.length >= 3 && !CONTRACTION_STEMS.has(w),
    )
}

/** Whether a lyric line has a content word that isn't generic. */
function hasOwnWord(line: string): boolean {
    return lineContentWords(line).some((w) => !isGenericWord(w))
}
/** Minimum fraction of the *query's* distinctive words that a candidate line
 *  must explain (shared words / query's content-word count). Every gate above
 *  measures overlap from the line's side only, so a short, ubiquitous worship
 *  phrase ("lift your voice", "make a joyful sound") fully contained in an
 *  otherwise unrelated multi-sentence utterance can still score high on line
 *  coverage alone — it explains 100% of the (tiny) line but almost none of
 *  what was actually said. Requiring the match to also account for a real
 *  share of the query catches that: real singing means most of the query's
 *  distinctive words belong to the song, not just a couple embedded in
 *  unrelated speech. */
const MIN_QUERY_COVERAGE = 0.3
/** Only enforce query coverage once the query has enough distinctive words
 *  for the ratio to be meaningful. Below this, a couple of unrelated ASR
 *  filler words can swing the ratio wildly even though the absolute overlap
 *  (e.g. 2-3 shared words) is unchanged — the ratio is noise, not signal, at
 *  that size. The other gates (shared-content floor, line-similarity score,
 *  distinctive-word requirement) still apply regardless. */
const MIN_QUERY_SIZE_FOR_COVERAGE_CHECK = 6

export interface SongIndex {
    entries: SongLineEntry[]
    /** significant token → indices into `entries` */
    token: Map<string, number[]>
    /** number of songs indexed */
    songCount: number
    /** Every word of each indexed song, in order — short lines included —
     *  for telling two copies of one song apart from two songs that share a
     *  passage (see `sameLyrics`). */
    words: Map<string, string[]>
}

export interface SongMatch {
    songId: string
    title: string
    /** Section the best-matching line belongs to. */
    sectionId: string
    lineIndex: number
    /** Best single-line similarity, 0..1. */
    confidence: number
    /** How many of this song's lines the query matched above threshold. */
    matchedLines: number
}

export interface IdentifyOptions {
    /** A single line at/above this similarity identifies the song on its own
     *  (near-exact — unlikely to be a coincidence). */
    strongThreshold?: number
    /** Corroboration path: the best matching line must clear this… */
    corroborationBest?: number
    /** …and a *second* line of the same song must clear this. Two moderate
     *  lines of one song is far stronger evidence than one lucky line, and is
     *  what makes garbled sung input identify the right song without pulling a
     *  wrong one. */
    corroborationSecond?: number
    /** Require at least this many corroborating lines (default 1). */
    minMatchedLines?: number
}

const EMPTY_INDEX: SongIndex = { entries: [], token: new Map(), songCount: 0, words: new Map() }

/** Build a searchable index from the song library. */
export function buildSongIndex(songs: Song[]): SongIndex {
    const entries: SongLineEntry[] = []
    const token = new Map<string, number[]>()
    const words = new Map<string, string[]>()

    for (const song of songs) {
        const songId = song._id || song.id
        // Derived when the song has none stored: a song with only freeform
        // lyrics was previously indexed as zero lines, so auto-detect could
        // never name it however clearly it was sung.
        const sections = sectionsForSong(song)
        // Sermon outlines, prayer points and announcements kept in the song
        // library are written in exactly the words a preacher speaks, so they
        // are the entries ordinary preaching matches near-verbatim. They stay
        // in the library to project by hand; they are just never auto-detected.
        if (!isLikelySong({ title: song.title, sections })) continue
        words.set(songId, sections.flatMap((section) => section.lines.flatMap((line) => tokenize(line))))
        for (const section of sections) {
            // Each line, and each pair of adjacent lines as one phrase.
            // Projection software splits a sung line across short display
            // lines ("And these are the days" / "of your servant, Moses"); on
            // its own each half was too short to index or too small a share
            // of a 14-word window to pass the coverage gate, so a song sung
            // word for word went unrecognised.
            //
            // Only lines that each carry a word of their own are paired: a
            // filler line ("Yeah yeah yeah yeah") joined to its neighbour made
            // a phrase that ordinary "all right… yeah… good" talk matched.
            const spans: Array<[number, number]> = []
            section.lines.forEach((_, l) => {
                spans.push([l, l])
                if (l + 1 < section.lines.length && hasOwnWord(section.lines[l]) && hasOwnWord(section.lines[l + 1])) {
                    spans.push([l, l + 1])
                }
            })
            for (const [lineIndex, lastLineIndex] of spans) {
                const line = section.lines.slice(lineIndex, lastLineIndex + 1).join(' ')
                const toks = tokenize(line)
                if (toks.length < MIN_LINE_WORDS) continue
                const content = lineContentWords(line)
                if (content.length < MIN_LINE_DISTINCT_CONTENT) continue
                const idx = entries.length
                entries.push({
                    songId,
                    title: song.title,
                    sectionId: section.id,
                    lineIndex,
                    lastLineIndex,
                    text: line,
                    content,
                })
                const seen = new Set<string>()
                for (const t of toks) {
                    if (t.length < SIG_TOKEN_LEN || seen.has(t)) continue
                    seen.add(t)
                    let arr = token.get(t)
                    if (!arr) {
                        arr = []
                        token.set(t, arr)
                    }
                    arr.push(idx)
                }
            }
        }
    }

    return { entries, token, songCount: songs.length, words }
}

/**
 * Identify the best-matching song for a transcript window.
 *
 * Returns null when nothing clears the bar — which is the common case for
 * sermon speech, so this can run continuously without false pop-ups (callers
 * should still confirm across a couple of windows before acting).
 */
export function identifySong(
    query: string,
    index: SongIndex,
    opts: IdentifyOptions = {},
): SongMatch | null {
    const strong = opts.strongThreshold ?? 0.82
    const corrobBest = opts.corroborationBest ?? 0.68
    const corrobSecond = opts.corroborationSecond ?? 0.62
    const minMatched = opts.minMatchedLines ?? 1
    const FLOOR = 0.5

    // Transcripts write numbers as digits, lyrics as words; compare as words.
    query = spellOutNumbers(query)
    const qTokens = tokenize(query)
    if (qTokens.length < MIN_LINE_WORDS || index.entries.length === 0) return null

    // Distinctive words of the query, for the content-overlap gate below.
    const qContent = new Set(getContentWords(query))
    if (qContent.size === 0) return null

    // Gather candidate lines that share a significant token with the query.
    const candidates = new Set<number>()
    const seen = new Set<string>()
    for (const t of qTokens) {
        if (t.length < SIG_TOKEN_LEN || seen.has(t)) continue
        seen.add(t)
        const arr = index.token.get(t)
        if (arr) for (const i of arr) candidates.add(i)
    }
    if (candidates.size === 0) return null

    interface Agg {
        title: string
        hits: Array<{ entry: SongLineEntry; score: number }>
    }
    const perSong = new Map<string, Agg>()
    for (const i of candidates) {
        const e = index.entries[i]
        // Gate: the line must share enough words with the query, accounting
        // for a real share of it (not just a couple embedded in unrelated
        // speech). Without this, unrelated songs match on filler
        // ("I/have/you/my") or a short phrase fully contained in an otherwise
        // unrelated utterance.
        let sharedContent = 0
        let distinctiveShared = 0
        for (const w of e.content) {
            if (!qContent.has(w)) continue
            sharedContent++
            if (!isGenericWord(w)) distinctiveShared++
        }
        if (sharedContent < MIN_SHARED_CONTENT) continue
        if (qContent.size >= MIN_QUERY_SIZE_FOR_COVERAGE_CHECK && sharedContent / qContent.size < MIN_QUERY_COVERAGE) continue
        const score = lyricSimilarity(query, e.text)
        if (score < FLOOR) continue // ignore weak incidental token overlap
        // Distinctive-vocabulary gate: reject a line whose overlap is only
        // generic theological words ("God"/"Lord"/"praise") UNLESS it matches
        // near-exactly on its own AND still has at least one distinctive word
        // — near-verbatim wording (score >= strong) is strong evidence
        // regardless of how common the vocabulary otherwise is (hymns like
        // "Holy holy holy Lord God Almighty" are built almost entirely from
        // such words), but zero distinctive overlap is a different failure
        // mode: ordinary sermon speech coincidentally reciting the exact same
        // handful of common words as a decoy line ("Praise the Lord our God
        // and King") can also score near-exact on coverage alone, with no
        // actual phrase in common beyond that generic vocabulary. Requiring
        // >=1 distinctive word even on the exemption path blocks that while
        // still rescuing genuinely generic-vocabulary hymns.
        const distinctiveOk = distinctiveShared >= MIN_DISTINCTIVE_SHARED
            || (distinctiveShared >= 1 && score >= strong)
        if (!distinctiveOk) continue
        const agg = perSong.get(e.songId)
        if (!agg) perSong.set(e.songId, { title: e.title, hits: [{ entry: e, score }] })
        else agg.hits.push({ entry: e, score })
    }

    const qualifying: Array<{ match: SongMatch; cand: ScoredVerseCandidate }> = []
    for (const [songId, agg] of perSong) {
        // Corroboration has to come from different lines saying different
        // things: a phrase entry and the single line inside it are one piece
        // of evidence, and so is a line the song repeats ("I'm getting
        // stronger" five times over). Take the best hit, then greedily the
        // best hits that share no line with any taken and aren't a repeat.
        const taken: Array<{ entry: SongLineEntry; score: number }> = []
        for (const hit of agg.hits.slice().sort((a, b) => b.score - a.score)) {
            if (taken.some((t) => overlaps(t.entry, hit.entry) || sameWords(t.entry, hit.entry))) continue
            taken.push(hit)
        }
        const sorted = taken.map((t) => t.score)
        const bestEntry = taken[0].entry
        const b0 = sorted[0] ?? 0
        const b1 = sorted[1] ?? 0
        // Qualify on a near-exact single line OR two corroborating lines.
        const strongHit = b0 >= strong
        const corroborated = b0 >= corrobBest && b1 >= corrobSecond
        if (!strongHit && !corroborated) continue
        const matchedLines = sorted.filter((s) => s >= corrobSecond).length
        if (matchedLines < minMatched) continue
        const confidence = strongHit ? b0 : (b0 + b1) / 2
        // Total evidence (top line + a discounted second line) is what
        // disambiguates two songs that share a verbatim line: the one that ALSO
        // matches a second, distinctive line wins. `confidence` stays 0..1 for
        // the confirmation tracker; `evidence` is only for ranking/ambiguity.
        const evidence = b0 + 0.5 * b1
        qualifying.push({
            match: {
                songId,
                title: agg.title,
                sectionId: bestEntry.sectionId,
                lineIndex: bestEntry.lineIndex,
                confidence,
                matchedLines,
            },
            // songId in `book` lets us reuse the verse detector's ambiguity guard.
            cand: { score: evidence, book: songId, chapter: 0 },
        })
    }

    if (qualifying.length === 0) return null
    qualifying.sort((a, b) => b.cand.score - a.cand.score)
    const top = qualifying[0]

    // A library can hold one song twice (imported under two titles, or once
    // as verses and once as a single block). Matching both isn't ambiguity
    // about *what* is being sung, so a runner-up that is the same lyrics
    // doesn't count against the top; refusing to choose meant such a song was
    // never detected at all. Sharing the matched line isn't enough to call
    // them the same song — "Everybody put your hands together" is a line of
    // several — so most of their lyrics have to agree.
    const copies = qualifying.filter((q) => q === top || sameLyrics(index, top.match.songId, q.match.songId))
    const rivals = qualifying.filter((q) => !copies.includes(q) || q === top)

    // Inter-song ambiguity guard: if the top song doesn't clearly beat a
    // DIFFERENT runner-up song, we can't tell which is being sung — return
    // nothing rather than commit the wrong one. Songs that share
    // "holy/worthy/hallelujah/your love" phrasing are the classic trap. This
    // reuses the exact guard the Bible-verse detector already uses.
    if (isAmbiguousMatch(top.cand, rivals.map((q) => q.cand))) return null

    // Of the copies of this song that matched, always name the same one —
    // the best structured (most sections), then the lowest id — so the
    // confirmation tracker's evidence accumulates on one song instead of
    // splitting between copies window by window and confirming neither.
    copies.sort(
        (a, b) =>
            sectionCount(index, b.match.songId) - sectionCount(index, a.match.songId) ||
            a.match.songId.localeCompare(b.match.songId),
    )
    return copies[0].match
}

/** Share of word pairs two songs have in common for them to count as one
 *  song held twice. Different line breaks don't matter: pairs are taken
 *  across the whole song's words. Real copies in an imported library measured
 *  0.89 and 0.97; two different songs sharing a chorus stay well below. */
const SAME_LYRICS_OVERLAP = 0.85

const songBigramsCache = new WeakMap<SongIndex, Map<string, Set<string>>>()

/** Every adjacent word pair in a song's lyrics. */
function songBigrams(index: SongIndex, songId: string): Set<string> {
    let bySong = songBigramsCache.get(index)
    if (!bySong) {
        bySong = new Map()
        songBigramsCache.set(index, bySong)
    }
    let pairs = bySong.get(songId)
    if (!pairs) {
        const words = index.words.get(songId) ?? []
        pairs = new Set(words.slice(1).map((w, i) => `${words[i]} ${w}`))
        bySong.set(songId, pairs)
    }
    return pairs
}

function sectionCount(index: SongIndex, songId: string): number {
    return new Set(index.entries.filter((e) => e.songId === songId).map((e) => e.sectionId)).size
}

function sameLyrics(index: SongIndex, a: string, b: string): boolean {
    const pa = songBigrams(index, a)
    const pb = songBigrams(index, b)
    const smaller = pa.size <= pb.size ? pa : pb
    const larger = smaller === pa ? pb : pa
    if (smaller.size === 0) return false
    let shared = 0
    for (const p of smaller) if (larger.has(p)) shared++
    return shared / smaller.size >= SAME_LYRICS_OVERLAP
}

/** Whether two entries have the same content words: a repeated line. */
function sameWords(a: SongLineEntry, b: SongLineEntry): boolean {
    return a.content.length === b.content.length && a.content.every((w) => b.content.includes(w))
}

function overlaps(a: SongLineEntry, b: SongLineEntry): boolean {
    return a.sectionId === b.sectionId && a.lineIndex <= b.lastLineIndex && b.lineIndex <= a.lastLineIndex
}

export { EMPTY_INDEX }
