import { describe, it, expect } from 'vitest'
import { buildSongIndex, identifySong } from '../songIdentification'
import type { Song } from '../../../types'

const AMAZING_GRACE: Song = {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    artist: 'Traditional',
    lyrics: '',
    sections: [
        { id: 'v1', type: 'verse', number: 1, label: 'Verse 1', lines: [
            'Amazing grace how sweet the sound',
            'That saved a wretch like me',
            'I once was lost but now am found',
            'Was blind but now I see',
        ] },
        { id: 'c1', type: 'chorus', label: 'Chorus', lines: [
            'My chains are gone I have been set free',
            'And like a flood His mercy reigns',
        ] },
    ],
}

const HERE_I_AM: Song = {
    id: 'here-i-am',
    title: 'Here I Am to Worship',
    artist: 'Tim Hughes',
    lyrics: '',
    sections: [
        { id: 'v1', type: 'verse', number: 1, label: 'Verse 1', lines: [
            'Light of the world you stepped down into darkness',
            'Opened my eyes let me see',
        ] },
        { id: 'c1', type: 'chorus', label: 'Chorus', lines: [
            'Here I am to worship here I am to bow down',
            'Here I am to say that you are my God',
        ] },
    ],
}

const LIBRARY = [AMAZING_GRACE, HERE_I_AM]

describe('buildSongIndex', () => {
    it('indexes lines with enough words and skips short ones', () => {
        const index = buildSongIndex(LIBRARY)
        expect(index.songCount).toBe(2)
        // Every indexed line has >= 4 words.
        for (const e of index.entries) {
            expect(e.text.split(/\s+/).length).toBeGreaterThanOrEqual(4)
        }
        // Significant tokens map back to entries.
        expect(index.token.get('grace')).toBeTruthy()
        expect(index.token.get('worship')).toBeTruthy()
    })
})

describe('identifySong', () => {
    const index = buildSongIndex(LIBRARY)

    it('identifies the right song from an exact sung line', () => {
        const m = identifySong('amazing grace how sweet the sound', index)
        expect(m?.songId).toBe('amazing-grace')
        expect(m?.sectionId).toBe('v1')
        expect(m?.confidence).toBeGreaterThan(0.9)
    })

    it('identifies from a different song', () => {
        const m = identifySong('here I am to worship here I am to bow down', index)
        expect(m?.songId).toBe('here-i-am')
        expect(m?.sectionId).toBe('c1')
    })

    it('identifies from two corroborating lines even with noise', () => {
        // Two lines of the same song, lightly garbled — the corroboration path.
        const m = identifySong('amazing grace how sweet the sound that saved a wretch like me uh', index)
        expect(m?.songId).toBe('amazing-grace')
        expect(m?.matchedLines).toBeGreaterThanOrEqual(2)
    })

    it('does NOT pull a song from a single moderately-garbled line', () => {
        // One noisy line with no corroboration should not confidently match —
        // better to show nothing than the wrong song.
        const m = identifySong('amazing grace how somewhat the loud noise today', index)
        expect(m).toBeNull()
    })

    it('returns null for sermon-like speech that matches nothing', () => {
        expect(
            identifySong('and so today we are going to talk about the book of romans', index),
        ).toBeNull()
    })

    it('returns null for very short input', () => {
        expect(identifySong('amazing grace', index)).toBeNull()
    })

    it('does not false-match on a single common word', () => {
        // "world" appears in Here I Am, but this phrase isn't that line.
        const m = identifySong('the whole world was watching the game last night', index)
        expect(m).toBeNull()
    })

    it('picks the higher-confidence song when a query overlaps two', () => {
        // Strongly matches Amazing Grace v1 line 3, weak incidental overlap only.
        const m = identifySong('I once was lost but now am found today', index)
        expect(m?.songId).toBe('amazing-grace')
        expect(m?.sectionId).toBe('v1')
    })

    it('rejects a song that only overlaps on filler/function words', () => {
        // A decoy whose lines share "I have made you … in my" with the query but
        // nothing distinctive — the real "Be Magnified" failure mode.
        const decoy: Song = {
            id: 'decoy',
            title: 'Decoy Song',
            artist: 'x',
            lyrics: '',
            sections: [{ id: 'v1', type: 'verse', label: 'Verse 1', lines: [
                'I have made you a promise in my life',
                'You are the one that I have found in my time',
            ] }],
        }
        const idx = buildSongIndex([...LIBRARY, decoy])
        const m = identifySong('I have made you too small in my eyes forgive me', idx)
        // Should NOT confidently pull the decoy (only filler overlaps).
        expect(m?.songId).not.toBe('decoy')
    })

    it('respects a stricter minMatchedLines requirement', () => {
        // One line matches, so requiring 2 yields nothing.
        const m = identifySong('amazing grace how sweet the sound', index, { minMatchedLines: 2 })
        expect(m).toBeNull()
    })
})
