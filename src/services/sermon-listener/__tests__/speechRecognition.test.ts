import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SpeechRecognitionService } from '../speechRecognition'

/** A browser SpeechRecognition the test drives by hand. */
class FakeRecognition {
    static instances: FakeRecognition[] = []
    lang = ''
    continuous = false
    interimResults = false
    maxAlternatives = 1
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onresult: ((e: unknown) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    constructor() { FakeRecognition.instances.push(this) }
    start() { queueMicrotask(() => this.onstart?.()) }
    stop() { queueMicrotask(() => this.onend?.()) }
    abort() { /* handlers detached by the service before aborting */ }
    /** The browser ending recognition on its own. */
    endUnprompted() { this.onend?.() }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]

describe('SpeechRecognitionService session events', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        FakeRecognition.instances = []
        ;(window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    })

    afterEach(() => {
        vi.useRealTimers()
        delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    })

    async function startedService() {
        const onStart = vi.fn()
        const onEnd = vi.fn()
        const service = new SpeechRecognitionService()
        await service.start({ onStart, onEnd, preflightMicPermission: false })
        await vi.advanceTimersByTimeAsync(0)
        return { service, onStart, onEnd }
    }

    it('keeps a browser-initiated restart inside the session', async () => {
        const { onStart, onEnd } = await startedService()
        expect(onStart).toHaveBeenCalledTimes(1)

        latest().endUnprompted()
        await vi.advanceTimersByTimeAsync(5000)

        // Restarted on a fresh instance, without a stop/start reaching the caller.
        expect(FakeRecognition.instances.length).toBeGreaterThan(1)
        expect(onEnd).not.toHaveBeenCalled()
        expect(onStart).toHaveBeenCalledTimes(1)
    })

    it('reports the end once when stopped', async () => {
        const { service, onEnd } = await startedService()
        service.stop()
        await vi.advanceTimersByTimeAsync(0)
        expect(onEnd).toHaveBeenCalledTimes(1)
    })

    it('reports the end when stopped between restarts', async () => {
        const { service, onEnd } = await startedService()
        latest().endUnprompted() // a restart is now pending
        service.stop()
        expect(onEnd).toHaveBeenCalledTimes(1)
    })

    it('detaches a replaced instance, so its late events cannot end the session', async () => {
        await startedService()
        const first = latest()
        first.endUnprompted()
        await vi.advanceTimersByTimeAsync(5000)

        expect(latest()).not.toBe(first)
        expect(first.onend).toBeNull()
        expect(first.onstart).toBeNull()
    })
})
