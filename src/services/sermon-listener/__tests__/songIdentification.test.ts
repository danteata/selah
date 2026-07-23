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

    it('rejects a song whose only overlap is generic worship vocabulary', () => {
        // A decoy whose two candidate lines share only common theological
        // words ("Lord", "God", "praise", "glory", "king") with the query —
        // no actual phrase in common. Sermon speech uses this vocabulary
        // constantly, so without a distinctiveness gate two such lines would
        // corroborate against nearly any worship song in the library.
        const decoy: Song = {
            id: 'decoy',
            title: 'Decoy Song',
            artist: 'x',
            lyrics: '',
            sections: [{ id: 'v1', type: 'verse', label: 'Verse 1', lines: [
                'Praise the Lord our God and King',
                'Glory be to God our King',
            ] }],
        }
        const idx = buildSongIndex([...LIBRARY, decoy])
        const m = identifySong('let us praise the lord our god and give glory to god our king', idx)
        expect(m?.songId).not.toBe('decoy')
    })

    it('rejects a coincidental match with only one distinctive word per line', () => {
        // Two lines that each share exactly one distinctive word ("mountain",
        // "valley") plus generic theological filler ("God", "Lord") with the
        // query — a wholly unrelated remark about God's presence "over every
        // mountain and valley". Before requiring >=2 distinctive shared words,
        // this coincidence alone was enough to corroborate a false match: each
        // line's full-line similarity (~0.68) even cleared the old 0.6/0.55
        // corroboration thresholds.
        const decoy: Song = {
            id: 'decoy-mountain',
            title: 'Decoy Mountain Song',
            artist: 'x',
            lyrics: '',
            sections: [{ id: 'v1', type: 'verse', label: 'Verse 1', lines: [
                'Our God is Lord of the mountain',
                'Our God is Lord of the valley',
            ] }],
        }
        const idx = buildSongIndex([...LIBRARY, decoy])
        const m = identifySong(
            'so today we remember that god is lord over every mountain and valley in our lives',
            idx,
        )
        expect(m?.songId).not.toBe('decoy-mountain')
    })

    it('rejects a short ubiquitous worship phrase embedded in unrelated speech', () => {
        // Real-world regression: a live sermon transcript ("...lift up your
        // voice and let's pray...") got falsely matched to the hymn "Sing unto
        // the Lord" because its line "LIFT YOUR VOICE AND" is fully contained
        // in the query (100% line coverage -> lineSimilarity 0.95, clearing the
        // single-line strong threshold on its own), even though "lift"/"voice"
        // explain only 2 of the query's 8 distinctive words — the rest ("pray",
        // "helen", "brok", "uh") is unrelated spoken prayer, not singing.
        const song: Song = {
            id: 'ew_1099',
            title: 'Sing unto the Lord',
            artist: 'Unknown',
            lyrics: '',
            sections: [
                { id: 'chorus', type: 'chorus', label: 'Chorus', lines: ['SING UNTO THE LORD', 'SING ALL THE EARTH'] },
                { id: 'v1', type: 'verse', number: 1, label: 'Verse 1', lines: ['LET YOUR PRAISES RING', 'LIFT YOUR VOICE AND'] },
                { id: 'v3', type: 'verse', number: 3, label: 'Verse 3', lines: ['MAKE A JOYFUL SOUND', 'LIFT YOUR VOICE AND SHOUT'] },
            ],
        }
        const idx = buildSongIndex([song])
        const m = identifySong(
            "s pray and helen brok lift up your voice and let s pray uh",
            idx,
        )
        expect(m).toBeNull()
    })

    it('identifies an exact line built almost entirely from generic theological vocabulary', () => {
        // "Holy holy holy Lord God Almighty" only has ONE non-generic word
        // ("almighty"), so it can never reach the corroboration-level
        // MIN_DISTINCTIVE_SHARED bar on its own. But it's sung essentially
        // verbatim (near-exact single-line match), which is strong evidence
        // regardless of how common the vocabulary is — many real hymns are
        // built almost entirely from "Holy"/"Lord"/"God" vocabulary.
        const song: Song = {
            id: 'holy-holy-holy',
            title: 'Holy, Holy, Holy',
            artist: 'Traditional',
            lyrics: '',
            sections: [{ id: 'v1', type: 'verse', label: 'Verse 1', lines: [
                'Holy holy holy Lord God Almighty',
                'Early in the morning our song shall rise to thee',
            ] }],
        }
        const idx = buildSongIndex([song])
        const m = identifySong('Holy holy holy Lord God Almighty', idx)
        expect(m?.songId).toBe('holy-holy-holy')
    })

    it('still rejects a near-exact decoy line with ZERO distinctive words (coincidental generic overlap)', () => {
        // Contrast with the case above: this decoy's line has no distinctive
        // word at all (every shared word is generic theological vocabulary),
        // so even though ordinary sermon speech can coincidentally recite the
        // exact same handful of common words and score near-exact via
        // coverage, it must still be rejected — there's no actual phrase in
        // common, just shared generic vocabulary.
        const decoy: Song = {
            id: 'decoy-generic-exact',
            title: 'Decoy',
            artist: 'x',
            lyrics: '',
            sections: [{ id: 'v1', type: 'verse', label: 'Verse 1', lines: [
                'Praise the Lord our God and King',
            ] }],
        }
        const idx = buildSongIndex([decoy])
        const m = identifySong('let us praise the lord our god and king today', idx)
        expect(m?.songId).not.toBe('decoy-generic-exact')
    })

    it('respects a stricter minMatchedLines requirement', () => {
        // One line matches, so requiring 2 yields nothing.
        const m = identifySong('amazing grace how sweet the sound', index, { minMatchedLines: 2 })
        expect(m).toBeNull()
    })
})
