import { describe, expect, it } from 'vitest'
import {
    SongPositionTracker,
    lineSimilarity,
    normalizeLine,
    tokenize,
} from '../songTracker'
import type { Song } from '../../../types'

// A song with a repeated chorus in its arrangement, so we exercise multiple
// steps that reference the same section.
const SONG: Song = {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    artist: 'Traditional',
    lyrics: '',
    sections: [
        {
            id: 'v1',
            type: 'verse',
            number: 1,
            label: 'Verse 1',
            lines: [
                'Amazing grace how sweet the sound',
                'That saved a wretch like me',
                'I once was lost but now am found',
                'Was blind but now I see',
            ],
        },
        {
            id: 'c1',
            type: 'chorus',
            label: 'Chorus',
            lines: [
                'My chains are gone I have been set free',
                'My God my Savior has ransomed me',
                'And like a flood His mercy reigns',
                'Unending love amazing grace',
            ],
        },
        {
            id: 'v2',
            type: 'verse',
            number: 2,
            label: 'Verse 2',
            lines: [
                'Twas grace that taught my heart to fear',
                'And grace my fears relieved',
            ],
        },
    ],
    defaultArrangement: ['v1', 'c1', 'v2', 'c1'],
}

function newTracker(overrides = {}) {
    const t = new SongPositionTracker(SONG, undefined, overrides)
    t.start()
    return t
}

describe('lineSimilarity', () => {
    it('scores exact matches ~1', () => {
        expect(lineSimilarity('my chains are gone', 'my chains are gone')).toBeGreaterThan(0.95)
    })
    it('scores a line embedded in a longer transcript high (coverage)', () => {
        expect(
            lineSimilarity('and then we sang my chains are gone loudly', 'my chains are gone'),
        ).toBeGreaterThan(0.6)
    })
    it('scores unrelated text low', () => {
        expect(lineSimilarity('the quick brown fox', 'my chains are gone')).toBeLessThan(0.2)
    })
    it('is punctuation/case insensitive', () => {
        expect(normalizeLine('My Chains, Are Gone!')).toBe('my chains are gone')
        expect(tokenize('a, b. c')).toEqual(['a', 'b', 'c'])
    })
})

describe('SongPositionTracker', () => {
    it('starts in searching with no singer position', () => {
        const t = newTracker()
        expect(t.getPhase()).toBe('searching')
        expect(t.getState().singer).toBeNull()
    })

    it('locks onto the song from the first line', () => {
        const t = newTracker()
        const u = t.ingest({ text: 'Amazing grace how sweet the sound' })
        expect(u.phase).toBe('tracking')
        expect(u.singer).toMatchObject({ stepIndex: 0, lineIndex: 0, sectionId: 'v1' })
        expect(u.displaySectionId).toBe('v1')
    })

    it('tracks forward line by line within a section', () => {
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        const u = t.ingest({ text: 'That saved a wretch like me' })
        expect(u.singer).toMatchObject({ stepIndex: 0, lineIndex: 1 })
        expect(u.displaySectionId).toBe('v1')
        expect(u.advanced).toBe(false)
    })

    it('leads the display to the next section on the last line (trailing edge)', () => {
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        t.ingest({ text: 'That saved a wretch like me' })
        t.ingest({ text: 'I once was lost but now am found' })
        const u = t.ingest({ text: 'Was blind but now I see' }) // last line of v1
        expect(u.singer).toMatchObject({ stepIndex: 0, lineIndex: 3 })
        // Display should already be showing the chorus before they start it.
        expect(u.displaySectionId).toBe('c1')
        expect(u.advanced).toBe(true)
    })

    it('does not flicker when the singer actually reaches the led-to section', () => {
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        t.ingest({ text: 'That saved a wretch like me' })
        t.ingest({ text: 'I once was lost but now am found' })
        t.ingest({ text: 'Was blind but now I see' }) // display -> c1
        const u = t.ingest({ text: 'My chains are gone I have been set free' }) // singer enters c1
        expect(u.singer).toMatchObject({ stepIndex: 1, lineIndex: 0, sectionId: 'c1' })
        expect(u.displaySectionId).toBe('c1')
        expect(u.advanced).toBe(false) // already shown, no change
    })

    it('decays confidence on a miss (so the UI reflects a fading match)', () => {
        const t = newTracker()
        const locked = t.ingest({ text: 'Amazing grace how sweet the sound' })
        const u = t.ingest({ text: 'completely unrelated words here' })
        expect(u.reason).toBe('miss')
        expect(u.confidence).toBeLessThan(locked.confidence)
    })

    it('goes Lost after repeated non-matching input even with audio present', () => {
        // Transcript only arrives while singing, so a loud non-matching stretch
        // is a *different song*, not an instrumental break — it must reach 'lost'
        // so auto-detect can look for the new song.
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        let u = t.getState()
        for (let i = 0; i < 3; i++) {
            u = t.ingest({ text: 'completely different lyrics playing loudly', audioEnergy: 0.5 })
        }
        expect(u.phase).toBe('lost')
    })

    it('goes Lost after repeated silent misses too', () => {
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        let u = t.getState()
        for (let i = 0; i < 3; i++) {
            u = t.ingest({ text: 'completely unrelated words here', audioEnergy: 0 })
        }
        expect(u.phase).toBe('lost')
    })

    it('re-acquires from Lost when lyrics return', () => {
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        for (let i = 0; i < 3; i++) t.ingest({ text: 'noise noise noise noise', audioEnergy: 0 })
        expect(t.getPhase()).toBe('lost')
        const u = t.ingest({ text: 'And grace my fears relieved' }) // a v2 line
        expect(u.phase).toBe('tracking')
        expect(u.singer?.sectionId).toBe('v2')
    })

    it('requires hysteresis before accepting a backward jump (repeat)', () => {
        const t = newTracker()
        // Advance the singer into v2 (step 2).
        t.seekToSection('v2')
        expect(t.getState().singer).toMatchObject({ stepIndex: 2, lineIndex: 0 })

        // A single strong match back at v1 should NOT immediately jump.
        const u1 = t.ingest({ text: 'Amazing grace how sweet the sound' })
        expect(u1.reason).toBe('jump-pending')
        expect(u1.singer).toMatchObject({ stepIndex: 2 })

        // Confirmed on the next chunk -> jump accepted.
        const u2 = t.ingest({ text: 'Amazing grace how sweet the sound' })
        expect(u2.singer).toMatchObject({ stepIndex: 0, lineIndex: 0 })
    })

    it('seekToSection seats the cursor and shows that section', () => {
        const t = newTracker()
        const u = t.seekToSection('c1')
        expect(u.singer).toMatchObject({ stepIndex: 1, sectionId: 'c1' })
        expect(u.displaySectionId).toBe('c1')
        expect(u.advanced).toBe(true)
    })

    it('expands the arrangement into steps (repeated chorus = distinct steps)', () => {
        const t = new SongPositionTracker(SONG)
        expect(t.steps.map((s) => s.sectionId)).toEqual(['v1', 'c1', 'v2', 'c1'])
    })

    it('falls back to natural section order without an arrangement', () => {
        const song: Song = { ...SONG, defaultArrangement: undefined }
        const t = new SongPositionTracker(song)
        expect(t.steps.map((s) => s.sectionId)).toEqual(['v1', 'c1', 'v2'])
    })

    it('supports an injected (e.g. semantic) scorer', () => {
        // A scorer that only recognizes the chorus opener.
        const scorer = (q: string, line: string) =>
            line.startsWith('My chains') && q.includes('chains') ? 0.9 : 0
        const t = new SongPositionTracker(SONG, undefined, { scorer })
        t.start()
        const u = t.ingest({ text: 'something about chains here' })
        expect(u.phase).toBe('tracking')
        expect(u.singer?.sectionId).toBe('c1')
    })
})
