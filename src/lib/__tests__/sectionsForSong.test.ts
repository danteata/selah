import { describe, it, expect } from 'vitest'
import { sectionsForSong } from '../songSections'
import { buildSongIndex, identifySong } from '../../services/sermon-listener/songIdentification'
import { SongPositionTracker } from '../../services/sermon-listener/songTracker'
import type { Song } from '../../types'

/**
 * A song as the library actually stores most of them: freeform lyrics and
 * pre-split verses, no structured `sections`. Adding one from search used to
 * make it invisible to both the identifier and the tracker.
 */
const LYRICS = [
    'I will look to the Hills, Mountains and Valleys',
    'From where comes my help',
    'From no one but you',
    '',
    'I have searched and searched Through humanity',
    'Is there one like you?',
    "There's no one like you",
].join('\n')

const SECTIONLESS: Song = {
    id: 'prayer-answering-god',
    _id: 'prayer-answering-god',
    title: 'Prayer Answering God',
    lyrics: LYRICS,
    verses: LYRICS.split('\n\n'),
} as unknown as Song

describe('sectionsForSong', () => {
    it('derives sections for a song that stores none', () => {
        expect(SECTIONLESS.sections).toBeUndefined()
        expect(sectionsForSong(SECTIONLESS).length).toBeGreaterThan(1)
    })

    it('prefers stored sections when present', () => {
        const stored = [{ id: 'v1', label: 'Verse 1', lines: ['a line of words'] }]
        const song = { ...SECTIONLESS, sections: stored } as unknown as Song
        expect(sectionsForSong(song)).toBe(stored)
    })

    it('returns nothing for a song with no words at all', () => {
        expect(sectionsForSong({ lyrics: '   ' })).toEqual([])
        expect(sectionsForSong({})).toEqual([])
    })

    it('falls back to verses when lyrics are absent', () => {
        const song = { verses: ['first block of words here', 'second block of words here'] }
        expect(sectionsForSong(song).length).toBe(2)
    })
})

describe('a section-less song is usable end to end', () => {
    it('can be identified from sung lyrics', () => {
        const index = buildSongIndex([SECTIONLESS])
        expect(index.entries.length).toBeGreaterThan(0)
        const match = identifySong('i will look to the hills mountains and valleys from where comes my help', index)
        expect(match?.songId).toBe('prayer-answering-god')
    })

    it('gives the position tracker steps to track', () => {
        const tracker = new SongPositionTracker(SECTIONLESS)
        expect(tracker.steps.length).toBeGreaterThan(1)
        tracker.start()
        const update = tracker.ingest({
            text: 'i have searched and searched through humanity is there one like you',
        })
        expect(update.phase).toBe('tracking')
        expect(update.displaySectionId).not.toBeNull()
    })
})

describe('deriving verses for slide building', () => {
    // The regression: auto-detect hands `createSongSlides` a raw library
    // record, which carries `lyrics` but no `verses` (the search path fills
    // `verses` in via useSong.getSong, auto-detect does not). Slides are built
    // purely from `verses`, so the whole song collapsed onto one slide holding
    // the entire lyric — POS 1/1, nothing for the tracker to advance through,
    // and no visible error to explain it.
    it('produces one verse per section for a lyrics-only song', () => {
        const verses = sectionsForSong(SECTIONLESS).map((s) => s.lines.join('\n'))
        expect(verses.length).toBeGreaterThan(1)
        expect(verses[0]).toContain('I will look to the Hills')
        expect(verses[1]).toContain('I have searched')
    })

    it('leaves a song that already has verses alone', () => {
        const song = { ...SECTIONLESS, verses: ['only this one'] } as unknown as Song
        const verses = song.verses?.length
            ? song.verses
            : sectionsForSong(song).map((s) => s.lines.join('\n'))
        expect(verses).toEqual(['only this one'])
    })
})
