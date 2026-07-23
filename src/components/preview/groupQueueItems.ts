import type { Slide, Song } from '../../types'

export interface SongVerseBrowserEntry {
    slide: Slide
    /** Index into the flat slide-queue array this slide came from. */
    index: number
}

export interface SingleQueueItem {
    type: 'single'
    slide: Slide
    index: number
}

export interface SongGroupItem {
    type: 'song'
    key: string
    songId: string
    songTitle: string
    artist?: string
    verses: SongVerseBrowserEntry[]
}

export type QueueItem = SingleQueueItem | SongGroupItem

/**
 * Collapse a song's per-verse slides (createSongSlides materializes one Slide
 * per verse up front, so the live song tracker/auto-detect has somewhere to
 * point setLiveSlide at) into a single row for the slide-queue panel — a song
 * with a dozen verses otherwise buries every other slide in the queue under a
 * wall of "Verse 1", "Verse 2", ... entries.
 *
 * Only groups CONSECUTIVE runs sharing the same `songId` (how they're always
 * created) — a lone verse, or one a manual reorder separated from its
 * siblings, renders as an ordinary single row rather than a group. `index` on
 * every item is the slide's real position in `slides`, so callers doing
 * index-based drag-reorder against the original flat array keep working
 * whether or not a slide is currently inside a collapsed group.
 */
export function groupQueueItems(slides: Slide[]): QueueItem[] {
    const items: QueueItem[] = []
    let i = 0
    while (i < slides.length) {
        const slide = slides[i]
        if (slide.songId) {
            const songId = slide.songId
            const verses: SongVerseBrowserEntry[] = [{ slide, index: i }]
            let j = i + 1
            while (j < slides.length && slides[j].songId === songId) {
                verses.push({ slide: slides[j], index: j })
                j++
            }
            if (verses.length > 1) {
                const songData = slide.data as Song | undefined
                items.push({
                    type: 'song',
                    key: `song-${slide.id}`,
                    songId,
                    songTitle: songData?.title || slide.name?.split(' - ')[0] || 'Song',
                    artist: songData?.artist,
                    verses,
                })
            } else {
                items.push({ type: 'single', slide, index: i })
            }
            i = j
        } else {
            items.push({ type: 'single', slide, index: i })
            i += 1
        }
    }
    return items
}
