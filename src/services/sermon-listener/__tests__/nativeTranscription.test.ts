import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { invokeMock, listenMock, unlistenMock, getStateMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    listenMock: vi.fn(),
    unlistenMock: vi.fn(),
    getStateMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('@/platform', () => ({ isDesktop: () => true, platform: {} }))
vi.mock('../../../store/appStore', () => ({ useAppStore: { getState: getStateMock } }))

import { nativeTranscriptionService } from '../nativeTranscription'

describe('nativeTranscriptionService', () => {
    beforeEach(() => {
        invokeMock.mockReset()
        listenMock.mockReset().mockResolvedValue(unlistenMock)
        unlistenMock.mockReset()
        getStateMock.mockReturnValue({ settings: { sermonListener: { whisperModel: 'whisper-small.en' } } })
    })
    afterEach(async () => {
        await nativeTranscriptionService.stop()
    })

    it('loads the selected model, sets config, listens, and starts capture', async () => {
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'get_loaded_native_model') return Promise.resolve(null)
            return Promise.resolve(undefined)
        })

        const onResult = vi.fn()
        const started = await nativeTranscriptionService.start({
            language: 'en-US',
            initialPrompt: 'Bible sermon.',
            captureSource: 'microphone',
            onResult,
            onError: vi.fn(),
        })

        expect(started).toBe(true)
        expect(invokeMock).toHaveBeenCalledWith('load_native_model', { modelId: 'whisper-small.en' })
        expect(invokeMock).toHaveBeenCalledWith('set_native_transcription_config', {
            language: 'en',
            initialPrompt: 'Bible sermon.',
            translate: false,
        })
        expect(listenMock).toHaveBeenCalledWith('transcription-result', expect.any(Function))
        expect(listenMock).toHaveBeenCalledWith('native-stream-text', expect.any(Function))
        expect(invokeMock).toHaveBeenCalledWith('start_capture_with_vad', {
            captureType: 'microphone',
            deviceName: undefined,
        })

        // Simulate a transcription-result (final) event reaching the listener.
        const finalHandler = listenMock.mock.calls[0][1] as (e: { payload: { text: string } }) => void
        finalHandler({ payload: { text: 'For God so loved the world' } })
        // No segments in the payload → the segments argument is omitted rather
        // than forwarded as an empty array.
        expect(onResult).toHaveBeenCalledWith('For God so loved the world', true, undefined)
    })

    it('forwards segment timings from transcription-result when the model supplies them', async () => {
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'get_loaded_native_model') return Promise.resolve(null)
            return Promise.resolve(undefined)
        })

        const onResult = vi.fn()
        await nativeTranscriptionService.start({ onResult, onError: vi.fn() })

        const finalHandler = listenMock.mock.calls[0][1] as (e: { payload: unknown }) => void
        // Times are session-absolute seconds; Rust has already applied the
        // utterance's start_offset_ms.
        const segments = [
            { start: 12.5, end: 14.0, text: 'For God so loved the world' },
            { start: 14.0, end: 16.25, text: 'that he gave his only Son' },
        ]
        finalHandler({
            payload: { text: 'For God so loved the world that he gave his only Son', segments },
        })
        expect(onResult).toHaveBeenCalledWith(
            'For God so loved the world that he gave his only Son',
            true,
            segments,
        )
    })

    it('falls back to the bundled model when the selected one cannot be loaded', async () => {
        // A saved selection can outlive the model on disk (deleted, or a synced
        // profile naming a model this install never downloaded). That must not
        // fail the session.
        invokeMock.mockImplementation((cmd: string, args?: { modelId?: string }) => {
            if (cmd === 'get_loaded_native_model') return Promise.resolve(null)
            if (cmd === 'load_native_model' && args?.modelId === 'whisper-small.en') {
                return Promise.reject(new Error('model not downloaded'))
            }
            return Promise.resolve(undefined)
        })

        const onError = vi.fn()
        const started = await nativeTranscriptionService.start({ onResult: vi.fn(), onError })

        expect(started).toBe(true)
        expect(onError).not.toHaveBeenCalled()
        expect(invokeMock).toHaveBeenCalledWith('load_native_model', {
            modelId: 'moonshine-streaming-small',
        })
    })

    it('forwards native-stream-text events as interim (isFinal=false) results', async () => {
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'get_loaded_native_model') return Promise.resolve(null)
            return Promise.resolve(undefined)
        })

        const onResult = vi.fn()
        await nativeTranscriptionService.start({ onResult, onError: vi.fn() })

        const streamHandler = listenMock.mock.calls[1][1] as (e: {
            payload: { committed: string; tentative: string }
        }) => void
        streamHandler({ payload: { committed: 'For God so ', tentative: 'loved' } })
        expect(onResult).toHaveBeenCalledWith('For God so loved', false)
    })

    it('skips reload when the model is already loaded', async () => {
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'get_loaded_native_model') return Promise.resolve('whisper-small.en')
            return Promise.resolve(undefined)
        })
        await nativeTranscriptionService.start({ onResult: vi.fn(), onError: vi.fn() })
        expect(invokeMock).not.toHaveBeenCalledWith('load_native_model', expect.anything())
    })

    it('reports errors and does not start', async () => {
        // Every load fails here — including the bundled fallback — so there is
        // nothing left to fall back to and the error must surface.
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'get_loaded_native_model') return Promise.resolve(null)
            if (cmd === 'load_native_model') return Promise.reject(new Error('model not downloaded'))
            return Promise.resolve(undefined)
        })
        const onError = vi.fn()
        const started = await nativeTranscriptionService.start({ onResult: vi.fn(), onError })
        expect(started).toBe(false)
        expect(onError).toHaveBeenCalledWith('model not downloaded')
    })

    it('stop() invokes stop_capture and unlistens', async () => {
        invokeMock.mockImplementation((cmd: string) =>
            cmd === 'get_loaded_native_model' ? Promise.resolve('whisper-small.en') : Promise.resolve(undefined),
        )
        await nativeTranscriptionService.start({ onResult: vi.fn(), onError: vi.fn() })
        invokeMock.mockClear()
        await nativeTranscriptionService.stop()
        expect(invokeMock).toHaveBeenCalledWith('stop_capture')
        expect(unlistenMock).toHaveBeenCalled()
    })
})
