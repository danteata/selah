import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { invokeMock, listenMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), listenMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('@/platform', () => ({ isDesktop: () => true, platform: {} }))

import {
    listNativeModels,
    downloadNativeModel,
    cancelNativeDownload,
    isNativeModelDownloaded,
    formatModelSize,
    DEFAULT_NATIVE_MODEL_ID,
    type NativeModelStatus,
} from '../nativeModelManager'

const sampleModel: NativeModelStatus = {
    id: 'moonshine-streaming-small',
    name: 'Moonshine Streaming Small (English)',
    description: 'Bundled offline default.',
    engine_type: 'transcribecpp',
    format: 'file',
    filename: 'moonshine-streaming-small-Q8_0.gguf',
    url: 'https://example/moonshine-streaming-small-Q8_0.gguf',
    sha256: 'd03670f69629b649085d0f44a63d97668b4119117cc9611a4e4ad94341713dfc',
    size_bytes: 189 * 1024 * 1024,
    languages: ['en'],
    accuracy: 0.84,
    speed: 0.95,
    supports_translation: false,
    supports_language_selection: false,
    recommended: true,
    bundled: true,
    supports_streaming: true,
    timestamps: 'none',
    legacy: false,
    is_downloaded: true,
    is_downloading: false,
}

describe('nativeModelManager', () => {
    beforeEach(() => {
        invokeMock.mockReset()
        listenMock.mockReset()
    })
    afterEach(() => vi.unstubAllGlobals())

    it('lists models via the Rust command', async () => {
        invokeMock.mockResolvedValue([sampleModel])
        const models = await listNativeModels()
        expect(invokeMock).toHaveBeenCalledWith('list_native_models')
        expect(models[0].id).toBe('moonshine-streaming-small')
    })

    it('returns [] when listing fails', async () => {
        invokeMock.mockRejectedValue(new Error('no command'))
        expect(await listNativeModels()).toEqual([])
    })

    it('passes modelId (camelCase) to download/cancel/isDownloaded', async () => {
        invokeMock.mockResolvedValue(undefined)
        await downloadNativeModel('parakeet-v3')
        expect(invokeMock).toHaveBeenCalledWith('download_native_model', { modelId: 'parakeet-v3' })

        await cancelNativeDownload('parakeet-v3')
        expect(invokeMock).toHaveBeenCalledWith('cancel_native_download', { modelId: 'parakeet-v3' })

        invokeMock.mockResolvedValue(true)
        expect(await isNativeModelDownloaded('parakeet-ctc-0.6b')).toBe(true)
        expect(invokeMock).toHaveBeenCalledWith('is_native_model_downloaded', { modelId: 'parakeet-ctc-0.6b' })
    })

    it('formatModelSize renders MB and GB', () => {
        expect(formatModelSize(142 * 1024 * 1024)).toBe('142 MB')
        expect(formatModelSize(3094 * 1024 * 1024)).toBe('3.0 GB')
    })

    it('exposes the bundled default id, which must be a streaming model', () => {
        // The bundled default is what a fresh install and any failed model load
        // fall back to; it is deliberately a streaming model so live
        // transcription works with no downloads. Keep in sync with the
        // `bundled: true` entry in src-tauri/src/transcription/models.rs.
        expect(DEFAULT_NATIVE_MODEL_ID).toBe('moonshine-streaming-small')
    })
})
