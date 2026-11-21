/**
 * The two engines behind the transcription engine seam, each driven through
 * the interface the listener uses. The services underneath are faked; what's
 * checked is the translation — events, timings, and errors as kinds.
 */
import { describe, it, expect, vi } from 'vitest'
import { createNativeEngine, captureStatusOf } from '../nativeEngine'
import { createWebSpeechEngine } from '../webSpeechEngine'
import type { EngineEvent } from '../transcriptionEngine'
import { transcriptionErrorCodes } from '../transcriptionErrors'
import type { CaptureStreamErrorEvent } from '../nativeAudioCapture'
import type { NativeTranscriptionStartOptions } from '../nativeTranscription'
import type { SpeechRecognitionOptions } from '../speechRecognition'

const OPTIONS = { language: 'en-US' }

function nativeFake() {
    const fake = {
        options: null as NativeTranscriptionStartOptions | null,
        busy: false,
        startResult: true,
        stops: 0,
        captureHandler: null as ((e: CaptureStreamErrorEvent) => void) | null,
        unlistened: 0,
        /** Lets a test hold start() open, as a model load does. */
        gate: null as Promise<void> | null,
    }
    const engine = createNativeEngine(
        {
            isConfigured: () => true,
            isBusy: () => fake.busy,
            start: async (options) => {
                fake.options = options
                if (fake.gate) await fake.gate
                fake.busy = fake.startResult
                return fake.startResult
            },
            stop: async () => {
                fake.stops++
                fake.busy = false
            },
        },
        async (handler) => {
            fake.captureHandler = handler
            return () => {
                fake.unlistened++
            }
        },
    )
    return { fake, engine }
}

describe('native engine', () => {
    it('reports started once capture is running, and results with segment times in ms', async () => {
        const { fake, engine } = nativeFake()
        const events: EngineEvent[] = []
        expect(await engine.start(OPTIONS, (e) => events.push(e))).toBe(true)
        fake.options!.onResult('For God so loved the world', true, [{ start: 1.25, end: 2.5, text: 'For God so loved the world' }])

        expect(events).toEqual([
            { type: 'started' },
            { type: 'result', text: 'For God so loved the world', isFinal: true, segments: [{ startMs: 1250, endMs: 2500, text: 'For God so loved the world' }] },
        ])
    })

    it('a stop while the model is still loading wins: nothing goes live', async () => {
        const { fake, engine } = nativeFake()
        let release!: () => void
        fake.gate = new Promise((r) => { release = r })
        const events: EngineEvent[] = []
        const starting = engine.start(OPTIONS, (e) => events.push(e))
        await engine.stop()
        release()

        expect(await starting).toBe(false)
        expect(fake.stops).toBe(1)
        expect(events).toEqual([])
    })

    // A Rust contract: mod.rs returns this code when macOS refused system-audio
    // capture, and the listener offers to open the right Settings page for it.
    it('classifies a failure where it arises', async () => {
        const { fake, engine } = nativeFake()
        const events: EngineEvent[] = []
        await engine.start(OPTIONS, (e) => events.push(e))
        fake.options!.onError('SCREEN_CAPTURE_PERMISSION_DENIED')
        expect(events.at(-1)).toEqual({
            type: 'failed',
            error: { code: transcriptionErrorCodes.SCREEN_CAPTURE_DENIED, message: 'SCREEN_CAPTURE_PERMISSION_DENIED', retryable: false },
        })
    })

    it('passes capture-stream statuses on while listening, and stops listening for them on stop', async () => {
        const { fake, engine } = nativeFake()
        const events: EngineEvent[] = []
        await engine.start(OPTIONS, (e) => events.push(e))
        fake.captureHandler!({ message: 'device gone', attempt: 2, recovered: false, fatal: false })
        await engine.stop()

        expect(events.at(-1)).toEqual({ type: 'capture', status: 'lost', attempt: 2, message: 'device gone' })
        expect(fake.unlistened).toBe(1)
    })
})

describe('capture-stream-error payloads', () => {
    // The Rust struct is serde `rename_all = "camelCase"`: the field arrives as
    // fellBackFrom. It was read as fell_back_from, so a microphone that went
    // missing was reported as "Microphone reconnected" and the stale choice
    // was never cleared.
    it('a fallback to the default microphone is recognised (camelCase on the wire)', () => {
        const payload = JSON.parse('{"message":"\\"Desk feed\\" is no longer available.","attempt":1,"recovered":true,"fatal":false,"fellBackFrom":"Desk feed"}')
        expect(captureStatusOf(payload)).toEqual({ status: 'fell-back', from: 'Desk feed', message: '"Desk feed" is no longer available.' })
    })

    it('fatal, recovered and lost are told apart', () => {
        expect(captureStatusOf({ message: 'gave up', attempt: 5, recovered: false, fatal: true }).status).toBe('fatal')
        expect(captureStatusOf({ message: 'back', attempt: 2, recovered: true, fatal: false }).status).toBe('recovered')
        expect(captureStatusOf({ message: 'dropped', attempt: 1, recovered: false, fatal: false }).status).toBe('lost')
    })
})

function webFake() {
    const fake = { options: null as SpeechRecognitionOptions | null, stops: 0 }
    const engine = createWebSpeechEngine({
        isSupported: () => true,
        start: async (options?: SpeechRecognitionOptions) => {
            fake.options = options ?? null
            return true
        },
        stop: () => {
            fake.stops++
        },
    })
    return { fake, engine }
}

describe('web speech engine', () => {
    it('reports started when recognition does, then results, then the end', async () => {
        const { fake, engine } = webFake()
        const events: EngineEvent[] = []
        await engine.start(OPTIONS, (e) => events.push(e))
        fake.options!.onStart!()
        fake.options!.onResult!('Turn to John 3:16', true, 0.9)
        fake.options!.onEnd!()

        expect(events).toEqual([
            { type: 'started' },
            { type: 'result', text: 'Turn to John 3:16', isFinal: true },
            { type: 'ended' },
        ])
        expect(engine.isBusy()).toBe(false)
    })

    it('reports when speech starts and stops being heard', async () => {
        const { fake, engine } = webFake()
        const events: EngineEvent[] = []
        await engine.start(OPTIONS, (e) => events.push(e))
        fake.options!.onSpeechStart!()
        fake.options!.onSpeechEnd!()
        expect(events).toEqual([{ type: 'speech', active: true }, { type: 'speech', active: false }])
    })

    it('a stop before recognition has started wins: it is stopped as soon as it starts', async () => {
        const { fake, engine } = webFake()
        const events: EngineEvent[] = []
        await engine.start(OPTIONS, (e) => events.push(e))
        await engine.stop()
        fake.options!.onStart!()

        expect(events).toEqual([])
        expect(fake.stops).toBe(1)
    })

    it('classifies a browser error', async () => {
        const { fake, engine } = webFake()
        const events: EngineEvent[] = []
        await engine.start(OPTIONS, (e) => events.push(e))
        fake.options!.onStart!()
        fake.options!.onError!('not-allowed', 'Microphone permission denied.')
        expect(events.at(-1)).toMatchObject({ type: 'failed', error: { code: transcriptionErrorCodes.MICROPHONE_DENIED, retryable: false } })
    })

    it('says it is available when the browser supports recognition', async () => {
        const { engine } = webFake()
        expect(await engine.isAvailable()).toBe(true)
    })
})

describe('the engines module', () => {
    it('has one engine per provider', async () => {
        vi.resetModules()
        const { transcriptionEngines } = await import('../engines')
        expect(Object.keys(transcriptionEngines).sort()).toEqual(['native', 'web-speech'])
        expect(transcriptionEngines.native.provider).toBe('native')
    })
})
