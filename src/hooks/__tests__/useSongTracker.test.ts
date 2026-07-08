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
    } as { isListening: boolean; transcriptSegments: TranscriptSegment[]; audioLevel: number },
}))

vi.mock('../../components/sermon-listener/SermonListenerContext', () => ({
    useSermonListenerContext: () => h.listener,
}))

// Real store — we assert against actual setLiveSlide / status behaviour.
import { useAppStore, DEFAULT_SONG_TRACKING } from '../../store/appStore'
import { useSongTracker } from '../useSongTracker'

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
function feed(rerender: () => void, text: string, audioLevel = 0) {
    seq++
    h.listener = {
        ...h.listener,
        audioLevel,
        transcriptSegments: [
            ...h.listener.transcriptSegments,
            { id: `seg${seq}`, text, startMs: seq * 1000, endMs: seq * 1000 + 500, source: 'whisper' },
        ],
    }
    act(() => rerender())
}

describe('useSongTracker (live wiring)', () => {
    beforeEach(() => {
        seq = 0
        h.listener = { isListening: true, transcriptSegments: [], audioLevel: 0 }
        useAppStore.setState({
            activeSlides: songSlides(),
            liveSlideId: null,
            songTracking: { ...DEFAULT_SONG_TRACKING, enabled: true, status: { ...DEFAULT_SONG_TRACKING.status } },
        })
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
})
