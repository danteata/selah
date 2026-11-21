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
            if (process.env.SCENARIO_DEBUG) {
                console.error(`said ${JSON.stringify(text.slice(0, 50))} q=${h.semanticQueue.length} → heard=${JSON.stringify(api.heard())} current=${api.current()} live=${api.live()} scripture=${hook.result.current.currentScripture?.label}`)
            }
        },
        /** A provisional (interim) result, which is acted on after a short debounce. */
        async sayInterim(text: string) {
            await act(async () => {
                h.transcription.opts!.onResult!(text, false)
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
    h.transcription.opts = null
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
        await s.say(FILLER)
        await s.wait(61 * SECOND)
        await s.say('Go back to John 3:16 with me.')

        expect(s.current()).toBe('John 3:16')
        expect(s.live()).toBe('John 3:16')
    })
})

// Phrased so only the detection path sees them, not the voice-command path.
const JOSHUA_24 = 'We see in Joshua chapter 24 that they served the Lord.'
const JUDGES_2 = 'We see in Judges chapter 2 that they forgot the Lord.'
// Long enough to push an earlier mention out of the 1500-character window,
// and without repeats: the listener collapses a phrase said over and over.
const FILLER = Array.from({ length: 1700 / 7 }, (_, i) =>
    ['and', 'then', 'they', 'went', 'home', 'quietly', 'again', 'after', 'supper', 'with', 'friends', 'talking'][i % 12] + ['', 'ly', 's', 'ed'][Math.floor(i / 12) % 4],
).join(' ')

function verse(reference: string, confidence: 'high' | 'medium' | 'low' = 'high') {
    const [, book, chapter, start] = /^(.+) (\d+):(\d+)$/.exec(reference)!
    return {
        raw: reference, reference, book, chapter: Number(chapter), verseStart: Number(start),
        startIndex: 0, endIndex: 0, confidence,
    }
}

describe('sermon listener: behaviour the restructuring must keep', () => {
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

    // Current bug, pinned so the restructuring neither fixes nor worsens it
    // silently: the change_version command's matched text runs to the end of
    // the transcript, and command text is cut from the whole detection window,
    // so nothing said after "read it in the NIV" is detected until it scrolls
    // out of the window.
    it('[current bug] speech after "read it in the NIV" is hidden from detection', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await s.wait(4 * SECOND)
        await s.say('Read it in the NIV.')
        await s.say(JOSHUA_24)

        expect(s.heard()).toEqual(['John 3:16'])
        expect(s.live()).toBe('John 3:16')
    })

    // Current bug, pinned: the famous-phrase table names the book "Psalm",
    // which no lookup knows, so the verse is listed but can never be shown.
    it('[current bug] "the Lord is my shepherd" is heard as Psalm 23:1 and never shown', async () => {
        const s = await listen()
        await s.say('The Lord is my shepherd, I shall not want.')

        expect(s.heard()).toEqual(['Psalm 23:1'])
        expect(s.live()).toBeNull()
    })

    it('"display it" puts the current verse up when auto-display is off', async () => {
        const s = await listen({ autoDisplay: false })
        await s.say(JOSHUA_24)
        expect(s.live()).toBeNull()
        await s.say('Display it.')

        expect(s.live()).toBe('Joshua 24:1')
    })

    it('"previous verse" steps back in place', async () => {
        const s = await listen()
        await s.say('Turn with me to John 3:16.')
        await s.wait(4 * SECOND)
        await s.say('Previous verse.')

        expect(s.current()).toBe('John 3:15')
        expect(s.live()).toBe('John 3:15')
        expect(s.queued()).toEqual(['John 3:15'])
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

    it('a semantic match cannot collapse a range already on screen', async () => {
        const s = await listen()
        await s.say('We see in Psalm 34 verses 7 through 8 that the angel of the Lord is near.')
        expect(s.live()).toBe('Psalms 34:7-8')

        await s.wait(5 * SECOND)
        s.semanticWillMatch({ reference: 'Psalms 34:7', score: 0.70, text: 'the angel of the lord encampeth round about them' })
        await s.say('The angel of the Lord encamps round about them that fear him.')

        expect(s.current()).toBe('Psalms 34:7-8')
        expect(s.live()).toBe('Psalms 34:7-8')
    })

    it('a semantic result that lands after a newer explicit reference is listed but not shown', async () => {
        const s = await listen()
        h.semanticDelay = SECOND
        s.semanticWillMatch({ reference: 'John 3:16', score: 0.82, text: 'for god so loved the world, the scripture says' })
        await s.say('The scripture says for God so loved the world that he gave his only son.')
        await s.say(JOSHUA_24)
        await s.wait(2 * SECOND)

        expect(s.heard()).toContain('John 3:16')
        expect(s.current()).toBe('Joshua 24:1')
        expect(s.live()).toBe('Joshua 24:1')
    })

    it('a weaker semantic match in a chapter already heard is not added', async () => {
        const s = await listen()
        s.semanticWillMatch({ reference: 'Psalms 23:1', score: 0.80, text: 'the scripture says the shepherd provides' })
        await s.say('The scripture says the shepherd provides everything his sheep need.')
        await s.wait(5 * SECOND)
        s.semanticWillMatch({ reference: 'Psalms 23:4', score: 0.82, text: 'the scripture says even in the dark valley' })
        await s.say('The scripture says even in the darkest valley he is with us.')

        expect(s.heard()).toEqual(['Psalms 23:1'])
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

    it('an LLM answer that lands after a newer explicit reference is listed but not shown', async () => {
        const s = await listen()
        h.llmConfigured = true
        h.llmDelay = 2 * SECOND
        h.llmResult = [verse('Romans 8:28')]
        await s.say('All things work together for good to them that love God.')
        await s.wait(3600)
        await s.say(JOSHUA_24)
        await s.wait(2 * SECOND)

        expect(s.heard()).toContain('Romans 8:28')
        expect(s.current()).toBe('Joshua 24:1')
        expect(s.live()).toBe('Joshua 24:1')
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

    it('a semantic verse heard again after a silence comes back on screen', async () => {
        const s = await listen()
        s.semanticWillMatch({ reference: 'John 3:16', score: 0.82, text: 'for god so loved the world, the scripture says' })
        await s.say('The scripture says for God so loved the world that he gave his only son.')
        await s.say('Turn with me to Romans 8:28.')
        expect(s.live()).toBe('Romans 8:28')

        await s.say(FILLER)
        await s.wait(61 * SECOND)
        s.semanticWillMatch({ reference: 'John 3:16', score: 0.80, text: 'for god so loved the world, the scripture says' })
        await s.say('The scripture says for God so loved the world, remember.')

        expect(s.current()).toBe('John 3:16')
        expect(s.live()).toBe('John 3:16')
    })
})
