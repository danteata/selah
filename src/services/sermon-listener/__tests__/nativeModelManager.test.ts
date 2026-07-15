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
    id: 'whisper-base.en',
    name: 'Whisper Base (English)',
    description: 'Bundled offline default.',
    engine_type: 'transcribecpp',
    format: 'file',
    filename: 'ggml-base.en.bin',
    url: 'https://example/ggml-base.en.bin',
    sha256: null,
    size_bytes: 142 * 1024 * 1024,
    languages: ['en'],
    accuracy: 0.5,
    speed: 0.9,
    supports_translation: false,
    supports_language_selection: false,
    recommended: false,
    bundled: true,
    supports_streaming: false,
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
        expect(models[0].id).toBe('whisper-base.en')
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
        expect(await isNativeModelDownloaded('whisper-base.en')).toBe(true)
        expect(invokeMock).toHaveBeenCalledWith('is_native_model_downloaded', { modelId: 'whisper-base.en' })
    })

    it('formatModelSize renders MB and GB', () => {
        expect(formatModelSize(142 * 1024 * 1024)).toBe('142 MB')
        expect(formatModelSize(3094 * 1024 * 1024)).toBe('3.0 GB')
    })

    it('exposes the bundled default id', () => {
        expect(DEFAULT_NATIVE_MODEL_ID).toBe('whisper-base.en')
    })
})
