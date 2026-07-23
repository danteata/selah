import { describe, it, expect } from 'vitest'
import { groupQueueItems } from '../groupQueueItems'
import type { Slide, Song } from '../../../types'

function makeSlide(overrides: Partial<Slide> & { id: string }): Slide {
    return {
        index: 0,
        name: overrides.id,
        type: 'text',
        layout: 'full-text',
        userId: 'user-1',
        churchId: 'church-1',
        scheduleId: '',
        contents: ['content'],
        ...overrides,
    }
}

function makeSong(overrides: Partial<Song> & { id: string; title: string }): Song {
    return {
        artist: '',
        lyrics: '',
        ...overrides,
    } as Song
}

function makeSongVerse(songId: string, verseIndex: number, totalVerses: number, song: Song): Slide {
    return makeSlide({
        id: `${songId}-v${verseIndex}`,
        type: 'song',
        songId,
        verseIndex,
        totalVerses,
        verseLabel: `Verse ${verseIndex + 1}`,
        name: `${song.title} - Verse ${verseIndex + 1}`,
        data: song,
    })
}

describe('groupQueueItems', () => {
    it('renders a non-song slide as a single item', () => {
        const slide = makeSlide({ id: 'text-1' })
        const items = groupQueueItems([slide])
        expect(items).toEqual([{ type: 'single', slide, index: 0 }])
    })

    it('renders a song with only one verse as a single item, not a group', () => {
        const song = makeSong({ id: 'song-1', title: 'One Verse Song' })
        const slide = makeSongVerse('song-1', 0, 1, song)
        const items = groupQueueItems([slide])
        expect(items).toEqual([{ type: 'single', slide, index: 0 }])
    })

    it('groups consecutive verses of the same song into one item', () => {
        const song = makeSong({ id: 'song-1', title: 'Amazing Grace', artist: 'Traditional' })
        const v0 = makeSongVerse('song-1', 0, 3, song)
        const v1 = makeSongVerse('song-1', 1, 3, song)
        const v2 = makeSongVerse('song-1', 2, 3, song)
        const items = groupQueueItems([v0, v1, v2])

        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({
            type: 'song',
            songId: 'song-1',
            songTitle: 'Amazing Grace',
            artist: 'Traditional',
        })
        if (items[0].type === 'song') {
            expect(items[0].verses.map((v) => v.slide.id)).toEqual(['song-1-v0', 'song-1-v1', 'song-1-v2'])
            expect(items[0].verses.map((v) => v.index)).toEqual([0, 1, 2])
        }
    })

    it('does not group non-consecutive slides sharing a songId', () => {
        // A manual reorder split the song's verses apart with an unrelated
        // slide in between — each run should render as its own item rather
        // than incorrectly merging across the gap.
        const song = makeSong({ id: 'song-1', title: 'Amazing Grace' })
        const v0 = makeSongVerse('song-1', 0, 2, song)
        const other = makeSlide({ id: 'other' })
        const v1 = makeSongVerse('song-1', 1, 2, song)
        const items = groupQueueItems([v0, other, v1])

        expect(items).toHaveLength(3)
        expect(items[0]).toEqual({ type: 'single', slide: v0, index: 0 })
        expect(items[1]).toEqual({ type: 'single', slide: other, index: 1 })
        expect(items[2]).toEqual({ type: 'single', slide: v1, index: 2 })
    })

    it('preserves real flat-array indices across mixed content', () => {
        const song = makeSong({ id: 'song-1', title: 'Amazing Grace' })
        const bible = makeSlide({ id: 'bible-1', type: 'bible' })
        const v0 = makeSongVerse('song-1', 0, 2, song)
        const v1 = makeSongVerse('song-1', 1, 2, song)
        const media = makeSlide({ id: 'media-1', type: 'media' })
        const items = groupQueueItems([bible, v0, v1, media])

        expect(items[0]).toEqual({ type: 'single', slide: bible, index: 0 })
        expect(items[1].type).toBe('song')
        if (items[1].type === 'song') {
            expect(items[1].verses.map((v) => v.index)).toEqual([1, 2])
        }
        expect(items[2]).toEqual({ type: 'single', slide: media, index: 3 })
    })

    it('groups two different consecutive songs into two separate groups', () => {
        const songA = makeSong({ id: 'song-a', title: 'Song A' })
        const songB = makeSong({ id: 'song-b', title: 'Song B' })
        const a0 = makeSongVerse('song-a', 0, 2, songA)
        const a1 = makeSongVerse('song-a', 1, 2, songA)
        const b0 = makeSongVerse('song-b', 0, 2, songB)
        const b1 = makeSongVerse('song-b', 1, 2, songB)
        const items = groupQueueItems([a0, a1, b0, b1])

        expect(items).toHaveLength(2)
        expect(items[0]).toMatchObject({ type: 'song', songId: 'song-a', songTitle: 'Song A' })
        expect(items[1]).toMatchObject({ type: 'song', songId: 'song-b', songTitle: 'Song B' })
    })

    it('falls back to parsing the slide name when song data is missing', () => {
        const slide = makeSlide({
            id: 'song-1-v0',
            type: 'song',
            songId: 'song-1',
            name: 'Fallback Title - Verse 1',
        })
        const slide2 = makeSlide({
            id: 'song-1-v1',
            type: 'song',
            songId: 'song-1',
            name: 'Fallback Title - Verse 2',
        })
        const items = groupQueueItems([slide, slide2])
        expect(items[0]).toMatchObject({ type: 'song', songTitle: 'Fallback Title' })
    })

    it('returns an empty array for an empty queue', () => {
        expect(groupQueueItems([])).toEqual([])
    })
})
