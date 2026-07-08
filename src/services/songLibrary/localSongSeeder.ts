import { getIndexedDB } from '../../hooks/useIndexedDB'
import type { Song, SongSection, LibraryItem } from '../../types'

/**
 * One-time local seeding of the structured EasyWorship song corpus into
 * IndexedDB (`db.library`) so the app has real, section-structured songs to
 * work with locally — used to develop and exercise the predictive lyric
 * tracker before the Convex bulk load is done.
 *
 * The bundled asset (`public/songs/easyworship.json`) is produced offline by
 * `scripts/import-easyworship-songs.ts --compact`. It carries only sections +
 * metadata; the freeform `lyrics`/`verses` are reconstructed here so the seeded
 * songs behave like any other library song.
 *
 * Seeding is idempotent (stable `ew_<id>` keys) and version-guarded via
 * localStorage so it runs at most once per asset version per browser profile.
 */

const ASSET_URL = '/songs/easyworship.json'
const SEED_FLAG_KEY = 'selah:ew-songs-seeded-version'

interface CompactSong {
    id: string
    title: string
    artist: string
    author: string
    sections: SongSection[]
    defaultArrangement: string[]
}

interface CompactAsset {
    version: number
    source: string
    songs: CompactSong[]
}

/** Rebuild the freeform lyrics string from structured sections. */
function lyricsFromSections(sections: SongSection[]): string {
    return sections.map((s) => s.lines.join('\n')).join('\n\n')
}

function toLibraryItem(song: CompactSong, now: string): LibraryItem {
    const verses = song.sections.map((s) => s.lines.join('\n'))
    const content: Song = {
        id: song.id,
        _id: song.id,
        title: song.title,
        artist: song.artist,
        author: song.author,
        lyrics: lyricsFromSections(song.sections),
        verses,
        sections: song.sections,
        defaultArrangement: song.defaultArrangement,
        isPublic: false,
        createdAt: now,
        updatedAt: now,
    }
    return {
        id: song.id,
        type: 'song',
        content,
        createdAt: now,
        updatedAt: now,
    }
}

export interface SeedResult {
    seeded: number
    skipped: boolean
    reason?: string
}

/**
 * Seed the local song library from the bundled asset.
 *
 * @param opts.force  Re-seed even if the version flag matches.
 * @param opts.signal Optional AbortSignal to cancel the fetch.
 */
export async function seedLocalSongs(opts?: {
    force?: boolean
    signal?: AbortSignal
}): Promise<SeedResult> {
    try {
        const res = await fetch(ASSET_URL, { signal: opts?.signal })
        if (!res.ok) {
            return { seeded: 0, skipped: true, reason: `asset ${res.status}` }
        }
        const asset = (await res.json()) as CompactAsset
        if (!asset?.songs?.length) {
            return { seeded: 0, skipped: true, reason: 'empty asset' }
        }

        const flag = `${asset.source}:${asset.version}`
        if (!opts?.force && localStorage.getItem(SEED_FLAG_KEY) === flag) {
            return { seeded: 0, skipped: true, reason: 'already seeded' }
        }

        const db = getIndexedDB()
        const now = new Date().toISOString()
        const items = asset.songs.map((s) => toLibraryItem(s, now))

        // bulkPut is idempotent on the stable `ew_<id>` primary key, so a
        // re-run (e.g. after a version bump) overwrites rather than duplicates.
        await db.library.bulkPut(items)

        localStorage.setItem(SEED_FLAG_KEY, flag)
        return { seeded: items.length, skipped: false }
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            return { seeded: 0, skipped: true, reason: 'aborted' }
        }
        console.warn('[localSongSeeder] Failed to seed local songs:', err)
        return { seeded: 0, skipped: true, reason: 'error' }
    }
}
