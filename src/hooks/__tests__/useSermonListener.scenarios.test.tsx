/**
 * Scenario tests for the sermon listener's scripture following, driven
 * through the hook's own interface.
 *
 * A fake transcriber feeds utterances in, a fake semantic matcher returns
 * scripted matches, and the assertions read only what the rest of the app
 * reads: the heard verses, the current verse and scripture, and the live slide
 * in the real store. Nothing here reaches into the hook's refs, so these
 * scenarios survive the hook being restructured underneath them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Scripture, Slide } from '../../types'
import type { SemanticVerseMatch } from '../../services/sermon-listener'

const h = vi.hoisted(() => {
    type Opts = {
        onStart?: () => void
        onResult?: (text: string, isFinal: boolean) => void
    }
    const transcription = {
        opts: null as Opts | null,
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
        slideCounter: 0,
        recordings: { started: [] as string[], stopped: 0, attached: [] as Array<[string, string]> },
        recordingResult: '/tmp/rec.wav' as string | null,
        providerAvailable: true,
    }
})

vi.mock('../../services/sermon-listener', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/sermon-listener')>()
    const fakeDetector = {
        initialize: async () => ({ ready: true }),
        addText: async () => h.semanticQueue.shift() ?? null,
        setReadingContext: (book: string | null, chapter?: number, verse?: number) => {
            h.readingContexts.push([book, chapter, verse])
        },
    }
    return {
        ...actual,
        unifiedTranscriptionService: {
            isProviderAvailable: async () => h.providerAvailable,
            setProvider: async () => true,
            getStatus: () => ({ isListening: h.transcription.listening }),
            getMediaStream: () => null,
            clearTranscript: () => {},
            start: async (opts: { onStart?: () => void }) => {
                h.transcription.opts = opts
                h.transcription.listening = true
                opts.onStart?.()
                return true
            },
            stop: async () => {
                h.transcription.listening = false
            },
        },
        getSemanticDetector: () => fakeDetector,
        initializeEmbedder: async () => {},
    }
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
vi.mock('../../services/sermon-listener/llmClient', () => ({ isLlmConfigured: () => false }))
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

async function listen(options: SermonListenerOptions = {}) {
    const hook = renderHook(() =>
        useSermonListener({ autoLookup: true, autoDisplay: true, enableSemanticDetection: true, ...options }),
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
                h.transcription.opts!.onResult!(text, true)
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
        current() {
            return hook.result.current.currentVerse?.reference ?? null
        },
        live() {
            const s = useAppStore.getState()
            const slide = s.activeSlides.find((x) => x.id === s.liveSlideId)
            return (slide?.data as Scripture | undefined)?.label ?? null
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
    h.transcription.opts = null
    h.transcription.listening = false
    h.semanticQueue = []
    h.readingContexts = []
    h.idbLive = null
    h.missing = new Set()
    h.slideCounter = 0
    h.recordings = { started: [], stopped: 0, attached: [] }
    h.recordingResult = '/tmp/rec.wav'
    h.providerAvailable = true
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

beforeEach(() => {
    // The hook narrates every utterance; keep test output to the failures.
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

function setSermonSettings(patch: Record<string, unknown>) {
    const s = useAppStore.getState()
    useAppStore.setState({ settings: { ...s.settings, sermonListener: { ...s.settings.sermonListener, ...patch } } as typeof s.settings })
}

describe('sermon listener: starting and stopping', () => {
    // The one path into start()'s own readiness check: no provider was
    // available on mount, then one was chosen. That check used to invoke
    // `check_whisper_ready`, which no longer exists, so Start always failed.
    it('starts after a provider is chosen when none was available on mount', async () => {
        h.providerAvailable = false
        const hook = renderHook(() => useSermonListener({ autoDisplay: true }))
        await flush()
        expect(hook.result.current.isSupported).toBe(false)

        h.providerAvailable = true
        await act(async () => {
            await hook.result.current.setProvider('native')
        })
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

    it('records nothing unless the church turned recording on', async () => {
        const s = await listen()
        await act(async () => {
            s.state.stop()
        })
        await s.wait(0)
        expect(h.recordings.started).toHaveLength(0)
        expect(h.recordings.stopped).toBe(0)
    })
})

describe('sermon listener: explicit references', () => {
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

    // Current behaviour, pinned rather than endorsed: almost any spoken
    // reference ("John 3:16 says", "turn with me to …") is also read as a
    // go-to command, and commands put the passage up whatever auto-display says.
    it('a reference phrased as a go-to command goes live even with auto-display off', async () => {
        const s = await listen({ autoDisplay: false })
        await s.say('Turn with me to John 3:16.')

        expect(s.heard()).toEqual(['John 3:16'])
        expect(s.live()).toBe('John 3:16')
    })

    it('a later reference takes over the screen', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await s.say('And now look at Romans 8:28.')

        expect(s.heard()).toEqual(['John 3:16', 'Romans 8:28'])
        expect(s.live()).toBe('Romans 8:28')
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
    it('"verse 15" after a bare chapter announcement resolves into that chapter', async () => {
        const s = await listen()
        await s.say('Joshua 24.')
        await s.say('Verse 15.')

        expect(s.current()).toBe('Joshua 24:15')
        expect(s.live()).toBe('Joshua 24:15')
        // Current behaviour: "Joshua 24." arrives as a command for verse 1
        // (not as a bare chapter), so it is not treated as a placeholder and
        // stays in the list beside the verse actually announced.
        expect(s.heard()).toEqual(['Joshua 24:1', 'Joshua 24:15'])
    })

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

    it('"previous chapter" from the first chapter of a book moves into the book before', async () => {
        const s = await listen()
        await s.say('Exodus 1 verse 5.')
        await s.wait(4 * SECOND)
        await s.say('Previous chapter.')

        expect(s.current()).toBe('Genesis 50:1')
        expect(s.live()).toBe('Genesis 50:1')
    })

    it('a chapter-only mention does not revert a specific verse (Joshua 24:15 → 24:1)', async () => {
        const s = await listen()
        await s.say('Joshua chapter 24 verse 15.')
        await s.wait(10 * SECOND)
        await s.say('We see in Joshua chapter 24 that they served the Lord.')

        expect(s.current()).toBe('Joshua 24:15')
        expect(s.live()).toBe('Joshua 24:15')
    })

    // Current behaviour, pinned rather than endorsed: the same mention phrased
    // so it also reads as a command does revert to verse 1 — the command path
    // has no specificity guard.
    it('a chapter-only mention that reads as a command does revert to verse 1', async () => {
        const s = await listen()
        await s.say('Joshua chapter 24 verse 15.')
        await s.wait(10 * SECOND)
        await s.say('As for me and my house, Joshua chapter 24, we will serve the Lord.')

        expect(s.current()).toBe('Joshua 24:1')
        expect(s.live()).toBe('Joshua 24:1')
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

    it('an already-heard best candidate keeps a novel lower-ranked one off the screen (Deut 6:7 vs 11:19)', async () => {
        const s = await listen()
        await s.say('Deuteronomy 6 verse 7.')
        expect(s.live()).toBe('Deuteronomy 6:7')

        await s.wait(5 * SECOND)
        s.semanticWillMatch(
            { reference: 'Deuteronomy 6:7', score: 0.80, text: 'teach them diligently unto thy children, the word says' },
            { reference: 'Deuteronomy 11:19', score: 0.84, text: 'teach them diligently unto thy children, the word says' },
        )
        await s.say('The word says teach them diligently unto thy children and talk of them.')

        expect(s.live()).toBe('Deuteronomy 6:7')
        expect(s.current()).toBe('Deuteronomy 6:7')
    })

    it('reading an announced chapter is not dropped by the marker floor (Psalm 27)', async () => {
        const s = await listen()
        await s.say('Psalm 27.')
        await s.wait(5 * SECOND)
        s.semanticWillMatch({ reference: 'Psalms 27:1', score: 0.732, text: 'the lord is my light and my salvation whom shall i fear' })
        await s.say('The Lord is my light and my salvation, whom shall I fear.')

        expect(s.heard()).toContain('Psalms 27:1')
    })
})

describe('sermon listener: re-hearing a verse', () => {
    it('a verse said again after a minute of silence comes back on screen', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await s.say('And now look at Romans 8:28.')
        expect(s.live()).toBe('Romans 8:28')

        // Long enough that John 3:16 has scrolled out of the detection window
        // and been silent for over a minute.
        await s.wait(61 * SECOND)
        await s.say('x '.repeat(800))
        await s.wait(61 * SECOND)
        await s.say('Go back to John 3:16 with me.')

        expect(s.current()).toBe('John 3:16')
        expect(s.live()).toBe('John 3:16')
    })
})
