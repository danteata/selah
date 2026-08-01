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

    it('goes Lost after repeated non-matching input', () => {
        // Transcript only arrives while singing, so a non-matching stretch is a
        // *different song*, not an instrumental break — it must reach 'lost' so
        // auto-detect can look for the new song.
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        let u = t.getState()
        for (let i = 0; i < 3; i++) {
            u = t.ingest({ text: 'completely different lyrics playing loudly' })
        }
        expect(u.phase).toBe('lost')
    })

    it('clears the display target on Lost so callers stop re-asserting the stale section', () => {
        // Regression: previously `displaySectionId` stayed pointed at the last
        // matched section forever, so a caller driving the live slide off of it
        // (e.g. useSongTracker) would keep yanking the display back to the old
        // song even after another detector (Bible-verse auto-detect) took over.
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        expect(t.getState().displaySectionId).toBe('v1')
        let u = t.getState()
        for (let i = 0; i < 3; i++) {
            u = t.ingest({ text: 'completely unrelated sermon words here' })
        }
        expect(u.phase).toBe('lost')
        expect(u.displaySectionId).toBeNull()
        expect(u.displayStepIndex).toBeNull()
    })

    it('re-acquires from Lost when lyrics return', () => {
        const t = newTracker()
        t.ingest({ text: 'Amazing grace how sweet the sound' })
        for (let i = 0; i < 3; i++) t.ingest({ text: 'noise noise noise noise' })
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

    it('reports the display as a step, so repeats are distinguishable', () => {
        // Arrangement is v1 c1 v2 c1 — the two choruses share a section id and
        // are only told apart by their step.
        const t = newTracker()
        const first = t.seekToSection('c1')
        expect(first.displaySectionId).toBe('c1')
        expect(first.displayStepIndex).toBe(1)

        t.seekToStep(2) // v2
        const second = t.ingest({ text: 'My chains are gone I have been set free' })
        expect(second.singer).toMatchObject({ stepIndex: 3, sectionId: 'c1' })
        expect(second.displaySectionId).toBe('c1')
        expect(second.displayStepIndex).toBe(3)
    })

    it('seeks to the occurrence of a repeated section nearest the cursor', () => {
        // The operator UI can only name a *slide*, and every repeat of a section
        // shares one slide. Clicking the chorus during the second chorus used to
        // rewind the tracker to the first one, after which it led into verse 2
        // instead of whatever actually follows.
        const t = newTracker()
        expect(t.seekToSection('c1').singer).toMatchObject({ stepIndex: 1 })

        t.seekToStep(3)
        expect(t.seekToSection('c1').singer).toMatchObject({ stepIndex: 3 })

        t.seekToStep(2)
        // Equidistant from steps 1 and 3 — either is defensible; assert it picks
        // one deterministically rather than always snapping to the first.
        expect(t.seekToSection('c1').singer?.stepIndex).toBe(1)
    })

    describe('predictive advance', () => {
        it('estimates how long a line takes from segment timestamps', () => {
            const t = newTracker()
            expect(t.ingest({ text: 'Amazing grace how sweet the sound', timeMs: 0 }).estimatedLineMs).toBeNull()
            t.ingest({ text: 'That saved a wretch like me', timeMs: 3000 })
            t.ingest({ text: 'I once was lost but now am found', timeMs: 6000 })
            const u = t.ingest({ text: 'Was blind but now I see', timeMs: 9000 })
            expect(u.estimatedLineMs).toBe(3000)
        })

        it('ignores implausible gaps rather than inflating the estimate', () => {
            const t = newTracker()
            t.ingest({ text: 'Amazing grace how sweet the sound', timeMs: 0 })
            t.ingest({ text: 'That saved a wretch like me', timeMs: 2000 })
            // A four-minute gap (the band vamped, or the tracker was elsewhere)
            // is not a line taking four minutes.
            t.ingest({ text: 'I once was lost but now am found', timeMs: 242_000 })
            t.ingest({ text: 'Was blind but now I see', timeMs: 244_000 })
            // Only the two 2s observations survived — still one short of the
            // minimum, so no estimate is offered yet.
            expect(t.getState().estimatedLineMs).toBeNull()
        })

        it('reports the lines left in the current section', () => {
            const t = newTracker()
            expect(t.ingest({ text: 'Amazing grace how sweet the sound' }).linesRemaining).toBe(3)
            expect(t.ingest({ text: 'That saved a wretch like me' }).linesRemaining).toBe(2)
            expect(t.ingest({ text: 'Was blind but now I see' }).linesRemaining).toBe(0)
        })

        it('leadDisplay moves the display one step ahead of the singer', () => {
            const t = newTracker()
            t.ingest({ text: 'Amazing grace how sweet the sound' })
            expect(t.getState().displayStepIndex).toBe(0)

            const led = t.leadDisplay()
            expect(led.advanced).toBe(true)
            expect(led.displayStepIndex).toBe(1)
            expect(led.singer).toMatchObject({ stepIndex: 0 }) // singer unmoved
        })

        it('refuses to lead more than one step past the singer', () => {
            const t = newTracker()
            t.ingest({ text: 'Amazing grace how sweet the sound' })
            t.leadDisplay()
            const again = t.leadDisplay()
            expect(again.advanced).toBe(false)
            expect(again.reason).toBe('lead-already-ahead')
            expect(again.displayStepIndex).toBe(1)
        })

        it('will not lead unless tracking', () => {
            const t = newTracker()
            expect(t.leadDisplay().reason).toBe('lead-not-tracking')
        })

        it('does not pull the display back after leading', () => {
            // The regression this guards: the timer leads to the chorus, then a
            // transcript for a line the singer is still on arrives and the
            // display recomputes to their section — yanking the projector
            // backwards a beat after it correctly moved on.
            const t = newTracker()
            t.ingest({ text: 'Amazing grace how sweet the sound' })
            t.leadDisplay()
            expect(t.getState().displayStepIndex).toBe(1)

            const u = t.ingest({ text: 'That saved a wretch like me' })
            expect(u.singer).toMatchObject({ stepIndex: 0, lineIndex: 1 })
            expect(u.displayStepIndex).toBe(1) // held, not rewound
            expect(u.advanced).toBe(false)
        })

        it('still follows the singer backwards on a confirmed jump', () => {
            const t = newTracker()
            t.seekToStep(2) // v2
            t.leadDisplay() // display -> step 3
            expect(t.getState().displayStepIndex).toBe(3)

            // Two confirmations of a v1 line clear hysteresis.
            t.ingest({ text: 'Amazing grace how sweet the sound' })
            const u = t.ingest({ text: 'Amazing grace how sweet the sound' })
            expect(u.singer).toMatchObject({ stepIndex: 0 })
            expect(u.displayStepIndex).toBe(0)
        })
    })

    describe('interim (partial) transcripts', () => {
        it('advances the cursor without waiting for the finalized segment', () => {
            const t = newTracker()
            t.ingest({ text: 'Amazing grace how sweet the sound' })
            const u = t.ingest({ text: 'That saved a wretch like me', interim: true })
            expect(u.singer).toMatchObject({ stepIndex: 0, lineIndex: 1 })
        })

        it('leads the display from interim text at the trailing edge', () => {
            const t = newTracker()
            t.ingest({ text: 'Amazing grace how sweet the sound' })
            t.ingest({ text: 'I once was lost but now am found' })
            const u = t.ingest({ text: 'Was blind but now I see', interim: true })
            expect(u.displaySectionId).toBe('c1')
            expect(u.advanced).toBe(true)
        })

        it('cannot acquire a song — only follow one already locked', () => {
            const t = newTracker()
            const u = t.ingest({ text: 'Amazing grace how sweet the sound', interim: true })
            expect(u.reason).toBe('interim-not-tracking')
            expect(u.phase).toBe('searching')
            expect(u.singer).toBeNull()
        })

        it('does not count toward Lost', () => {
            // Partial text is revised constantly and its early guesses match
            // nothing; letting it drive Lost would hand the song back to
            // auto-detect several times a verse.
            const t = newTracker()
            t.ingest({ text: 'Amazing grace how sweet the sound' })
            let u = t.getState()
            for (let i = 0; i < 6; i++) {
                u = t.ingest({ text: 'completely unrelated words here', interim: true })
            }
            expect(u.reason).toBe('interim-miss')
            expect(u.phase).toBe('tracking')
        })

        it('does not confirm a far jump', () => {
            // Each revision of one utterance would otherwise arrive as separate
            // "corroboration" of the same wrong target, satisfying on its own
            // the hysteresis that exists to demand independent evidence.
            const t = newTracker()
            t.seekToStep(2) // v2
            for (let i = 0; i < 4; i++) {
                const u = t.ingest({ text: 'Amazing grace how sweet the sound', interim: true })
                expect(u.reason).toBe('interim-jump-ignored')
            }
            expect(t.getState().singer).toMatchObject({ stepIndex: 2 })
        })

        it('does not contribute to the line-duration estimate', () => {
            // Interim timestamps say when we heard about a phrase mid-revision,
            // not when it was sung.
            const t = newTracker()
            t.ingest({ text: 'Amazing grace how sweet the sound', timeMs: 0 })
            t.ingest({ text: 'That saved a wretch like me', timeMs: 1000, interim: true })
            t.ingest({ text: 'I once was lost but now am found', timeMs: 2000, interim: true })
            t.ingest({ text: 'Was blind but now I see', timeMs: 3000, interim: true })
            expect(t.getState().estimatedLineMs).toBeNull()
        })
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
