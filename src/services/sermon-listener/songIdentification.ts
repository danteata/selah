import type { Song } from '../../types'
import { lineSimilarity, tokenize } from './songTracker'
import { getContentWords } from '../../lib/semanticRetrievalPolicy'

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
/** Tokens shorter than this are too common to be discriminating. */
const SIG_TOKEN_LEN = 4

export interface SongLineEntry {
    songId: string
    title: string
    sectionId: string
    lineIndex: number
    text: string
    /** Distinctive (stopword-filtered, stemmed) words of the line. Used to
     *  reject matches that only overlap on filler words. */
    content: string[]
}

/** Minimum distinctive content words a candidate line must share with the
 *  query to be considered at all — kills "I have made you…" style function-word
 *  matches against unrelated songs. */
const MIN_SHARED_CONTENT = 2

export interface SongIndex {
    entries: SongLineEntry[]
    /** significant token → indices into `entries` */
    token: Map<string, number[]>
    /** number of songs indexed */
    songCount: number
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

const EMPTY_INDEX: SongIndex = { entries: [], token: new Map(), songCount: 0 }

/** Build a searchable index from the song library. */
export function buildSongIndex(songs: Song[]): SongIndex {
    const entries: SongLineEntry[] = []
    const token = new Map<string, number[]>()

    for (const song of songs) {
        const songId = song._id || song.id
        const sections = song.sections ?? []
        for (const section of sections) {
            section.lines.forEach((line, lineIndex) => {
                const toks = tokenize(line)
                if (toks.length < MIN_LINE_WORDS) return
                const idx = entries.length
                entries.push({
                    songId,
                    title: song.title,
                    sectionId: section.id,
                    lineIndex,
                    text: line,
                    content: getContentWords(line),
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
            })
        }
    }

    return { entries, token, songCount: songs.length }
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
    const corrobBest = opts.corroborationBest ?? 0.6
    const corrobSecond = opts.corroborationSecond ?? 0.55
    const minMatched = opts.minMatchedLines ?? 1
    const FLOOR = 0.5

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
        scores: number[]
        bestEntry: SongLineEntry
        bestScore: number
    }
    const perSong = new Map<string, Agg>()
    for (const i of candidates) {
        const e = index.entries[i]
        // Gate: the line must share enough *distinctive* words with the query.
        // Without this, unrelated songs match on filler ("I/have/you/my").
        let sharedContent = 0
        for (const w of e.content) if (qContent.has(w)) sharedContent++
        if (sharedContent < MIN_SHARED_CONTENT) continue
        const score = lineSimilarity(query, e.text)
        if (score < FLOOR) continue // ignore weak incidental token overlap
        const agg = perSong.get(e.songId)
        if (!agg) {
            perSong.set(e.songId, { title: e.title, scores: [score], bestEntry: e, bestScore: score })
        } else {
            agg.scores.push(score)
            if (score > agg.bestScore) {
                agg.bestScore = score
                agg.bestEntry = e
            }
        }
    }

    let best: SongMatch | null = null
    for (const [songId, agg] of perSong) {
        const sorted = agg.scores.slice().sort((a, b) => b - a)
        const b0 = sorted[0] ?? 0
        const b1 = sorted[1] ?? 0
        // Qualify on a near-exact single line OR two corroborating lines.
        const strongHit = b0 >= strong
        const corroborated = b0 >= corrobBest && b1 >= corrobSecond
        if (!strongHit && !corroborated) continue
        const matchedLines = sorted.filter((s) => s >= corrobSecond).length
        if (matchedLines < minMatched) continue
        const confidence = strongHit ? b0 : (b0 + b1) / 2
        if (!best || confidence > best.confidence) {
            best = {
                songId,
                title: agg.title,
                sectionId: agg.bestEntry.sectionId,
                lineIndex: agg.bestEntry.lineIndex,
                confidence,
                matchedLines,
            }
        }
    }
    return best
}

export { EMPTY_INDEX }
