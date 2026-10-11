/**
 * The search indexes over the song library and the hymnal, built once per
 * version of each list and kept for the session.
 *
 * An index over a few thousand songs plus the hymnal takes over half a second
 * to build, and the songs panel built one each time it opened — several,
 * since each list arriving rebuilt it — so the panel sat for a couple of
 * seconds before you could search. Keyed by the list arrays themselves: the
 * stores hand back the same array until the list changes (deviceSongs.ts,
 * useHymn.ts), and a list that's gone takes its index with it.
 */

import type { Hymn, Song } from '../../types'
import { buildMusicIndex, type MusicIndex, type MusicSearchItem } from './musicSearch'

interface CacheNode {
    next: WeakMap<object, CacheNode>
    value?: unknown
}

const root: CacheNode = { next: new WeakMap() }

/** `build()`, once for as long as `keys` are the same objects. */
function cached<V>(keys: object[], build: () => V): V {
    let node = root
    for (const key of keys) {
        let child = node.next.get(key)
        if (!child) {
            child = { next: new WeakMap() }
            node.next.set(key, child)
        }
        node = child
    }
    if (!('value' in node)) node.value = build()
    return node.value as V
}

function songItem(s: Song): MusicSearchItem {
    return { id: s._id || s.id, title: s.title, subtitle: s.artist, body: s.lyrics || '' }
}

function hymnBody(h: Hymn): string {
    return `${h.chorus ?? ''}\n${(h.verses ?? []).join('\n')}`
}

/** Index over songs alone; item ids are the songs' ids. */
export function songIndexFor(songs: Song[]): MusicIndex<MusicSearchItem> {
    return cached([songs], () => buildMusicIndex(songs.map(songItem)))
}

/**
 * Index over hymns alone; item ids are hymn numbers. The number goes in the
 * subtitle so a numeric lookup ("123") still works; digits survive
 * normalizeText.
 */
export function hymnIndexFor(hymns: Hymn[]): MusicIndex<MusicSearchItem> {
    return cached([hymns], () => buildMusicIndex(hymns.map((h) => ({
        id: h.number,
        title: h.title,
        subtitle: `${h.author ?? ''} ${h.number}`.trim(),
        body: hymnBody(h),
    }))))
}

export interface UnifiedHit {
    id: string
    kind: 'song' | 'hymn'
    title: string
    subtitle: string
    song?: Song
    hymn?: Hymn
}

export interface UnifiedMusicIndex {
    index: MusicIndex<MusicSearchItem>
    byId: Map<string, UnifiedHit>
}

/** One index over songs and hymns together, for the songs panel's search box. */
export function unifiedMusicIndexFor(songs: Song[], hymns: Hymn[]): UnifiedMusicIndex {
    return cached([songs, hymns], () => {
        const byId = new Map<string, UnifiedHit>()
        const items = [
            ...songs.map((s) => {
                const id = `song:${s._id || s.id}`
                byId.set(id, { id, kind: 'song', title: s.title, subtitle: s.artist, song: s })
                return { ...songItem(s), id }
            }),
            ...hymns.map((h) => {
                const id = `hymn:${h.number}`
                byId.set(id, { id, kind: 'hymn', title: h.title, subtitle: `Hymn ${h.number}`, hymn: h })
                return { id, title: h.title, subtitle: `${h.author ?? ''} ${h.number}`.trim(), body: hymnBody(h) }
            }),
        ]
        return { index: buildMusicIndex(items), byId }
    })
}
