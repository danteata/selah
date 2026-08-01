import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Slide, Song } from '../../types'
import type { TranscriptSegment } from '../../types/sermon-listener'

// Controllable fake sermon-listener context (mutated between rerenders).
const h = vi.hoisted(() => ({
    listener: {
        isListening: true,
        transcriptSegments: [] as TranscriptSegment[],
    },
    /** The fake IndexedDB library table's contents. */
    library: [] as Array<{ id: string; type: string; content: Song }>,
}))

vi.mock('../../components/sermon-listener/SermonListenerContext', () => ({
    useSermonListenerContext: () => h.listener,
}))

vi.mock('../useIndexedDB', () => ({
    getIndexedDB: () => ({
        library: {
            where: () => ({
                equals: (type: string) => ({
                    toArray: async () => h.library.filter((i) => i.type === type),
                }),
            }),
            put: async (row: { id: string; type: string; content: Song }) => {
                h.library.push(row)
            },
        },
    }),
}))

vi.mock('../useSlideCreation', () => ({
    useSlideCreation: () => ({
        createSongSlides: (song: Song): Slide[] =>
            (song.sections ?? []).map((s, i) => ({
                id: `slide-${song.id}-${s.id}`,
                index: i,
                name: `${song.title} - ${s.label}`,
                type: 'song',
                layout: 'default',
                userId: 'u',
                churchId: 'c',
                scheduleId: 's',
                contents: [s.lines.join('\n')],
                songId: song._id || song.id,
                verseIndex: i,
                data: song,
            })) as Slide[],
    }),
}))

// The online-lookup path is off by default; stub the LLM client so importing
// this hook doesn't drag the provider stack into the test.
vi.mock('../../services/sermon-listener/llmClient', () => ({
    isLlmConfigured: () => false,
}))

const GRACE: Song = {
    id: 'grace',
    _id: 'grace',
    title: 'Amazing Grace',
    artist: 'Traditional',
    lyrics: '',
    sections: [
        {
            id: 'v1', type: 'verse', number: 1, label: 'Verse 1', lines: [
                'Amazing grace how sweet the sound',
                'That saved a wretch like me',
                'I once was lost but now am found',
                'Was blind but now I see',
            ],
        },
    ],
    defaultArrangement: ['v1'],
}

/** A song imported after the session started — the case the index cache used
 *  to miss entirely. Deliberately shares no distinctive vocabulary with GRACE. */
const CORNERSTONE: Song = {
    id: 'cornerstone',
    _id: 'cornerstone',
    title: 'Cornerstone',
    artist: 'Hillsong',
    lyrics: '',
    sections: [
        {
            id: 'v1', type: 'verse', number: 1, label: 'Verse 1', lines: [
                'My hope is built on nothing less',
                'Than Jesus blood and righteousness',
                'I dare not trust the sweetest frame',
                'But wholly trust in Jesus name',
            ],
        },
    ],
    defaultArrangement: ['v1'],
}

let seq = 0
function feed(rerender: () => void, text: string) {
    seq++
    h.listener = {
        ...h.listener,
        transcriptSegments: [
            ...h.listener.transcriptSegments,
            { id: `seg${seq}`, text, startMs: seq * 3000, endMs: seq * 3000 + 2500, source: 'whisper' },
        ],
    }
    act(() => rerender())
}

/** Sing enough of a song for the confirmation tracker to commit to it, then
 *  let the pending index build and slide creation settle. */
async function singUntilDetected(rerender: () => void, lines: string[]) {
    for (const line of lines) {
        feed(rerender, line)
        // The detector's work happens in an async IIFE (it awaits the index).
        await act(async () => { await Promise.resolve() })
    }
}

describe('useSongAutoDetect (library index freshness)', () => {
    beforeEach(() => {
        seq = 0
        h.listener = { isListening: true, transcriptSegments: [] }
        h.library = [{ id: GRACE.id, type: 'song', content: GRACE }]
        vi.resetModules()
    })

    afterEach(() => {
        vi.resetModules()
    })

    it('detects a song that was in the library when the index was built', async () => {
        const { useAppStore, DEFAULT_SONG_TRACKING } = await import('../../store/appStore')
        const { useSongAutoDetect } = await import('../useSongAutoDetect')
        useAppStore.setState({
            activeSlides: [],
            liveSlideId: null,
            songTracking: { ...DEFAULT_SONG_TRACKING, autoDetect: true, status: { ...DEFAULT_SONG_TRACKING.status } },
        })

        const { rerender } = renderHook(() => useSongAutoDetect())
        await singUntilDetected(rerender, [
            'Amazing grace how sweet the sound',
            'That saved a wretch like me',
            'I once was lost but now am found',
        ])

        expect(useAppStore.getState().liveSlideId).toBe('slide-grace-v1')
    })

    it('detects a song imported mid-session, once the library signals the change', async () => {
        // The regression: the search index was built once per session and only
        // ever invalidated by this hook's own online-lookup path, so a song
        // imported or edited by the operator after the listener started could
        // not be auto-detected for the rest of the service.
        const { useAppStore, DEFAULT_SONG_TRACKING } = await import('../../store/appStore')
        const { useSongAutoDetect } = await import('../useSongAutoDetect')
        const { notifySongsChanged } = await import('../useSongs')
        useAppStore.setState({
            activeSlides: [],
            liveSlideId: null,
            songTracking: { ...DEFAULT_SONG_TRACKING, autoDetect: true, status: { ...DEFAULT_SONG_TRACKING.status } },
        })

        const { rerender } = renderHook(() => useSongAutoDetect())

        // Build the index against a library that does not contain Cornerstone.
        await singUntilDetected(rerender, ['Amazing grace how sweet the sound'])
        expect(useAppStore.getState().liveSlideId).toBeNull()

        // The operator imports it mid-service.
        h.library.push({ id: CORNERSTONE.id, type: 'song', content: CORNERSTONE })
        act(() => { notifySongsChanged() })

        await singUntilDetected(rerender, [
            'My hope is built on nothing less',
            'Than Jesus blood and righteousness',
            'I dare not trust the sweetest frame',
        ])

        expect(useAppStore.getState().liveSlideId).toBe('slide-cornerstone-v1')
    })
})
