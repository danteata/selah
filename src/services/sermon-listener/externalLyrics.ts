import { llmChatJson, httpRequest, type LlmConfig } from './llmClient'
import { parseLyricsIntoSections, buildDefaultArrangement } from '../../lib/songSections'
import type { Song } from '../../types'

/**
 * External lyrics fallback for auto-detect (Phase 2 "Searching", off by default).
 *
 * When singing doesn't match any library song, we:
 *   1. Ask the configured LLM which song the transcribed snippet is (title +
 *      artist only — not the lyrics, to avoid hallucinated words on screen).
 *   2. Fetch the *actual* lyrics from LRCLIB (lrclib.net) — free, no API key.
 *   3. Structure them with the same parser used for imports and build a Song.
 *
 * The caller then displays it and persists it to the local library, so the next
 * time that song comes up it's an instant local match. Copyright note: this is
 * intended for songs your church is licensed to display (e.g. CCLI); it's
 * opt-in and surfaced with that caveat in Settings.
 */

export interface SongGuess {
    title: string
    artist: string
}

/** Ask the LLM to name the song from a sung snippet. Returns null when unsure. */
export async function identifySongViaLLM(
    snippet: string,
    config: LlmConfig,
    signal?: AbortSignal,
): Promise<SongGuess | null> {
    const system =
        'You identify worship songs, hymns, and Christian music from a short snippet of ' +
        'transcribed sung lyrics (the transcription may contain errors). Reply ONLY as JSON: ' +
        '{"title": string, "artist": string, "confident": boolean}. If you are not reasonably ' +
        'sure which specific song it is, set confident=false and leave title/artist empty. ' +
        'Never guess wildly.'
    const user = `Transcribed lyrics snippet:\n"""${snippet}"""\n\nWhich song is this?`
    try {
        const out = await llmChatJson<{ title?: string; artist?: string; confident?: boolean }>(
            config,
            system,
            user,
            { signal, timeoutMs: 15000 },
        )
        if (!out || out.confident === false) return null
        const title = (out.title || '').trim()
        if (!title) return null
        return { title, artist: (out.artist || '').trim() }
    } catch {
        return null
    }
}

interface LrclibResult {
    trackName?: string
    artistName?: string
    plainLyrics?: string
    syncedLyrics?: string
    instrumental?: boolean
}

/** Fetch plain lyrics for a title/artist from LRCLIB. Returns null if none. */
export async function fetchLyricsFromLRCLIB(
    title: string,
    artist: string,
    signal?: AbortSignal,
): Promise<{ title: string; artist: string; lyrics: string } | null> {
    const params = new URLSearchParams({ track_name: title })
    if (artist) params.set('artist_name', artist)
    const url = `https://lrclib.net/api/search?${params.toString()}`
    try {
        const { status, body } = await httpRequest(url, {
            method: 'GET',
            // LRCLIB asks clients to identify themselves. (Browsers drop this
            // forbidden header harmlessly; the Rust proxy sends it.)
            headers: { 'User-Agent': 'Selah/1.0 (worship presentation app)' },
            timeoutMs: 12000,
            signal,
        })
        if (status < 200 || status >= 300) return null
        const results = JSON.parse(body) as LrclibResult[]
        if (!Array.isArray(results)) return null
        const hit = results.find((r) => !r.instrumental && (r.plainLyrics || '').trim())
        if (!hit?.plainLyrics) return null
        return {
            title: hit.trackName || title,
            artist: hit.artistName || artist,
            lyrics: hit.plainLyrics,
        }
    } catch {
        return null
    }
}

/**
 * Build a structured {@link Song} from fetched plain lyrics. Pure (no network)
 * so it's unit-testable. Returns null if the lyrics don't yield any sections.
 */
export function buildSongFromLyrics(
    title: string,
    artist: string,
    lyrics: string,
    id: string,
    timestamp: string,
): Song | null {
    const sections = parseLyricsIntoSections(lyrics)
    if (sections.length === 0) return null
    return {
        id,
        _id: id,
        title: title.trim() || 'Untitled',
        artist: artist.trim() || 'Unknown',
        author: artist.trim() || undefined,
        lyrics: sections.map((s) => s.lines.join('\n')).join('\n\n'),
        verses: sections.map((s) => s.lines.join('\n')),
        sections,
        defaultArrangement: buildDefaultArrangement(sections),
        isPublic: false,
        createdAt: timestamp,
        updatedAt: timestamp,
    }
}

/**
 * Full fallback: LLM-identify → LRCLIB-fetch → structure into a Song.
 * `id` and `timestamp` are injected so the result is deterministic/testable.
 */
export async function resolveExternalSong(
    snippet: string,
    config: LlmConfig,
    id: string,
    timestamp: string,
    signal?: AbortSignal,
): Promise<Song | null> {
    const guess = await identifySongViaLLM(snippet, config, signal)
    if (!guess) return null
    const fetched = await fetchLyricsFromLRCLIB(guess.title, guess.artist, signal)
    if (!fetched) return null
    return buildSongFromLyrics(fetched.title, fetched.artist, fetched.lyrics, id, timestamp)
}
