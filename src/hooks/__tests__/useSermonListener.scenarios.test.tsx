/**
 * Scenarios for the sermon listener, driven through the hook's own interface.
 *
 * A fake transcriber feeds utterances in, a fake semantic matcher returns
 * scripted matches, and the assertions read only what the rest of the app
 * reads: the heard verses, the current verse and scripture, and the live slide
 * in the real store.
 *
 * Which verse to follow is the scripture follower's call, and its policy is
 * tested through its own interface (scriptureFollower.test.ts). These cover
 * what the listener does with those decisions — the look-ups and the slides,
 * starting and stopping, the archive recording, a reset, a reload — plus a
 * smoke test of each detection path end to end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { StrictMode } from 'react'
import type { Scripture, Slide } from '../../types'
import type { SemanticVerseMatch } from '../../services/sermon-listener'

const h = vi.hoisted(() => {
    const transcription = {
        /** Events from the fake engine reach the listener through this. */
        emit: null as ((event: import('../../services/sermon-listener/transcriptionEngine').EngineEvent) => void) | null,
        listening: false,
    }
    return {
        transcription,
        /** Scripted semantic results, one per addText call; null = no match. */
        semanticQueue: [] as Array<SemanticVerseMatch[] | null>,
        readingContexts: [] as Array<[string | null, number | undefined, number | undefined]>,
        idbLive: null as Record<string, unknown> | null,
        /** Labels fetchScripture refuses, to simulate a verse that isn't found. */
        missing: new Set<string>(),
        /** Per-label lookup delay in ms, to reproduce lookups finishing out of order. */
        lookupDelay: new Map<string, number>(),
        slideCounter: 0,
        recordings: { started: [] as string[], stopped: 0, attached: [] as Array<[string, string]> },
        recordingResult: '/tmp/rec.wav' as string | null,
        providerAvailable: true,
        semanticDelay: 0,
        llmConfigured: false,
        llmDelay: 0,
        llmResult: [] as unknown[],
        /** The team's saved copy, as the fake transcript store received it. */
        savedCopy: { creates: [] as Array<Record<string, unknown>>, updates: [] as Array<[string, Record<string, unknown>]> },
    }
})

vi.mock('../../services/sermon-listener', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/sermon-listener')>()
    const fakeDetector = {
        initialize: async () => ({ ready: true }),
        addText: async () => {
            if (h.semanticDelay) await new Promise((r) => setTimeout(r, h.semanticDelay))
            return h.semanticQueue.shift() ?? null
        },
        setReadingContext: (book: string | null, chapter?: number, verse?: number) => {
            h.readingContexts.push([book, chapter, verse])
        },
    }
    return {
        ...actual,
        getSemanticDetector: () => fakeDetector,
        initializeEmbedder: async () => {},
    }
})

// One fake engine stands in for both: it starts at once and delivers whatever
// the test says through `h.transcription.emit`.
vi.mock('../../services/sermon-listener/engines', () => {
    const fake = (provider: 'web-speech' | 'native') => ({
        provider,
        isAvailable: async () => h.providerAvailable,
        start: async (_options: unknown, onEvent: NonNullable<typeof h.transcription.emit>) => {
            h.transcription.emit = onEvent
            h.transcription.listening = true
            onEvent({ type: 'started' })
            return true
        },
        stop: async () => {
            h.transcription.listening = false
        },
        isBusy: () => h.transcription.listening,
    })
    return { transcriptionEngines: { 'web-speech': fake('web-speech'), native: fake('native') } }
})

vi.mock('../useScripture', async () => {
    const { NUMBER_TO_BOOK } = await vi.importActual<typeof import('../../services/sermon-listener/verseDetection')>(
        '../../services/sermon-listener/verseDetection',
    )
    return {
        useScripture: () => ({
            // Labels arrive as "43:3:16" or "43:3:16-17" (verseToLabel).
            fetchScripture: async (label: string, version: string): Promise<Scripture | null> => {
                const m = /^(\d+):(\d+):(\d+)(?:-(\d+))?$/.exec(label)
                if (!m) return null
                const [, bookNum, chapter, start, end] = m
                const name = NUMBER_TO_BOOK[Number(bookNum)]
                const human = `${name} ${chapter}:${start}${end ? `-${end}` : ''}`
                const delay = h.lookupDelay.get(human)
                if (delay) await new Promise((r) => setTimeout(r, delay))
                if (h.missing.has(human)) return null
                const verses = []
                for (let v = Number(start); v <= Number(end ?? start); v++) {
                    verses.push({ book: bookNum, chapter, verse: String(v), scripture: `${human} text` })
                }
                return { label: human, labelShortFormat: human, version, content: verses }
            },
        }),
    }
})

vi.mock('../useSlideCreation', () => ({
    firstVerseOnly: () => undefined,
    useSlideCreation: () => ({
        createBibleSlide: (scripture: Scripture): Slide => ({
            id: `bible-${++h.slideCounter}`,
            index: 0,
            name: scripture.label,
            title: scripture.label,
            type: 'bible',
            layout: 'default',
            userId: 'u',
            churchId: 'c',
            scheduleId: 's',
            contents: [scripture.label],
            data: scripture,
            slideStyle: { bibleVersion: scripture.version },
        }) as unknown as Slide,
    }),
}))

vi.mock('../useIndexedDB', () => ({
    getLiveSermonState: async () => h.idbLive,
    saveLiveSermonState: async () => {},
    clearLiveSermonState: async () => {},
    getSavedSermonTranscripts: async () => [],
    saveSermonTranscript: async () => {},
    deleteSavedSermonTranscript: async () => {},
    clearSavedSermonTranscripts: async () => {},
    migrateLegacySermonStorage: async () => {},
    setSermonRecordingTranscript: async (id: string, text: string) => {
        h.recordings.attached.push([id, text])
    },
}))

vi.mock('../useAnalytics', () => ({ useAnalytics: () => ({ trackEvent: () => {} }) }))
vi.mock('../useTranscripts', () => ({
    useTranscripts: () => ({
        transcripts: [],
        isLoading: false,
        createTranscript: async (data: Record<string, unknown>) => {
            h.savedCopy.creates.push(data)
            return `copy-${h.savedCopy.creates.length}`
        },
        updateTranscript: async (id: string, data: Record<string, unknown>) => {
            h.savedCopy.updates.push([id, data])
            return id
        },
        deleteTranscript: async () => null,
    }),
}))
vi.mock('../../services/sermon-listener/sessionAudioRecorder', () => ({
    sessionAudioRecorder: { start: async () => null, stop: async () => {}, getSessionId: () => null, getStartedAt: () => null },
}))
vi.mock('../../providers/LicenseProvider', () => ({
    useEntitlements: () => ({ isPro: true, startProCheckout: async () => {} }),
}))
vi.mock('../useGlobalAppSettings', () => ({ useGlobalSermonListenerSettings: () => ({ settings: null }) }))
vi.mock('../../platform', () => ({ isDesktop: () => false }))
vi.mock('../../services/sermon-listener/keepAwake', () => ({
    startKeepAwake: async () => true,
    stopKeepAwake: async () => {},
    setupVisibilityKeepAwake: () => () => {},
}))
vi.mock('../../services/sermon-listener/audioFeedback', () => ({
    audioFeedbackService: { playStart: () => {}, playStop: () => {} },
}))
vi.mock('../../services/sermon-listener/nativeAudioCapture', () => ({
    onCaptureStreamError: async () => () => {},
}))
vi.mock('../../services/visualizer/nativeAudioFeatures', () => ({
    startNativeAudioFeatures: async () => () => {},
}))
vi.mock('../../services/sermon-listener/llmClient', () => ({ isLlmConfigured: () => h.llmConfigured }))
vi.mock('../../services/sermon-listener/llmVerseExtraction', () => ({
    extractVersesWithLLM: async () => {
        if (h.llmDelay) await new Promise((r) => setTimeout(r, h.llmDelay))
        return { newVerses: h.llmResult }
    },
}))
vi.mock('../../services/sermon-listener/sessionRecordings', () => ({
    startRecording: async (id: string) => {
        h.recordings.started.push(id)
        return h.recordingResult
    },
    stopRecording: async () => {
        h.recordings.stopped++
    },
}))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, warning: () => {}, success: () => {} }) }))

import { useSermonListener, type SermonListenerOptions } from '../useSermonListener'
import { resetListeningSessionForTests } from '../../services/sermon-listener/appListeningSession'
import { useAppStore } from '../../store/appStore'

const SECOND = 1000

async function flush() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
    })
}

async function listen(options: SermonListenerOptions = {}, { strict = false } = {}) {
    const hook = renderHook(
        () => useSermonListener({ autoLookup: true, autoDisplay: true, enableSemanticDetection: true, ...options }),
        strict ? { wrapper: StrictMode } : undefined,
    )
    await flush()
    await act(async () => {
        await hook.result.current.start()
    })
    await flush()

    const api = {
        hook,
        get state() {
            return hook.result.current
        },
        /** One committed utterance, as the transcriber delivers it. */
        async say(text: string) {
            await act(async () => {
                h.transcription.emit!({ type: 'result', text, isFinal: true })
            })
            await flush()
            if (process.env.SCENARIO_DEBUG) {
                console.error(`said ${JSON.stringify(text.slice(0, 50))} q=${h.semanticQueue.length} → heard=${JSON.stringify(api.heard())} current=${api.current()} live=${api.live()} scripture=${hook.result.current.currentScripture?.label}`)
            }
        },
        /** A provisional (interim) result, which is acted on after a short debounce. */
        async sayInterim(text: string) {
            await act(async () => {
                h.transcription.emit!({ type: 'result', text, isFinal: false })
            })
            await flush()
        },
        /** The next semantic search returns these matches. */
        semanticWillMatch(...matches: Array<Partial<SemanticVerseMatch> & { reference: string; score: number }>) {
            h.semanticQueue.push(matches.map((m) => {
                const [, book, chapter, verse] = /^(.+) (\d+):(\d+)$/.exec(m.reference)!
                return {
                    book,
                    chapter: Number(chapter),
                    verse: Number(verse),
                    text: m.text ?? 'the verse text as preached',
                    detectionType: 'semantic',
                    ...m,
                } as SemanticVerseMatch
            }))
        },
        async wait(ms: number) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(ms)
            })
            await flush()
        },
        heard() {
            return hook.result.current.detectedVerses.map((v) => v.reference)
        },
        heardVerse(reference: string) {
            return hook.result.current.detectedVerses.find((v) => v.reference === reference)
        },
        current() {
            return hook.result.current.currentVerse?.reference ?? null
        },
        live() {
            const s = useAppStore.getState()
            const slide = s.activeSlides.find((x) => x.id === s.liveSlideId)
            return (slide?.data as Scripture | undefined)?.label ?? null
        },
        liveVersion() {
            const st = useAppStore.getState()
            const slide = st.activeSlides.find((x) => x.id === st.liveSlideId)
            return (slide?.data as Scripture | undefined)?.version ?? null
        },
        queued() {
            return useAppStore.getState().activeSlides.map((s) => (s.data as Scripture | undefined)?.label)
        },
    }
    return api
}

beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-22T10:00:00Z') })
    const initial = useAppStore.getInitialState()
    useAppStore.setState({
        activeSlides: [],
        liveOutputSlidesId: null,
        liveSlideId: null,
        settings: initial.settings,
        songTracking: initial.songTracking,
    })
    h.transcription.emit = null
    h.transcription.listening = false
    h.semanticQueue = []
    h.readingContexts = []
    h.idbLive = null
    h.missing = new Set()
    h.lookupDelay = new Map()
    h.slideCounter = 0
    h.recordings = { started: [], stopped: 0, attached: [] }
    h.recordingResult = '/tmp/rec.wav'
    h.providerAvailable = true
    h.semanticDelay = 0
    h.llmConfigured = false
    h.llmDelay = 0
    h.llmResult = []
    h.savedCopy = { creates: [], updates: [] }
    // One listening session per app; a fresh app per test.
    resetListeningSessionForTests()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

beforeEach(() => {
    // The hook narrates every utterance; keep test output to the failures.
    if (process.env.SCENARIO_DEBUG) return
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

function setSermonSettings(patch: Record<string, unknown>) {
    const s = useAppStore.getState()
    useAppStore.setState({ settings: { ...s.settings, sermonListener: { ...s.settings.sermonListener, ...patch } } as typeof s.settings })
}

describe('sermon listener: starting and stopping', () => {
    // Start pressed before the engine check on mount had answered used to be
    // refused as "not supported".
    it('a Start pressed before the engine check has answered waits for it', async () => {
        const hook = renderHook(() => useSermonListener({ autoDisplay: true }))
        let started = false
        await act(async () => {
            started = await hook.result.current.start()
        })
        expect(started).toBe(true)
        expect(hook.result.current.isListening).toBe(true)
    })

    it('archives the session when listening stops by voice, not only from the panel', async () => {
        setSermonSettings({ recordSessions: true })
        const s = await listen()
        expect(h.recordings.started).toHaveLength(1)

        await s.say('Turn with me to John 3:16.')
        await s.say('Stop listening.')

        expect(s.state.isListening).toBe(false)
        expect(h.recordings.stopped).toBe(1)
        expect(h.recordings.attached).toEqual([[h.recordings.started[0], 'Turn with me to John 3:16. Stop listening.']])
    })

    it('archives the session when stop() is called directly, as the tray does', async () => {
        setSermonSettings({ recordSessions: true })
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await act(async () => {
            s.state.stop()
        })
        await s.wait(0)

        expect(h.recordings.stopped).toBe(1)
        expect(h.recordings.attached).toHaveLength(1)
    })

    // The panel used to do this, so it stopped whenever the panel was hidden,
    // made a duplicate on every remount, and missed a stop by voice or tray.
    it('the team\'s saved copy is made with no panel open, however the run ends', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await s.say('Stop listening.')
        await s.wait(0)

        expect(h.savedCopy.creates).toHaveLength(1)
        expect(h.savedCopy.creates[0]).toMatchObject({
            transcript: 'Turn with me to John 3:16. Stop listening.',
            detectedVerses: [expect.objectContaining({ reference: 'John 3:16' })],
        })
        expect(s.state.savedTranscriptId).toBe('copy-1')
    })

    it('records nothing unless the church turned recording on', async () => {
        const s = await listen()
        await act(async () => {
            s.state.stop()
        })
        await s.wait(0)
        expect(h.recordings.started).toHaveLength(0)
        expect(h.recordings.stopped).toBe(0)
    })

    it('a new listening session does not inherit the last one\'s reading context', async () => {
        const s = await listen()
        await s.say('Joshua chapter 24 verse 15.')
        await act(async () => {
            s.state.stop()
            s.state.reset()
        })
        await act(async () => {
            await s.state.start()
        })
        await s.wait(5 * SECOND)
        // A bare number is a verse jump only while a chapter is fresh in the
        // reading context — and the new session has none.
        await s.say('16.')

        expect(s.heard()).toEqual([])
        expect(s.live()).toBe('Joshua 24:15')
        expect(h.readingContexts.at(-1)?.[0]).toBeNull()
    })

    it('a new listening session does not inherit the last one\'s navigation cooldown', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await s.wait(4 * SECOND)
        await s.say('Next verse.')
        await act(async () => {
            s.state.reset()
        })
        await s.say('We see in Joshua chapter 24 that they served the Lord.')

        expect(s.live()).toBe('Joshua 24:1')
    })
})

describe('sermon listener: what the capture stream reports', () => {
    async function capture(event: Record<string, unknown>) {
        const s = await listen()
        await act(async () => {
            h.transcription.emit!({ type: 'capture', ...event } as Parameters<NonNullable<typeof h.transcription.emit>>[0])
        })
        return s
    }

    it('a microphone that dropped and is being rebuilt shows as retrying', async () => {
        const s = await capture({ status: 'lost', attempt: 2, message: 'device unplugged' })
        expect(s.state.error).toMatchObject({ code: 'capture_stream_lost', retryable: true })
        expect(s.state.error?.message).toBe('Lost the input stream (attempt 2): device unplugged')
    })

    // Its message says "input stream", which used to make the banner promise an
    // automatic retry after the supervisor had already given up.
    it('a microphone that could not be reopened is not shown as retrying', async () => {
        const s = await capture({ status: 'fatal', message: 'Failed to build input stream: device gone' })
        expect(s.state.error).toMatchObject({ code: 'capture_stream_lost', retryable: false })
    })

    it('a fallback to the default microphone forgets the chosen one', async () => {
        setSermonSettings({ selectedMicrophoneId: 'Desk feed', inputChannel: 2 })
        const s = await capture({ status: 'fell-back', from: 'Desk feed', message: 'gone' })
        expect(s.state.error).toBeNull()
        expect(useAppStore.getState().settings.sermonListener?.selectedMicrophoneId).toBeUndefined()
        expect(useAppStore.getState().settings.sermonListener?.inputChannel).toBeUndefined()
    })

    it('an engine failure ends listening and says what kind it was', async () => {
        const s = await listen()
        await act(async () => {
            h.transcription.emit!({ type: 'failed', error: { code: 'model_not_found', message: 'Model base.en is not downloaded', retryable: false } })
        })
        expect(s.state.isListening).toBe(false)
        expect(s.state.error?.code).toBe('model_not_found')
    })
})

describe('sermon listener: explicit references', () => {
    // The app runs under StrictMode, which mounts, unmounts and remounts.
    it('keeps following after StrictMode remounts the hook', async () => {
        const s = await listen({}, { strict: true })
        await s.say('Turn with me to John 3:16.')
        expect(s.current()).toBe('John 3:16')
        expect(s.live()).toBe('John 3:16')
    })

    it('hears a spoken reference, makes it current and puts it live', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')

        expect(s.heard()).toEqual(['John 3:16'])
        expect(s.current()).toBe('John 3:16')
        expect(s.state.currentScripture?.label).toBe('John 3:16')
        expect(s.live()).toBe('John 3:16')
    })

    it('only lists and highlights, without going live, when auto-display is off', async () => {
        const s = await listen({ autoDisplay: false })
        // Not phrased as a go-to command, so only the detection path sees it.
        await s.say('We see in Joshua chapter 24 that they served the Lord.')

        expect(s.heard()).toEqual(['Joshua 24:1'])
        expect(s.current()).toBe('Joshua 24:1')
        expect(s.live()).toBeNull()
    })

    // Almost any spoken reference ("John 3:16 says", "turn with me to …") is
    // also read as a go-to command, and commands put the passage up whatever
    // auto-display said. Only one asked for ("go to", "open") does now.
    it('a reference only mentioned stays off the screen with auto-display off', async () => {
        const s = await listen({ autoDisplay: false })
        await s.say('Turn with me to John 3:16.')

        expect(s.heard()).toEqual(['John 3:16'])
        expect(s.current()).toBe('John 3:16')
        expect(s.live()).toBeNull()
    })

    it('a verse that cannot be found is listed but nothing goes live', async () => {
        const s = await listen()
        h.missing.add('John 3:16')
        await s.say('Turn with me to John 3:16.')

        expect(s.heard()).toEqual(['John 3:16'])
        expect(s.live()).toBeNull()
    })
})

describe('sermon listener: reading context and voice commands', () => {

    it('"next verse" moves the live slide forward in place', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await s.wait(4 * SECOND)
        await s.say('Next verse.')

        expect(s.current()).toBe('John 3:17')
        expect(s.live()).toBe('John 3:17')
        expect(s.queued()).toEqual(['John 3:17'])
    })

    it('"next chapter" from the last chapter of a book moves into the next book', async () => {
        const s = await listen()
        await s.say('Genesis 50 verse 26.')
        await s.wait(4 * SECOND)
        await s.say('Next chapter.')

        expect(s.current()).toBe('Exodus 1:1')
        expect(s.state.currentVerse?.book).toBe('Exodus')
        expect(s.live()).toBe('Exodus 1:1')
    })
})

describe('sermon listener: semantic matches', () => {
    it('a paraphrase with a scripture marker is heard and shown', async () => {
        const s = await listen()
        s.semanticWillMatch({ reference: 'John 3:16', score: 0.82, text: 'for God so loved the world, the scripture says' })
        await s.say('The scripture says for God so loved the world that he gave his only son.')

        expect(s.heard()).toEqual(['John 3:16'])
        expect(s.live()).toBe('John 3:16')
    })
})

// Phrased so only the detection path sees them, not the voice-command path.
const JOSHUA_24 = 'We see in Joshua chapter 24 that they served the Lord.'
const JUDGES_2 = 'We see in Judges chapter 2 that they forgot the Lord.'
// The same reference in other words: the listener drops a sentence repeated
// word for word as a transcription duplicate.
const JOSHUA_24_AGAIN = 'Remember what we saw in Joshua chapter 24 about serving the Lord.'

describe('sermon listener: what the heard verses remember', () => {
    it('a verse removed from the list can be heard again', async () => {
        const s = await listen()
        await s.say(JOSHUA_24)
        await act(async () => {
            s.state.removeVerse(s.heardVerse('Joshua 24:1')!)
        })
        expect(s.heard()).toEqual([])

        await s.wait(5 * SECOND)
        await s.say(JOSHUA_24_AGAIN)

        expect(s.heard()).toEqual(['Joshua 24:1'])
    })

    it('a verse merely still in the window does not change the text shown for the current verse', async () => {
        const s = await listen()
        await s.say(JOSHUA_24)
        await s.say(JUDGES_2)
        expect(s.current()).toBe('Judges 2:1')

        await s.wait(5 * SECOND)
        await s.say('And they did evil in the sight of the Lord.')

        expect(s.current()).toBe('Judges 2:1')
        expect(s.state.currentScripture?.label).toBe('Judges 2:1')
    })

    it('verses restored after a reload are remembered as heard, so a re-mention counts as one', async () => {
        h.idbLive = {
            transcript: JOSHUA_24,
            detectedVerses: [{
                raw: 'Joshua chapter 24', reference: 'Joshua 24:1', book: 'Joshua', chapter: 24, verseStart: 1,
                startIndex: 0, endIndex: 10, confidence: 'medium', isBestMatch: true, detectionType: 'regex',
                lastActivatedAt: Date.now() - 30 * 60 * SECOND, retriggerCount: 0,
            }],
        }
        const s = await listen()
        expect(s.heard()).toEqual(['Joshua 24:1'])

        await s.say(JOSHUA_24)

        expect(s.heardVerse('Joshua 24:1')!.retriggerCount).toBe(1)
        expect(s.current()).toBe('Joshua 24:1')
        expect(s.live()).toBe('Joshua 24:1')
    })
})

describe('sermon listener: lookups that finish out of order', () => {
    it('a slow lookup for an earlier verse does not replace the newer verse on screen', async () => {
        const s = await listen()
        h.lookupDelay.set('Joshua 24:1', 2 * SECOND)
        await s.say(JOSHUA_24)
        await s.say(JUDGES_2)
        await s.wait(3 * SECOND)

        expect(s.current()).toBe('Judges 2:1')
        expect(s.live()).toBe('Judges 2:1')
        expect(s.state.currentScripture?.label).toBe('Judges 2:1')
    })
})

function verse(reference: string, confidence: 'high' | 'medium' | 'low' = 'high') {
    const [, book, chapter, start] = /^(.+) (\d+):(\d+)$/.exec(reference)!
    return {
        raw: reference, reference, book, chapter: Number(chapter), verseStart: Number(start),
        startIndex: 0, endIndex: 0, confidence,
    }
}

describe('sermon listener: carrying out commands and wiring', () => {
    it('"read it in the NIV" switches the version and rewrites the live slide in it', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await s.wait(4 * SECOND)
        await s.say('Read it in the NIV.')

        expect(s.state.activeBibleVersion).toBe('NIV')
        expect(s.live()).toBe('John 3:16')
        expect(s.liveVersion()).toBe('NIV')
        expect(s.queued()).toEqual(['John 3:16'])
        expect(s.state.lastVoiceCommand?.type).toBe('change_version')
    })

    // The quoted-phrase table named the book "Psalm", which no lookup knows,
    // so the verse was listed but could never be shown.
    it('"the Lord is my shepherd" is heard as Psalms 23:1 and shown', async () => {
        const s = await listen()
        await s.say('The Lord is my shepherd, I shall not want.')

        expect(s.heard()).toEqual(['Psalms 23:1'])
        expect(s.live()).toBe('Psalms 23:1')
    })

    it('"display it" puts the current verse up when auto-display is off', async () => {
        const s = await listen({ autoDisplay: false })
        await s.say(JOSHUA_24)
        expect(s.live()).toBeNull()
        await s.say('Display it.')

        expect(s.live()).toBe('Joshua 24:1')
    })

    it('"verse 5" with nothing heard yet follows the bible slide already on screen', async () => {
        const s = await listen()
        const content = [{ book: '43', chapter: '3', verse: '16', scripture: 'text' }]
        useAppStore.setState({
            activeSlides: [{
                id: 'from-bible-tab', type: 'bible', name: 'John 3:16', contents: ['John 3:16'],
                data: { label: 'John 3:16', labelShortFormat: 'John 3:16', version: 'KJV', content },
            } as unknown as Slide],
            liveSlideId: 'from-bible-tab',
        })
        await s.say('Verse 5.')

        expect(s.current()).toBe('John 3:5')
        expect(s.live()).toBe('John 3:5')
        expect(s.queued()).toEqual(['John 3:5'])
    })

    it('no semantic search runs while the congregation is singing', async () => {
        const s = await listen()
        const st = useAppStore.getState()
        useAppStore.setState({
            songTracking: { ...st.songTracking, autoDetect: true, status: { ...st.songTracking.status, songId: 'song', phase: 'tracking' } },
        })
        s.semanticWillMatch({ reference: 'John 3:16', score: 0.82, text: 'for god so loved the world, the scripture says' })
        await s.say('The scripture says for God so loved the world that he gave his only son.')

        expect(s.heard()).toEqual([])
        expect(h.semanticQueue).toHaveLength(1)
    })

    it('the LLM pass adds and shows a verse the local detectors missed', async () => {
        const s = await listen()
        h.llmConfigured = true
        h.llmResult = [verse('Romans 8:28')]
        await s.say('All things work together for good to them that love God.')
        expect(s.heard()).toEqual([])
        await s.wait(4 * SECOND)

        expect(s.heard()).toEqual(['Romans 8:28'])
        expect(s.live()).toBe('Romans 8:28')
    })

    it('a provisional result is acted on after a short pause', async () => {
        const s = await listen()
        await s.sayInterim(JOSHUA_24)
        expect(s.heard()).toEqual([])
        await s.wait(400)

        expect(s.current()).toBe('Joshua 24:1')
        expect(s.live()).toBe('Joshua 24:1')
    })

    it('choosing a heard verse makes it current without putting it up', async () => {
        const s = await listen()
        await s.say(JOSHUA_24)
        await s.say(JUDGES_2)
        await act(async () => {
            await s.state.setCurrentDetectedVerse(s.heardVerse('Joshua 24:1')!)
        })

        expect(s.current()).toBe('Joshua 24:1')
        expect(s.state.currentScripture?.label).toBe('Joshua 24:1')
        expect(s.live()).toBe('Judges 2:1')
    })
})
