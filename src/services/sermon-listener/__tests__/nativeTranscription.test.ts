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
        expect(invokeMock).toHaveBeenCalledWith('start_capture_with_vad', {
            captureType: 'microphone',
            deviceName: undefined,
        })

        // Simulate a transcription-result event reaching the listener.
        const handler = listenMock.mock.calls[0][1] as (e: { payload: { text: string } }) => void
        handler({ payload: { text: 'For God so loved the world' } })
        expect(onResult).toHaveBeenCalledWith('For God so loved the world')
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
