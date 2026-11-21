import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Slide, Song } from '../../types'
import type { TranscriptSegment } from '../../types/sermon-listener'

// Controllable fake sermon-listener context (mutated between rerenders).
const h = vi.hoisted(() => ({
    listener: {
        isListening: true,
        transcriptSegments: [] as TranscriptSegment[],
        audioLevel: 0,
        interimTranscript: '',
    } as {
        isListening: boolean
        transcriptSegments: TranscriptSegment[]
        audioLevel: number
        interimTranscript: string
    },
}))

vi.mock('../../components/sermon-listener/SermonListenerContext', () => ({
    useSermonListenerContext: () => h.listener,
}))

// Real store — we assert against actual setLiveSlide / status behaviour.
import { useAppStore, DEFAULT_SONG_TRACKING } from '../../store/appStore'
import { useSongTracker } from '../useSongTracker'
import { songSlideBlocks } from '../../lib/songSections'

const SONG: Song = {
    id: 'song1',
    _id: 'song1',
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
        { id: 'v2', type: 'verse', number: 2, label: 'Verse 2', lines: [
            'Twas grace that taught my heart to fear',
            'And grace my fears relieved',
        ] },
    ],
    defaultArrangement: ['v1', 'c1', 'v2'],
}

// One slide per section, in section order (matches createSongSlides).
function songSlides(): Slide[] {
    return SONG.sections!.map((s, i) => ({
        id: `slide-${s.id}`,
        index: i,
        name: `Amazing Grace - ${s.label}`,
        type: 'song',
        layout: 'default',
        userId: 'u',
        churchId: 'c',
        scheduleId: 's',
        contents: [s.lines.join('\n')],
        songId: 'song1',
        verseIndex: i,
        data: SONG,
    }))
}

let seq = 0
/** Append a finalized segment. `gapMs` is how far this line sits after the
 *  previous one on the audio timeline — what the line-duration estimate reads. */
function feed(rerender: () => void, text: string, gapMs = 1000) {
    seq++
    const startMs = seq * gapMs
    h.listener = {
        ...h.listener,
        interimTranscript: '',
        transcriptSegments: [
            ...h.listener.transcriptSegments,
            { id: `seg${seq}`, text, startMs, endMs: startMs + 500, source: 'whisper' },
        ],
    }
    act(() => rerender())
}

/** Deliver live partial text for an utterance still in progress. */
function feedInterim(rerender: () => void, text: string) {
    h.listener = { ...h.listener, interimTranscript: text }
    act(() => rerender())
}

describe('useSongTracker (live wiring)', () => {
    beforeEach(() => {
        seq = 0
        vi.useRealTimers()
        h.listener = { isListening: true, transcriptSegments: [], audioLevel: 0, interimTranscript: '' }
        useAppStore.setState({
            activeSlides: songSlides(),
            liveSlideId: null,
            songTracking: { ...DEFAULT_SONG_TRACKING, enabled: true, status: { ...DEFAULT_SONG_TRACKING.status } },
        })
    })

    // Segments were found by count. A clear while stopped grew back past the
    // old count before the tracker looked, so the first lines were skipped.
    it('after a clear while stopped, the first lines sung are followed', () => {
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Some words before the song')
        feed(rerender, 'More words before the song')
        // Cleared while stopped…
        h.listener = { ...h.listener, isListening: false, transcriptSegments: [] }
        act(() => rerender())
        // …and the first result after Start brings two segments at once — as
        // many as were there before the clear.
        h.listener = {
            ...h.listener,
            isListening: true,
            transcriptSegments: [
                { id: 'new-1', text: 'Amazing grace how sweet the sound', startMs: 1000, endMs: 1500, source: 'whisper' },
                { id: 'new-2', text: 'That saved a wretch like me', startMs: 2000, endMs: 2500, source: 'whisper' },
            ],
        }
        act(() => rerender())

        expect(useAppStore.getState().liveSlideId).toBe('slide-v1')
        expect(useAppStore.getState().songTracking.status.phase).toBe('tracking')
    })

    // Restored segments used to be fed in as new singing on the next Start.
    it('segments restored after a reload are not taken for singing', () => {
        h.listener = { ...h.listener, isListening: false }
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Amazing grace how sweet the sound')
        feed(rerender, 'That saved a wretch like me')
        h.listener = { ...h.listener, isListening: true }
        act(() => rerender())

        expect(useAppStore.getState().liveSlideId).toBeNull()
    })

    it('locks on and sets the live slide to the sung section', () => {
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Amazing grace how sweet the sound')
        expect(useAppStore.getState().liveSlideId).toBe('slide-v1')
        expect(useAppStore.getState().songTracking.status.phase).toBe('tracking')
        expect(useAppStore.getState().songTracking.status.confidence).toBeGreaterThan(0)
    })

    it('advances ahead to the next section on the last line (trailing edge)', () => {
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Amazing grace how sweet the sound')
        feed(rerender, 'That saved a wretch like me')
        feed(rerender, 'I once was lost but now am found')
        feed(rerender, 'Was blind but now I see') // last line of v1
        // Chorus should already be live before they sing it.
        expect(useAppStore.getState().liveSlideId).toBe('slide-c1')
    })

    it('does NOT move the live slide when auto-advance is disabled', () => {
        useAppStore.setState({
            songTracking: { ...DEFAULT_SONG_TRACKING, enabled: false, status: { ...DEFAULT_SONG_TRACKING.status } },
        })
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Amazing grace how sweet the sound')
        // Slide unchanged...
        expect(useAppStore.getState().liveSlideId).toBeNull()
        // ...but status still reflects tracking (so the operator can watch it).
        expect(useAppStore.getState().songTracking.status.phase).toBe('tracking')
    })

    it('freezes advancement when locked', () => {
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Amazing grace how sweet the sound')
        expect(useAppStore.getState().liveSlideId).toBe('slide-v1')
        act(() => useAppStore.getState().setSongTrackingLocked(true))
        feed(rerender, 'That saved a wretch like me')
        feed(rerender, 'Was blind but now I see')
        // Held at v1 despite reaching the trailing edge.
        expect(useAppStore.getState().liveSlideId).toBe('slide-v1')
    })

    it('idles the status when no structured song is on the live output', () => {
        useAppStore.setState({ activeSlides: [], liveSlideId: null })
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Amazing grace how sweet the sound')
        expect(useAppStore.getState().liveSlideId).toBeNull()
        expect(useAppStore.getState().songTracking.status.phase).toBe('idle')
    })

    it('exposes the arrangement for the operator position chips', () => {
        renderHook(() => useSongTracker())
        const arr = useAppStore.getState().songTracking.status.arrangement
        expect(arr.map((s) => s.sectionId)).toEqual(['v1', 'c1', 'v2'])
        expect(arr.map((s) => s.slideId)).toEqual(['slide-v1', 'slide-c1', 'slide-v2'])
    })

    it('re-seats the tracker when the operator manually changes the live slide', () => {
        const { rerender } = renderHook(() => useSongTracker())
        // Auto-track into verse 1.
        feed(rerender, 'Amazing grace how sweet the sound')
        expect(useAppStore.getState().liveSlideId).toBe('slide-v1')

        // Operator manually jumps to verse 2 (as a click / clicker would).
        act(() => useAppStore.getState().setLiveSlide('slide-v2'))
        rerender()
        expect(useAppStore.getState().songTracking.status.singerSectionId).toBe('v2')

        // Continuing to sing v2 should NOT snap back to v1 — the tracker now
        // follows the operator's position.
        feed(rerender, 'And grace my fears relieved')
        expect(useAppStore.getState().liveSlideId).toBe('slide-v2')
        expect(useAppStore.getState().songTracking.status.singerSectionId).toBe('v2')
    })

    it('publishes step indices so repeated sections are distinguishable', () => {
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Amazing grace how sweet the sound')
        const status = useAppStore.getState().songTracking.status
        expect(status.singerStepIndex).toBe(0)
        expect(status.displayStepIndex).toBe(0)
    })

    describe('interim transcripts', () => {
        it('advances the cursor from partial text, before any final arrives', () => {
            const { rerender } = renderHook(() => useSongTracker())
            feed(rerender, 'Amazing grace how sweet the sound')

            // Two more lines arrive only as live partial text. Reaching the last
            // line must put the chorus up without waiting for the final segment.
            feedInterim(rerender, 'I once was lost but now am found')
            feedInterim(rerender, 'Was blind but now I see')
            expect(useAppStore.getState().liveSlideId).toBe('slide-c1')
        })

        it('ignores partial text before a song is locked on', () => {
            const { rerender } = renderHook(() => useSongTracker())
            feedInterim(rerender, 'Amazing grace how sweet the sound')
            expect(useAppStore.getState().liveSlideId).toBeNull()
            expect(useAppStore.getState().songTracking.status.phase).toBe('searching')
        })

        it('does not lose the song to a run of unmatched partial text', () => {
            const { rerender } = renderHook(() => useSongTracker())
            feed(rerender, 'Amazing grace how sweet the sound')
            for (const junk of ['the', 'the quick', 'the quick brown', 'the quick brown fox']) {
                feedInterim(rerender, junk)
            }
            expect(useAppStore.getState().songTracking.status.phase).toBe('tracking')
            expect(useAppStore.getState().liveSlideId).toBe('slide-v1')
        })
    })

    describe('predictive advance', () => {
        /** How late every segment is delivered relative to the audio it covers —
         *  the lag the predictive path exists to cancel. */
        const LAG_MS = 1500

        /**
         * Deliver a line that was sung over [startMs, startMs + lineMs) on the
         * audio timeline, at the wall-clock moment it would really arrive.
         * Advancing the fake clock to get there also runs any timer that was due
         * in the meantime, exactly as it would live.
         */
        function sing(rerender: () => void, text: string, index: number, lineMs: number) {
            const startMs = index * lineMs
            const endMs = startMs + lineMs
            act(() => { vi.advanceTimersByTime(Math.max(0, endMs + LAG_MS - Date.now())) })
            seq++
            h.listener = {
                ...h.listener,
                interimTranscript: '',
                transcriptSegments: [
                    ...h.listener.transcriptSegments,
                    { id: `seg${seq}`, text, startMs, endMs, source: 'whisper' },
                ],
            }
            act(() => rerender())
        }

        /** Verse 1 in full, which is what warms up the line-duration estimate.
         *  Its last line trips the trailing-edge rule, so the chorus is live and
         *  the singer is about to enter it. */
        function singVerseOne(rerender: () => void, lineMs: number) {
            const lines = [
                'Amazing grace how sweet the sound',
                'That saved a wretch like me',
                'I once was lost but now am found',
                'Was blind but now I see',
            ]
            lines.forEach((line, i) => sing(rerender, line, i, lineMs))
        }

        beforeEach(() => {
            vi.useFakeTimers()
            vi.setSystemTime(0)
        })

        it('leads to the next section on a timer once line timings are known', () => {
            const { rerender } = renderHook(() => useSongTracker())
            singVerseOne(rerender, 10_000)
            expect(useAppStore.getState().liveSlideId).toBe('slide-c1')

            // Into the chorus. One of its two lines remains (~10s) against a
            // 1.5s lag, so verse 2 is scheduled ~7.9s out — not yet.
            sing(rerender, 'My chains are gone I have been set free', 4, 10_000)
            expect(useAppStore.getState().liveSlideId).toBe('slide-c1')

            act(() => { vi.advanceTimersByTime(7_000) })
            expect(useAppStore.getState().liveSlideId).toBe('slide-c1')
            act(() => { vi.advanceTimersByTime(1_500) })
            expect(useAppStore.getState().liveSlideId).toBe('slide-v2')
        })

        it('leads immediately when the transcript is later than the section has left', () => {
            // Same shape at a real tempo: a 2s line means that by the time the
            // chorus's first line has been transcribed, the 1.5s lag has eaten
            // most of what the section had left. The trailing-edge rule can
            // never win this one — it waits for text matching the *last* line,
            // which arrives after the singers have moved on.
            const { rerender } = renderHook(() => useSongTracker())
            singVerseOne(rerender, 2000)
            expect(useAppStore.getState().liveSlideId).toBe('slide-c1')

            sing(rerender, 'My chains are gone I have been set free', 4, 2000)
            expect(useAppStore.getState().liveSlideId).toBe('slide-v2')
        })

        it('does not fire the timer while locked', () => {
            const { rerender } = renderHook(() => useSongTracker())
            singVerseOne(rerender, 10_000)
            act(() => useAppStore.getState().setSongTrackingLocked(true))
            const held = useAppStore.getState().liveSlideId

            sing(rerender, 'My chains are gone I have been set free', 4, 10_000)
            act(() => { vi.advanceTimersByTime(60_000) })
            expect(useAppStore.getState().liveSlideId).toBe(held)
        })

        it('never leads more than one section ahead when the transcript dries up', () => {
            // An instrumental break: no more text arrives, but the armed timer
            // fires. It may put the next section up; it must not keep walking
            // through the song on its own.
            const { rerender } = renderHook(() => useSongTracker())
            singVerseOne(rerender, 10_000)
            sing(rerender, 'My chains are gone I have been set free', 4, 10_000)

            act(() => { vi.advanceTimersByTime(600_000) })
            expect(useAppStore.getState().liveSlideId).toBe('slide-v2')
        })
    })

    it('publishes whether the song is being sung, and since when', () => {
        const { rerender } = renderHook(() => useSongTracker())
        expect(useAppStore.getState().songTracking.status.singing).toBe(false)
        feed(rerender, 'Amazing grace how sweet the sound')
        const status = useAppStore.getState().songTracking.status
        expect(status.singing).toBe(true)
        expect(status.singingSince).not.toBeNull()
    })

    it('traces each decision with what held the slide, and says so on the readout', async () => {
        const { songTraceSince, clearSongTrace } = await import('../../services/sermon-listener/songTrace')
        clearSongTrace()
        // A section whose slide was deleted from the deck.
        useAppStore.setState({ activeSlides: songSlides().filter((sl) => sl.id !== 'slide-c1') })
        const { rerender } = renderHook(() => useSongTracker())
        feed(rerender, 'Amazing grace how sweet the sound')
        feed(rerender, 'My chains are gone I have been set free')

        const finals = songTraceSince(0).filter((e) => e.source === 'final')
        expect(finals[0]).toMatchObject({ reason: 'acquired', matchedLine: 'Amazing grace how sweet the sound', movedTo: 'slide-v1' })
        expect(finals[1]).toMatchObject({ held: 'step-has-no-slide' })
        expect(useAppStore.getState().songTracking.status.held).toBe('step-has-no-slide')
    })

    describe('when something else is on air', () => {
        const VERSE_SLIDE = {
            id: 'scripture-1', index: 99, name: 'John 3:16', type: 'bible', layout: 'bible',
            userId: 'u', churchId: 'c', scheduleId: 's', contents: ['For God so loved the world'],
        } as unknown as Slide

        function stepAwayTo(rerender: () => void, slide: Slide) {
            act(() => {
                useAppStore.setState({ activeSlides: [...useAppStore.getState().activeSlides, slide] })
                useAppStore.getState().setLiveSlide(slide.id)
            })
            act(() => rerender())
        }

        // The regression: the tracker put its song back on air with every
        // line it matched, so a verse shown after a song came straight down.
        it('does not take the screen back from a verse', () => {
            const { rerender } = renderHook(() => useSongTracker())
            feed(rerender, 'Amazing grace how sweet the sound')
            expect(useAppStore.getState().liveSlideId).toBe('slide-v1')

            stepAwayTo(rerender, VERSE_SLIDE)
            feed(rerender, 'That saved a wretch like me')
            feed(rerender, 'Was blind but now I see')
            feed(rerender, 'My chains are gone I have been set free')

            expect(useAppStore.getState().liveSlideId).toBe('scripture-1')
            expect(useAppStore.getState().songTracking.status.held).toBe('something-else-on-air')
        })

        it('drives the song again once a slide of it is back on air', () => {
            const { rerender } = renderHook(() => useSongTracker())
            feed(rerender, 'Amazing grace how sweet the sound')
            stepAwayTo(rerender, VERSE_SLIDE)
            feed(rerender, 'That saved a wretch like me')

            act(() => useAppStore.getState().setLiveSlide('slide-c1'))
            act(() => rerender())
            feed(rerender, 'And like a flood His mercy reigns')

            expect(useAppStore.getState().liveSlideId).toBe('slide-v2')
        })

        it('keeps following the song stepped away from, not the first in the deck', () => {
            const other = songSlides().map((sl) => ({ ...sl, id: `other-${sl.id}`, songId: 'other' }))
            useAppStore.setState({ activeSlides: [...other, ...songSlides()] })
            const { rerender } = renderHook(() => useSongTracker())
            act(() => useAppStore.getState().setLiveSlide('slide-v1'))
            act(() => rerender())
            expect(useAppStore.getState().songTracking.status.songId).toBe('song1')

            stepAwayTo(rerender, VERSE_SLIDE)

            expect(useAppStore.getState().songTracking.status.songId).toBe('song1')
        })
    })

    it('finds the slide for a section after a chorus written out twice', () => {
        // V1, C, V2, C, V3: five slides, three sections. By place, the second
        // chorus slide stood for Verse 3, and Verse 3's own slide for nothing.
        const v3 = 'Through many dangers toils and snares\nI have already come'
        const song: Song = {
            id: 'song2', _id: 'song2', title: 'Grace', artist: '',
            lyrics: [
                SONG.sections![0].lines.join('\n'),
                SONG.sections![1].lines.join('\n'),
                SONG.sections![2].lines.join('\n'),
                SONG.sections![1].lines.join('\n'),
                v3,
            ].join('\n\n'),
        }
        // Split as the search path splits it (useSong.getSong).
        const blocks = songSlideBlocks({ ...song, verses: song.lyrics.split('\n\n') })
        const data: Song = { ...song, verses: blocks.map((b) => b.text) }
        const slides: Slide[] = blocks.map((b, i) => ({
            id: `slide-${i}`, index: i, name: `Grace - ${b.label}`, type: 'song', layout: 'default',
            userId: 'u', churchId: 'c', scheduleId: 's', contents: [b.text],
            songId: 'song2', verseIndex: i, verseLabel: b.label, data,
        }))
        useAppStore.setState({ activeSlides: slides, liveSlideId: null })

        renderHook(() => useSongTracker())
        const arr = useAppStore.getState().songTracking.status.arrangement
        expect(arr.map((step) => [step.sectionId, step.slideId])).toEqual([
            ['v1', 'slide-0'], ['c1', 'slide-1'], ['v2', 'slide-2'], ['v3', 'slide-4'],
        ])
    })
})
