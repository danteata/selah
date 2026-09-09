import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { startMock, stopMock, isBusyMock, isConfiguredMock, isDesktopMock, getStateMock } =
    vi.hoisted(() => ({
        startMock: vi.fn(),
        stopMock: vi.fn(),
        isBusyMock: vi.fn(),
        isConfiguredMock: vi.fn(),
        isDesktopMock: vi.fn(),
        getStateMock: vi.fn(),
    }))

vi.mock('../../sermon-listener/nativeTranscription', () => ({
    default: {
        start: startMock,
        stop: stopMock,
        // `isBusy()`, not `getIsRunning()`: the engine is unavailable while it
        // is still draining a previous session, and voice search must see that.
        isBusy: isBusyMock,
        isConfigured: isConfiguredMock,
    },
}))
vi.mock('../../../platform', () => ({ isDesktop: isDesktopMock }))
vi.mock('../../../store/appStore', () => ({ useAppStore: { getState: getStateMock } }))

import {
    nativeVoiceSearchAvailability,
    normalizeQuery,
    startNativeVoiceSearch,
} from '../nativeVoiceSearch'

/** Hand the last `start()` call's callbacks back so a test can drive them. */
function engineCallbacks() {
    return startMock.mock.calls[startMock.mock.calls.length - 1][0]
}

describe('normalizeQuery', () => {
    it('strips the sentence punctuation speech engines add', () => {
        expect(normalizeQuery('Amazing Grace.')).toBe('Amazing Grace')
        expect(normalizeQuery('what is love?')).toBe('what is love')
        expect(normalizeQuery('Psalm 23,  ')).toBe('Psalm 23')
    })

    it('keeps the colon in a Bible reference', () => {
        // The whole point of stripping only *trailing* punctuation: this colon
        // is what makes the reference parse.
        expect(normalizeQuery('John 3:16.')).toBe('John 3:16')
    })
})

describe('nativeVoiceSearchAvailability', () => {
    beforeEach(() => {
        isDesktopMock.mockReturnValue(true)
        isConfiguredMock.mockReturnValue(true)
        isBusyMock.mockReturnValue(false)
    })

    it('is unsupported in the browser build', () => {
        isDesktopMock.mockReturnValue(false)
        expect(nativeVoiceSearchAvailability()).toBe('unsupported')
    })

    it('is busy while the engine is held', () => {
        // The sermon listener owns the engine for the length of a service,
        // which is exactly when someone reaches for voice search. `busy` is an
        // expected answer, not a failure — the caller falls back to Web Speech.
        isBusyMock.mockReturnValue(true)
        expect(nativeVoiceSearchAvailability()).toBe('busy')
    })

    it('is available on an idle desktop engine', () => {
        expect(nativeVoiceSearchAvailability()).toBe('available')
    })
})

describe('startNativeVoiceSearch', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        startMock.mockReset().mockResolvedValue(true)
        stopMock.mockReset().mockResolvedValue(undefined)
        isBusyMock.mockReset().mockReturnValue(false)
        isConfiguredMock.mockReset().mockReturnValue(true)
        isDesktopMock.mockReset().mockReturnValue(true)
        getStateMock.mockReturnValue({
            settings: {
                dictation: { model: 'moonshine-streaming-small' },
                sermonListener: { selectedMicrophoneId: 'Desk Mic' },
            },
        })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('refuses when the engine is busy, without touching it', async () => {
        isBusyMock.mockReturnValue(true)

        const session = await startNativeVoiceSearch({
            onInterim: vi.fn(),
            onFinal: vi.fn(),
            onError: vi.fn(),
        })

        expect(session).toBeNull()
        expect(startMock).not.toHaveBeenCalled()
    })

    it('runs on the dictation model and inherits the listener microphone', async () => {
        await startNativeVoiceSearch({
            onInterim: vi.fn(),
            onFinal: vi.fn(),
            onError: vi.fn(),
        })

        expect(startMock).toHaveBeenCalledWith(
            expect.objectContaining({
                modelId: 'moonshine-streaming-small',
                microphoneDeviceId: 'Desk Mic',
                captureSource: 'microphone',
            }),
        )
    })

    it('commits the first utterance and stops, draining for the flushed tail', async () => {
        const onFinal = vi.fn()
        await startNativeVoiceSearch({ onInterim: vi.fn(), onFinal, onError: vi.fn() })

        engineCallbacks().onResult('John 3:16.', true)
        await vi.runOnlyPendingTimersAsync()

        // Punctuation stripped, and the drain is non-zero — for a two-word
        // query the pending VAD segment is the entire search.
        expect(onFinal).toHaveBeenCalledWith('John 3:16')
        expect(stopMock).toHaveBeenCalledWith(expect.any(Number))
        expect(stopMock.mock.calls[0][0]).toBeGreaterThan(0)
    })

    it('reports interim text without ending the session', async () => {
        const onInterim = vi.fn()
        const onFinal = vi.fn()
        await startNativeVoiceSearch({ onInterim, onFinal, onError: vi.fn() })

        engineCallbacks().onResult('amazing gr', false)

        expect(onInterim).toHaveBeenCalledWith('amazing gr')
        expect(onFinal).not.toHaveBeenCalled()
        expect(stopMock).not.toHaveBeenCalled()
    })

    it('keeps listening past the first utterance when continuous', async () => {
        const onFinal = vi.fn()
        await startNativeVoiceSearch({
            continuous: true,
            onInterim: vi.fn(),
            onFinal,
            onError: vi.fn(),
        })

        engineCallbacks().onResult('first', true)

        expect(onFinal).not.toHaveBeenCalled()
        expect(stopMock).not.toHaveBeenCalled()
    })

    it('joins every utterance heard in a continuous session', async () => {
        const onFinal = vi.fn()
        const session = await startNativeVoiceSearch({
            continuous: true,
            onInterim: vi.fn(),
            onFinal,
            onError: vi.fn(),
        })

        engineCallbacks().onResult('amazing', true)
        engineCallbacks().onResult('grace.', true)
        await session!.stop()

        expect(onFinal).toHaveBeenCalledWith('amazing grace')
    })

    it('gives up after a silence budget rather than holding the microphone', async () => {
        const onError = vi.fn()
        await startNativeVoiceSearch({ onInterim: vi.fn(), onFinal: vi.fn(), onError })

        await vi.advanceTimersByTimeAsync(7000)

        expect(onError).toHaveBeenCalledWith(expect.stringContaining('No speech'))
        expect(stopMock).toHaveBeenCalled()
    })

    it('says nothing when the caller stops an empty session', async () => {
        // The operator clicked the mic and changed their mind. That is not an
        // error and should not put a message on screen.
        const onError = vi.fn()
        const onFinal = vi.fn()
        const session = await startNativeVoiceSearch({
            onInterim: vi.fn(),
            onFinal,
            onError,
        })

        await session!.stop()

        expect(onError).not.toHaveBeenCalled()
        expect(onFinal).not.toHaveBeenCalled()
        expect(stopMock).toHaveBeenCalled()
    })

    it('reports once when a result and a stop race', async () => {
        const onFinal = vi.fn()
        const session = await startNativeVoiceSearch({
            onInterim: vi.fn(),
            onFinal,
            onError: vi.fn(),
        })

        engineCallbacks().onResult('psalm 23', true)
        await session!.stop()
        await vi.runOnlyPendingTimersAsync()

        expect(onFinal).toHaveBeenCalledTimes(1)
    })

    it('returns null when the engine refuses to start', async () => {
        startMock.mockResolvedValue(false)

        const session = await startNativeVoiceSearch({
            onInterim: vi.fn(),
            onFinal: vi.fn(),
            onError: vi.fn(),
        })

        // Null rather than a dead session, so the caller can fall through to
        // Web Speech instead of leaving a mic button that does nothing.
        expect(session).toBeNull()
    })
})
