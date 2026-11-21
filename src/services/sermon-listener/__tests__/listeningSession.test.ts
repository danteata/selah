/**
 * The listening session through its own interface, with a fake engine and
 * fake side effects. Fake timers stand in for the clock, the watchdog, the
 * free-plan cap and the saved-copy cadence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    createListeningSession,
    FREE_RUN_LIMIT_MS,
    SAVED_COPY_INTERVAL_MS,
    type ListeningConfig,
    type ListeningNotice,
    type ListeningSession,
} from '../listeningSession'
import type { EngineEvent, EngineSegment, TranscriptionEngine } from '../transcriptionEngine'
import { AnalyticsEventType } from '../../analytics/types'

const SECOND = 1000
const MINUTE = 60 * SECOND

function fakeEngine(provider: 'web-speech' | 'native') {
    const engine = {
        provider,
        available: true,
        /** What the next start() resolves to; false is a refusal. */
        startResults: [] as boolean[],
        starts: 0,
        stops: 0,
        /** How long stop() takes to finish (a native drain). */
        stopTakes: 0,
        busy: false,
        emit: null as ((e: EngineEvent) => void) | null,
        log: [] as string[],
    }
    const api: TranscriptionEngine = {
        provider,
        isAvailable: async () => engine.available,
        start: async (_options, onEvent) => {
            engine.starts++
            engine.log.push('start')
            const ok = engine.startResults.shift() ?? true
            if (!ok) return false
            engine.emit = onEvent
            engine.busy = true
            onEvent({ type: 'started' })
            return true
        },
        stop: async () => {
            engine.stops++
            engine.log.push('stop')
            if (engine.stopTakes) await new Promise((r) => setTimeout(r, engine.stopTakes))
            engine.busy = false
            engine.log.push('stopped')
        },
        isBusy: () => engine.busy,
    }
    return { engine, api }
}

function setUp({ isPro = true, recordSessions = false, devRecorder = false } = {}) {
    const native = fakeEngine('native')
    const web = fakeEngine('web-speech')
    const effects = {
        keepAwake: { starts: 0, stops: 0 },
        chimes: [] as string[],
        archive: { started: [] as string[], stops: 0, attached: [] as Array<[string, string]> },
        dev: { starts: 0, sidecars: 0 },
        permissionRefusal: null as string | null,
        lastHeartbeat: 0,
        forgotMicrophone: 0,
    }
    const session: ListeningSession = createListeningSession({
        engines: { native: native.api, 'web-speech': web.api },
        keepAwake: {
            start: async () => { effects.keepAwake.starts++ },
            stop: async () => { effects.keepAwake.stops++ },
        },
        chime: { start: () => effects.chimes.push('start'), stop: () => effects.chimes.push('stop') },
        archive: {
            start: async (id) => { effects.archive.started.push(id); return '/rec.wav' },
            stop: async () => { effects.archive.stops++ },
            attachTranscript: async (id, text) => { effects.archive.attached.push([id, text]) },
        },
        devRecorder: devRecorder
            ? {
                start: async () => { effects.dev.starts++ },
                stop: async () => ({ sessionId: 'dev-1', startedAt: 1 }),
                writeSidecar: async () => { effects.dev.sidecars++ },
            }
            : null,
        capturePermission: async () => effects.permissionRefusal,
        unlockAudio: async () => {},
        audioSignal: { isStale: (ms) => Date.now() - effects.lastHeartbeat > ms },
        forgetMicrophone: () => { effects.forgotMicrophone++ },
    }, 'native')

    const config: ListeningConfig = { language: 'en-US', initialPrompt: '', worshipMode: false, recordSessions, isPro }
    const heard: Array<[string, string, boolean]> = []
    const tracked: Array<[AnalyticsEventType, Record<string, unknown>]> = []
    const notices: ListeningNotice[] = []
    const savedCopy = { creates: [] as Array<{ transcript: string; title: string }>, updates: [] as Array<[string, string]>, createTakes: 0 }
    let captureStops = 0
    session.connect({
        config: () => config,
        hear: (text, chunk, committed) => heard.push([text, chunk, committed]),
        captureStopped: () => { captureStops++ },
        track: (event, props) => tracked.push([event, props]),
        notify: (n) => notices.push(n),
        transcripts: {
            create: async (data) => {
                if (savedCopy.createTakes) await new Promise((r) => setTimeout(r, savedCopy.createTakes))
                savedCopy.creates.push({ transcript: data.transcript, title: data.title })
                return `copy-${savedCopy.creates.length}`
            },
            update: async (id, data) => { savedCopy.updates.push([id, data.transcript]) },
        },
        savedCopyDetails: () => ({ detectedVerses: [] }),
    })

    const say = (text: string, segments?: EngineSegment[]) =>
        native.engine.emit!({ type: 'result', text, isFinal: true, segments })
    /** Keep the audio heartbeat fresh, as a live capture does. */
    const beat = () => { effects.lastHeartbeat = Date.now() }

    return {
        session, native: native.engine, web: web.engine, effects, config, heard, tracked, notices, savedCopy, say, beat,
        get captureStops() { return captureStops },
        async ready() {
            await session.checkAvailability('native', { isDesktop: true })
        },
        async listen() {
            await this.ready()
            return session.start()
        },
        status: () => session.getSnapshot().status,
        transcript: () => session.getTranscript().getSnapshot(),
        started: () => tracked.filter(([e]) => e === AnalyticsEventType.SERMON_LISTENER_STARTED).length,
    }
}

beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-22T10:00:00Z') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('listening session: starting and stopping a run', () => {
    it('a run starts listening, keeps the device awake, and is tracked once', async () => {
        const t = setUp()
        expect(await t.listen()).toBe(true)
        expect(t.status()).toBe('listening')
        expect(t.effects.keepAwake.starts).toBe(1)
        expect(t.effects.chimes).toEqual(['start'])
        expect(t.started()).toBe(1)
    })

    it('a Start pressed before the engine check has answered waits for it', async () => {
        const t = setUp()
        void t.session.checkAvailability('native', { isDesktop: true })
        expect(await t.session.start()).toBe(true)
    })

    it('falls back to web speech when the native engine is missing, and says so on the desktop', async () => {
        const t = setUp()
        t.native.available = false
        await t.session.checkAvailability('native', { isDesktop: true })
        expect(t.session.getSnapshot()).toMatchObject({ provider: 'web-speech', isSupported: true, providerReady: true })
        expect(t.session.getSnapshot().error?.message).toBe('Native transcription unavailable. Falling back to Web Speech API.')
    })

    it('with no engine at all, Start says so and holds nothing', async () => {
        const t = setUp()
        t.native.available = false
        t.web.available = false
        await t.ready()
        expect(await t.session.start()).toBe(false)
        expect(t.session.getSnapshot().error?.message).toBe('Speech recognition is not supported')
        expect(t.effects.keepAwake.starts).toBe(0)
    })

    it('a refused system-audio permission stops the start with what to do about it', async () => {
        const t = setUp()
        t.effects.permissionRefusal = 'Selah needs Screen & System Audio Recording permission to capture system audio.'
        expect(await t.listen()).toBe(false)
        expect(t.status()).toBe('idle')
        expect(t.session.getSnapshot().error?.code).toBe('screen_capture_denied')
    })

    // Keep-awake was taken before the engine started and never given back
    // when the engine refused.
    it('an engine that refuses to start leaves the device free to sleep', async () => {
        const t = setUp()
        t.native.startResults = [false]
        expect(await t.listen()).toBe(false)
        expect(t.status()).toBe('idle')
        expect(t.effects.keepAwake.stops).toBe(1)
    })

    it('Stop ends the run: capture, keep-awake, the chime and the run analytics', async () => {
        const t = setUp()
        await t.listen()
        t.session.stop()
        expect(t.status()).toBe('idle')
        expect(t.native.stops).toBe(1)
        expect(t.effects.keepAwake.stops).toBe(1)
        expect(t.effects.chimes).toEqual(['start', 'stop'])
        expect(t.captureStops).toBe(1)
        expect(t.tracked.map(([e]) => e)).toContain(AnalyticsEventType.SERMON_LISTENER_STOPPED)
    })

    it('a Stop while the engine is still starting means nothing goes live', async () => {
        const t = setUp()
        await t.ready()
        const starting = t.session.start()
        t.session.stop()
        await starting
        expect(t.status()).toBe('idle')
    })
})

describe('listening session: when the engine fails', () => {
    // Keep-awake held and the archive recording left running behind a
    // listener that had stopped — recording a room the UI said it wasn't.
    it('ends the run: the recording stops with its transcript, and the device may sleep', async () => {
        const t = setUp({ recordSessions: true })
        await t.listen()
        t.say('Let us pray.')
        t.native.emit!({ type: 'failed', error: { code: 'internal_error', message: 'Transcription is failing: boom', retryable: false } })
        await vi.advanceTimersByTimeAsync(0)

        expect(t.status()).toBe('idle')
        expect(t.session.getSnapshot().error?.message).toBe('Transcription is failing: boom')
        expect(t.effects.archive.stops).toBe(1)
        expect(t.effects.archive.attached).toEqual([[t.effects.archive.started[0], 'Let us pray.']])
        expect(t.effects.keepAwake.stops).toBe(1)
    })

    it('reports what happened to the capture stream', async () => {
        const t = setUp()
        await t.listen()
        t.native.emit!({ type: 'capture', status: 'lost', attempt: 2, message: 'unplugged' })
        expect(t.session.getSnapshot().error).toMatchObject({ code: 'capture_stream_lost', retryable: true })
        t.native.emit!({ type: 'capture', status: 'recovered', attempt: 2, message: 'back' })
        expect(t.session.getSnapshot().error).toBeNull()
        t.native.emit!({ type: 'capture', status: 'fell-back', from: 'Desk feed', message: 'gone' })
        expect(t.effects.forgotMicrophone).toBe(1)
        t.native.emit!({ type: 'capture', status: 'fatal', message: 'Failed to build input stream' })
        expect(t.session.getSnapshot().error).toMatchObject({ code: 'capture_stream_lost', retryable: false })
        expect(t.notices).toEqual([{ type: 'microphone-reconnected' }, { type: 'microphone-fell-back', from: 'Desk feed' }])
    })
})

describe('listening session: restarting a capture that died', () => {
    /** Listening, with the watchdog having seen the heartbeat flow once — then it stops. */
    async function listenWithHeartbeat(t: ReturnType<typeof setUp>) {
        await t.listen()
        await vi.advanceTimersByTimeAsync(2 * SECOND)
        t.beat()
        await vi.advanceTimersByTimeAsync(SECOND) // the watchdog's first look: flowing
    }

    it('restarts the capture inside the same run: no new run, recording or chime', async () => {
        const t = setUp({ recordSessions: true })
        await listenWithHeartbeat(t)
        await vi.advanceTimersByTimeAsync(12 * SECOND) // the heartbeat has stopped

        expect(t.native.starts).toBe(2)
        expect(t.status()).toBe('listening')
        expect(t.started()).toBe(1)
        expect(t.effects.archive.started).toHaveLength(1)
        expect(t.effects.chimes).toEqual(['start'])
    })

    // The native engine refuses, silently, to start while still draining, so
    // a restart that didn't wait left listening off with no error.
    it('waits for the dead capture to finish stopping before starting again', async () => {
        const t = setUp()
        await listenWithHeartbeat(t)
        t.native.stopTakes = 2 * SECOND
        await vi.advanceTimersByTimeAsync(15 * SECOND)
        expect(t.native.log.slice(1)).toEqual(['stop', 'stopped', 'start'])
    })

    it('a restart that fails ends the run and says why', async () => {
        const t = setUp()
        await listenWithHeartbeat(t)
        t.native.startResults = [false]
        await vi.advanceTimersByTimeAsync(12 * SECOND)

        expect(t.status()).toBe('idle')
        expect(t.session.getSnapshot().error).toMatchObject({ code: 'capture_stream_lost', retryable: false })
        expect(t.effects.keepAwake.stops).toBe(1)
    })

    // Segment times are relative to each capture, so after a restart they went
    // back to zero.
    it('segment times carry on from the run after a restart', async () => {
        const t = setUp()
        await listenWithHeartbeat(t)
        t.say('Before.', [{ startMs: 1000, endMs: 2000, text: 'Before.' }])
        await vi.advanceTimersByTimeAsync(12 * SECOND)
        t.say('After.', [{ startMs: 1000, endMs: 2000, text: 'After.' }])

        const [before, after] = t.transcript().segments
        expect(before.startMs).toBe(1000)
        expect(after.startMs).toBeGreaterThan(before.endMs)
    })

    // Each restart used to reset the 40-minute clock.
    it('a restart does not restart the free-plan clock', async () => {
        const t = setUp({ isPro: false })
        await listenWithHeartbeat(t)
        await vi.advanceTimersByTimeAsync(12 * SECOND) // restarted
        t.beat()
        await vi.advanceTimersByTimeAsync(FREE_RUN_LIMIT_MS - 15 * SECOND + 100)

        expect(t.status()).toBe('idle')
        expect(t.notices).toContainEqual({ type: 'free-plan-limit' })
    })
})

describe('listening session: the free plan', () => {
    it('stops a run at 40 minutes, and says why', async () => {
        const t = setUp({ isPro: false })
        await t.listen()
        await vi.advanceTimersByTimeAsync(FREE_RUN_LIMIT_MS - SECOND)
        expect(t.status()).toBe('listening')
        await vi.advanceTimersByTimeAsync(SECOND)
        expect(t.status()).toBe('idle')
        expect(t.notices).toEqual([{ type: 'free-plan-limit' }])
    })

    it('Pro is unlimited, even when it was decided after the run began', async () => {
        const t = setUp({ isPro: false })
        await t.listen()
        t.config.isPro = true
        await vi.advanceTimersByTimeAsync(FREE_RUN_LIMIT_MS + MINUTE)
        expect(t.status()).toBe('listening')
    })
})

describe('listening session: the team\'s saved copy', () => {
    it('is saved every few minutes while listening and at each stop, as one copy', async () => {
        const t = setUp()
        await t.listen()
        t.say('In the beginning.')
        await vi.advanceTimersByTimeAsync(SAVED_COPY_INTERVAL_MS)
        t.say('God created.')
        t.session.stop()
        await vi.advanceTimersByTimeAsync(0)

        expect(t.savedCopy.creates.map((c) => c.transcript)).toEqual(['In the beginning.'])
        expect(t.savedCopy.updates).toEqual([['copy-1', 'In the beginning. God created.']])
        expect(t.session.getSnapshot().savedTranscriptId).toBe('copy-1')
    })

    it('is not saved again when nothing new was said', async () => {
        const t = setUp()
        await t.listen()
        t.say('In the beginning.')
        await vi.advanceTimersByTimeAsync(2 * SAVED_COPY_INTERVAL_MS)
        t.session.stop()
        await vi.advanceTimersByTimeAsync(0)
        expect(t.savedCopy.creates).toHaveLength(1)
        expect(t.savedCopy.updates).toHaveLength(0)
    })

    it('carries on across runs, and a clear starts a new copy', async () => {
        const t = setUp()
        await t.listen()
        t.say('First run.')
        t.session.stop()
        await t.session.start()
        t.say('Second run.')
        t.session.stop()
        await vi.advanceTimersByTimeAsync(0)
        t.session.clear()
        await t.session.start()
        t.say('New session.')
        t.session.stop()
        await vi.advanceTimersByTimeAsync(0)

        expect(t.savedCopy.creates.map((c) => c.transcript)).toEqual(['First run.', 'New session.'])
        expect(t.savedCopy.updates).toEqual([['copy-1', 'First run. Second run.']])
    })

    it('saves one at a time: a save behind a slow create updates what it made', async () => {
        const t = setUp()
        t.savedCopy.createTakes = 10 * SECOND
        await t.listen()
        t.say('One.')
        await vi.advanceTimersByTimeAsync(SAVED_COPY_INTERVAL_MS)
        t.say('Two words.')
        t.session.stop()
        await vi.advanceTimersByTimeAsync(20 * SECOND)
        expect(t.savedCopy.creates).toHaveLength(1)
        expect(t.savedCopy.updates).toEqual([['copy-1', 'One. Two words.']])
    })

    it('is named after the title being typed', async () => {
        const t = setUp()
        t.session.setTitle('Sunday morning')
        await t.listen()
        t.say('Hello.')
        t.session.stop()
        await vi.advanceTimersByTimeAsync(0)
        expect(t.savedCopy.creates[0].title).toBe('Sunday morning')
    })
})

describe('listening session: the transcript', () => {
    it('hands each utterance to the follower; an interim only once the words settle', async () => {
        const t = setUp()
        await t.listen()
        t.native.emit!({ type: 'result', text: 'Turn with', isFinal: false })
        expect(t.heard).toEqual([])
        await vi.advanceTimersByTimeAsync(300)
        t.say('Turn with me to John 3:16.')
        expect(t.heard).toEqual([
            ['Turn with', 'Turn with', false],
            ['Turn with me to John 3:16.', 'Turn with me to John 3:16.', true],
        ])
    })

    it('a final cancels the interim pass still waiting', async () => {
        const t = setUp()
        await t.listen()
        t.native.emit!({ type: 'result', text: 'Turn with', isFinal: false })
        t.say('Turn with me to John 3:16.')
        await vi.advanceTimersByTimeAsync(300)
        expect(t.heard).toHaveLength(1)
    })

    // A reload's restore landing late used to replace what had been heard since.
    it('a restore after a reload never overwrites what this session has heard', async () => {
        const t = setUp()
        await t.listen()
        t.say('Live words.')
        expect(t.session.restore({ text: 'Saved before the reload.' })).toBe(false)
        expect(t.transcript().text).toBe('Live words.')
    })

    it('a clear starts a new transcript and keeps listening', async () => {
        const t = setUp()
        await t.listen()
        t.say('Old words.')
        t.session.clear()
        t.say('New words.')
        expect(t.transcript().text).toBe('New words.')
        expect(t.status()).toBe('listening')
    })
})

describe('listening session: the dev accuracy recording', () => {
    it('is made for every run, however it ends', async () => {
        const t = setUp({ devRecorder: true })
        await t.listen()
        t.native.emit!({ type: 'failed', error: { code: 'internal_error', message: 'x', retryable: false } })
        await vi.advanceTimersByTimeAsync(0)
        expect(t.effects.dev).toEqual({ starts: 1, sidecars: 1 })
        expect(t.session.getSnapshot().devRecordingsVersion).toBe(1)
    })
})
