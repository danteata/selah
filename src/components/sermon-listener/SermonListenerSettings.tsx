/**
 * Sermon Listener Settings Component
 *
 * Configure live transcription providers:
 * - Web Speech API
 * - Whisper API endpoint
 * - Whisper.cpp local endpoint (offline)
 * - Faster-Whisper (CTranslate2-based, 2-4x faster)
 * - ElevenLabs Speech-to-Text
 */

import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { unifiedTranscriptionService } from '../../services/sermon-listener'
import type { TranscriptionProvider } from '../../services/sermon-listener'
import { IconWrapper } from '../utils/IconWrapper'
import { Info } from 'lucide-react'

interface SermonListenerSettingsProps {
    onClose?: () => void
}

const DEFAULT_WHISPER_CPP_ENDPOINT = '/whisper-cpp/inference' // Use Vite proxy
const DEFAULT_FASTER_WHISPER_ENDPOINT = '/faster-whisper' // Use Vite proxy to avoid CORS
const DIRECT_WHISPER_CPP_ENDPOINT = 'http://127.0.0.1:8080/inference'
const DIRECT_FASTER_WHISPER_ENDPOINT = 'http://127.0.0.1:8000'
const DEFAULT_CHUNK_DURATION_MS = 2500 // Reduced from 5000ms for faster feedback

export function SermonListenerSettings({ onClose }: SermonListenerSettingsProps = {}) {
    const sermonSettings = useAppStore((state) => state.settings.sermonListener)
    const setAppSettings = useAppStore((state) => state.setAppSettings)

    const [provider, setProvider] = useState<TranscriptionProvider>(
        sermonSettings?.transcriptionProvider || 'web-speech'
    )
    const [whisperModel, setWhisperModel] = useState<'tiny' | 'base' | 'small' | 'medium'>(
        sermonSettings?.whisperModel || 'base'
    )
    const [autoDisplay, setAutoDisplay] = useState(sermonSettings?.autoDisplay ?? false)
    const [autoLookup, setAutoLookup] = useState(sermonSettings?.autoLookup ?? true)
    const [language, setLanguage] = useState(sermonSettings?.language || 'en-US')

    const [whisperEndpoint, setWhisperEndpoint] = useState(sermonSettings?.whisperEndpoint || '')
    const [whisperApiKey, setWhisperApiKey] = useState(sermonSettings?.whisperApiKey || '')
    const [whisperChunkDurationMs, setWhisperChunkDurationMs] = useState(
        sermonSettings?.whisperChunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS
    )

    const [whisperCppEndpoint, setWhisperCppEndpoint] = useState(
        sermonSettings?.whisperCppEndpoint || DEFAULT_WHISPER_CPP_ENDPOINT
    )
    const [whisperCppChunkDurationMs, setWhisperCppChunkDurationMs] = useState(
        sermonSettings?.whisperCppChunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS
    )

    // Faster-Whisper settings
    const [fasterWhisperEndpoint, setFasterWhisperEndpoint] = useState(
        sermonSettings?.fasterWhisperEndpoint || DEFAULT_FASTER_WHISPER_ENDPOINT
    )
    const [fasterWhisperModel, setFasterWhisperModel] = useState<'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large-v1' | 'large-v2' | 'large-v3' | 'distil-large-v3'>(
        sermonSettings?.fasterWhisperModel || 'base'
    )
    const [fasterWhisperChunkDurationMs, setFasterWhisperChunkDurationMs] = useState(
        sermonSettings?.fasterWhisperChunkDurationMs ?? 2000
    )
    // Audio capture mode for Faster-Whisper
    const [fasterWhisperAudioCaptureMode, setFasterWhisperAudioCaptureMode] = useState<'browser-wav' | 'server-decode'>(
        sermonSettings?.fasterWhisperAudioCaptureMode || 'browser-wav'
    )
    const [fasterWhisperDisableBrowserProcessing, setFasterWhisperDisableBrowserProcessing] = useState(
        sermonSettings?.fasterWhisperDisableBrowserProcessing ?? false
    )
    // VAD toggle for faster-whisper
    const [useVAD, setUseVAD] = useState(sermonSettings?.useVAD ?? false)

    // ElevenLabs settings
    const [elevenLabsApiKey, setElevenLabsApiKey] = useState(sermonSettings?.elevenLabsApiKey || '')
    const [elevenLabsModelId, setElevenLabsModelId] = useState(sermonSettings?.elevenLabsModelId || 'scribe_v1')
    const [elevenLabsChunkDurationMs, setElevenLabsChunkDurationMs] = useState(
        sermonSettings?.elevenLabsChunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS
    )

    const [isLoading, setIsLoading] = useState(false)
    const [loadingProgress, setLoadingProgress] = useState(0)
    const [providerError, setProviderError] = useState<string | null>(null)
    const [webSpeechAvailable, setWebSpeechAvailable] = useState(false)
    const [whisperAvailable, setWhisperAvailable] = useState(false)
    const [whisperCppAvailable, setWhisperCppAvailable] = useState(false)
    const [fasterWhisperAvailable, setFasterWhisperAvailable] = useState(false)
    const [vadAvailable, setVadAvailable] = useState(false)
    const [elevenLabsAvailable, setElevenLabsAvailable] = useState(false)

    useEffect(() => {
        unifiedTranscriptionService.isProviderAvailable('web-speech').then(setWebSpeechAvailable)
        unifiedTranscriptionService.isProviderAvailable('whisper').then(setWhisperAvailable)
        unifiedTranscriptionService.isProviderAvailable('whisper-cpp').then(setWhisperCppAvailable)
        unifiedTranscriptionService.isProviderAvailable('faster-whisper').then(setFasterWhisperAvailable)
        unifiedTranscriptionService.isProviderAvailable('elevenlabs').then(setElevenLabsAvailable)
        // Check VAD availability separately
        unifiedTranscriptionService.isVADAvailable().then(setVadAvailable)
    }, [])

    const isWhisperConfigured = useMemo(() => {
        return Boolean(whisperEndpoint.trim() || whisperApiKey.trim() || whisperAvailable)
    }, [whisperApiKey, whisperAvailable, whisperEndpoint])

    const isWhisperCppConfigured = useMemo(() => {
        return Boolean(whisperCppEndpoint.trim() || whisperCppAvailable)
    }, [whisperCppAvailable, whisperCppEndpoint])

    const isFasterWhisperConfigured = useMemo(() => {
        return Boolean(fasterWhisperEndpoint.trim() || fasterWhisperAvailable)
    }, [fasterWhisperAvailable, fasterWhisperEndpoint])

    const isElevenLabsConfigured = useMemo(() => {
        return Boolean(elevenLabsApiKey.trim() || elevenLabsAvailable)
    }, [elevenLabsApiKey, elevenLabsAvailable])

    const saveSettings = () => {
        setAppSettings({
            ...useAppStore.getState().settings,
            sermonListener: {
                enabled: true,
                transcriptionProvider: provider,
                whisperModel,
                whisperEndpoint: whisperEndpoint.trim() || undefined,
                whisperApiKey: whisperApiKey.trim() || undefined,
                whisperChunkDurationMs: whisperChunkDurationMs > 0 ? whisperChunkDurationMs : DEFAULT_CHUNK_DURATION_MS,
                whisperCppEndpoint: whisperCppEndpoint.trim() || DEFAULT_WHISPER_CPP_ENDPOINT,
                whisperCppChunkDurationMs: whisperCppChunkDurationMs > 0 ? whisperCppChunkDurationMs : DEFAULT_CHUNK_DURATION_MS,
                fasterWhisperEndpoint: fasterWhisperEndpoint.trim() || DEFAULT_FASTER_WHISPER_ENDPOINT,
                fasterWhisperModel,
                fasterWhisperChunkDurationMs: fasterWhisperChunkDurationMs > 0 ? fasterWhisperChunkDurationMs : 2000,
                fasterWhisperAudioCaptureMode,
                fasterWhisperDisableBrowserProcessing,
                useVAD,
                elevenLabsApiKey: elevenLabsApiKey.trim() || undefined,
                elevenLabsModelId: elevenLabsModelId.trim() || 'scribe_v1',
                elevenLabsChunkDurationMs: elevenLabsChunkDurationMs > 0 ? elevenLabsChunkDurationMs : DEFAULT_CHUNK_DURATION_MS,
                autoDisplay,
                autoLookup,
                language,
            },
        })
        onClose?.()
    }

    const handleProviderChange = async (newProvider: TranscriptionProvider) => {
        setProviderError(null)
        setProvider(newProvider)

        if (newProvider === 'web-speech') {
            return
        }

        if (newProvider === 'whisper' && !isWhisperConfigured) {
            setProvider('web-speech')
            setProviderError('Whisper API needs an endpoint or API key before it can be used.')
            return
        }

        if (newProvider === 'whisper-cpp' && !isWhisperCppConfigured) {
            setProvider('web-speech')
            setProviderError('Whisper.cpp needs a local endpoint URL before it can be used.')
            return
        }

        if (newProvider === 'faster-whisper' && !isFasterWhisperConfigured) {
            setProvider('web-speech')
            setProviderError('Faster-Whisper needs a server endpoint before it can be used.')
            return
        }

        if (newProvider === 'elevenlabs' && !isElevenLabsConfigured) {
            setProvider('web-speech')
            setProviderError('ElevenLabs needs an API key before it can be used.')
            return
        }

        setIsLoading(true)
        setLoadingProgress(0)

        const success = await unifiedTranscriptionService.setProvider(newProvider, {
            whisperModel,
            language: language.split('-')[0],
            whisperEndpoint: whisperEndpoint.trim() || undefined,
            whisperApiKey: whisperApiKey.trim() || undefined,
            whisperChunkDurationMs,
            whisperCppEndpoint: whisperCppEndpoint.trim() || DEFAULT_WHISPER_CPP_ENDPOINT,
            whisperCppChunkDurationMs,
            fasterWhisperEndpoint: fasterWhisperEndpoint.trim() || DEFAULT_FASTER_WHISPER_ENDPOINT,
            fasterWhisperModel,
            fasterWhisperChunkDurationMs,
            fasterWhisperAudioCaptureMode,
            fasterWhisperDisableBrowserProcessing,
            elevenLabsApiKey: elevenLabsApiKey.trim() || undefined,
            elevenLabsModelId: elevenLabsModelId.trim() || 'scribe_v1',
            elevenLabsChunkDurationMs,
            onProgress: setLoadingProgress,
        })

        setIsLoading(false)
        if (!success) {
            setProvider('web-speech')
            setProviderError(`Failed to initialize ${newProvider} provider. Check settings and try again.`)
        }
    }

    const modelDescriptions = {
        tiny: 'Fastest (maps to lightweight API model)',
        base: 'Balanced (recommended)',
        small: 'Higher quality (if endpoint supports it)',
        medium: 'Highest quality (if endpoint supports it)',
    }

    return (
        <div className="p-6 rounded-lg bg-white dark:bg-gray-800">
            <h2 className="text-xl font-bold mb-6 text-gray-900 dark:text-white">Sermon Listener Settings</h2>

            <div className="mb-6">
                <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">Transcription Provider</label>
                <div className="space-y-3">
                    <button
                        onClick={() => !isLoading && handleProviderChange('web-speech')}
                        disabled={isLoading || !webSpeechAvailable}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${provider === 'web-speech'
                            ? 'border-blue-500 bg-blue-500/10 dark:bg-blue-500/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            } ${!webSpeechAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-gray-900 dark:text-white">Web Speech API</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                    Browser-native streaming transcription
                                </div>
                            </div>
                            {provider === 'web-speech' && (
                                <IconWrapper name="i-bx-check" className="text-blue-500" />
                            )}
                        </div>
                    </button>

                    <button
                        onClick={() => !isLoading && handleProviderChange('whisper')}
                        disabled={isLoading}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${provider === 'whisper'
                            ? 'border-blue-500 bg-blue-500/10 dark:bg-blue-500/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-gray-900 dark:text-white">Whisper API Endpoint</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                    Chunked upload to remote transcription API
                                </div>
                            </div>
                            {provider === 'whisper' && (
                                <IconWrapper name="i-bx-check" className="text-blue-500" />
                            )}
                        </div>
                    </button>

                    <button
                        onClick={() => !isLoading && handleProviderChange('whisper-cpp')}
                        disabled={isLoading}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${provider === 'whisper-cpp'
                            ? 'border-blue-500 bg-blue-500/10 dark:bg-blue-500/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-gray-900 dark:text-white">Whisper.cpp Local (Offline)</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                    Sends audio chunks to local whisper.cpp server
                                </div>
                            </div>
                            {provider === 'whisper-cpp' && (
                                <IconWrapper name="i-bx-check" className="text-blue-500" />
                            )}
                        </div>
                    </button>

                    <button
                        onClick={() => !isLoading && handleProviderChange('faster-whisper')}
                        disabled={isLoading}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${provider === 'faster-whisper'
                            ? 'border-green-500 bg-green-500/10 dark:bg-green-500/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-gray-900 dark:text-white">Faster-Whisper (Recommended)</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                    CTranslate2-based, 2-4x faster than whisper.cpp
                                </div>
                            </div>
                            {provider === 'faster-whisper' && (
                                <IconWrapper name="i-bx-check" className="text-green-500" />
                            )}
                        </div>
                    </button>

                    <button
                        onClick={() => !isLoading && handleProviderChange('elevenlabs')}
                        disabled={isLoading}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${provider === 'elevenlabs'
                            ? 'border-purple-500 bg-purple-500/10 dark:bg-purple-500/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-gray-900 dark:text-white">ElevenLabs Speech-to-Text</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                    High-quality cloud transcription with word-level timestamps
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {!isElevenLabsConfigured && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">
                                        API key required
                                    </span>
                                )}
                                {provider === 'elevenlabs' && (
                                    <IconWrapper name="i-bx-check" className="text-purple-500" />
                                )}
                            </div>
                        </div>
                    </button>
                </div>

                {isLoading && (
                    <div className="mt-3">
                        <div className="flex justify-between text-xs mb-1 text-gray-600 dark:text-gray-400">
                            <span>Initializing provider...</span>
                            <span>{Math.round(loadingProgress)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700">
                            <div
                                className="h-full bg-blue-500 rounded-full transition-all"
                                style={{ width: `${loadingProgress}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {providerError && (
                <div className="mb-6 p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                    <p className="text-sm">{providerError}</p>
                </div>
            )}

            {provider === 'whisper' && (
                <div className="mb-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Whisper API Endpoint URL</label>
                        <input
                            value={whisperEndpoint}
                            onChange={(event) => setWhisperEndpoint(event.target.value)}
                            placeholder="https://your-api.example.com/transcribe"
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">API Key (Optional)</label>
                        <input
                            value={whisperApiKey}
                            onChange={(event) => setWhisperApiKey(event.target.value)}
                            placeholder="Bearer token for endpoint"
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Chunk Duration (ms)</label>
                        <input
                            type="number"
                            min={1000}
                            step={500}
                            value={whisperChunkDurationMs}
                            onChange={(event) => setWhisperChunkDurationMs(Number(event.target.value || 5000))}
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">Model Preference</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.keys(modelDescriptions) as Array<keyof typeof modelDescriptions>).map((model) => (
                                <button
                                    key={model}
                                    onClick={() => setWhisperModel(model)}
                                    disabled={isLoading}
                                    className={`p-3 rounded-lg border text-left transition-all ${whisperModel === model
                                        ? 'border-blue-500 bg-blue-500/10 dark:bg-blue-500/20'
                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                        }`}
                                >
                                    <div className="font-medium capitalize text-gray-900 dark:text-white">{model}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {modelDescriptions[model]}
                                    </div>
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            <Info className="inline w-4 h-4 mr-1" />
                            Keep `base` unless your API endpoint recommends another model.
                        </p>
                    </div>
                </div>
            )}

            {provider === 'whisper-cpp' && (
                <div className="mb-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Whisper.cpp Endpoint URL</label>
                        <input
                            value={whisperCppEndpoint}
                            onChange={(event) => setWhisperCppEndpoint(event.target.value)}
                            placeholder={DEFAULT_WHISPER_CPP_ENDPOINT}
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Run whisper.cpp server locally and point this to its `/inference` endpoint.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Chunk Duration (ms)</label>
                        <input
                            type="number"
                            min={1000}
                            step={500}
                            value={whisperCppChunkDurationMs}
                            onChange={(event) => setWhisperCppChunkDurationMs(Number(event.target.value || 5000))}
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Lower values reduce delay but increase CPU/network calls to local server.
                        </p>
                    </div>

                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
                        <p className="text-sm text-amber-800 dark:text-amber-300">
                            <strong>Setup required (Docker recommended):</strong> The whisper.cpp server must be running.
                            Run it with: <code className="px-1 rounded bg-gray-200 dark:bg-gray-800">bun run whisper:start</code> or <code className="px-1 rounded bg-gray-200 dark:bg-gray-800">npm run whisper:start</code>
                        </p>
                    </div>
                </div>
            )}

            {provider === 'faster-whisper' && (
                <div className="mb-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Faster-Whisper Server Endpoint</label>
                        <input
                            value={fasterWhisperEndpoint}
                            onChange={(event) => setFasterWhisperEndpoint(event.target.value)}
                            placeholder={DEFAULT_FASTER_WHISPER_ENDPOINT}
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            OpenAI-compatible endpoint (e.g., faster-whisper-server on port 8000)
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Model</label>
                        <select
                            value={fasterWhisperModel}
                            onChange={(event) => setFasterWhisperModel(event.target.value as typeof fasterWhisperModel)}
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        >
                            <option value="tiny">Tiny - Fastest, lowest accuracy</option>
                            <option value="tiny.en">Tiny (English) - Fast, English only</option>
                            <option value="base">Base - Balanced (recommended)</option>
                            <option value="base.en">Base (English) - Balanced, English only</option>
                            <option value="small">Small - Good accuracy</option>
                            <option value="small.en">Small (English) - Good accuracy, English only</option>
                            <option value="medium">Medium - High accuracy</option>
                            <option value="medium.en">Medium (English) - High accuracy, English only</option>
                            <option value="large-v3">Large V3 - Best accuracy</option>
                            <option value="distil-large-v3">Distil Large V3 - Fast + accurate</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Chunk Duration (ms)</label>
                        <input
                            type="number"
                            min={1000}
                            step={500}
                            value={fasterWhisperChunkDurationMs}
                            onChange={(event) => setFasterWhisperChunkDurationMs(Number(event.target.value || 2000))}
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Faster-Whisper processes efficiently - 2000ms recommended for good balance.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Audio Capture Mode</label>
                        <select
                            value={fasterWhisperAudioCaptureMode}
                            onChange={(event) => setFasterWhisperAudioCaptureMode(event.target.value as 'browser-wav' | 'server-decode')}
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        >
                            <option value="browser-wav">Browser WAV (current) - Encode in browser, send WAV</option>
                            <option value="server-decode">Server Decode - Send webm/opus directly to server</option>
                        </select>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            <strong>Browser WAV:</strong> Current approach. Browser encodes to WAV using AudioContext.<br />
                            <strong>Server Decode:</strong> Sends webm/opus directly. Server uses FFmpeg for better quality resampling.
                        </p>
                    </div>

                    {fasterWhisperAudioCaptureMode === 'server-decode' && (
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="disableBrowserProcessing"
                                checked={fasterWhisperDisableBrowserProcessing}
                                onChange={(event) => setFasterWhisperDisableBrowserProcessing(event.target.checked)}
                                className="rounded border-gray-300 dark:border-gray-600"
                            />
                            <label htmlFor="disableBrowserProcessing" className="text-sm text-gray-700 dark:text-gray-300">
                                Disable browser audio processing (noise suppression, AGC, echo cancellation)
                            </label>
                        </div>
                    )}

                    {fasterWhisperAudioCaptureMode === 'server-decode' && fasterWhisperDisableBrowserProcessing && (
                        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700">
                            <p className="text-sm text-yellow-800 dark:text-yellow-300">
                                <strong>Note:</strong> Disabling browser audio processing lets Whisper's VAD handle noise.
                                This may improve accuracy for clean audio but could reduce quality in noisy environments.
                            </p>
                        </div>
                    )}

                    {/* VAD Smart Chunking Toggle */}
                    <div className="p-4 rounded-lg bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200 dark:border-cyan-700">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="useVAD"
                                    checked={useVAD}
                                    onChange={(event) => setUseVAD(event.target.checked)}
                                    className="rounded border-gray-300 dark:border-gray-600"
                                />
                                <label htmlFor="useVAD" className="font-medium text-cyan-800 dark:text-cyan-300">
                                    Enable VAD Smart Chunking
                                </label>
                            </div>
                            {vadAvailable ? (
                                <span className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300">
                                    Available
                                </span>
                            ) : (
                                <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                    Loading...
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-cyan-700 dark:text-cyan-400">
                            <strong>Recommended for best quality.</strong> Uses browser-based Voice Activity Detection
                            to detect speech boundaries. Eliminates word cutoffs at chunk boundaries by only sending
                            complete utterances to the transcription server.
                        </p>
                        {useVAD && (
                            <p className="mt-2 text-xs text-cyan-600 dark:text-cyan-500">
                                ✓ VAD will detect when speech starts and ends, sending complete utterances for transcription.
                                Chunk duration setting is ignored when VAD is enabled.
                            </p>
                        )}
                    </div>

                    <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700">
                        <p className="text-sm text-green-800 dark:text-green-300">
                            <strong>Recommended for best performance:</strong> Faster-Whisper uses CTranslate2 for 2-4x faster inference than whisper.cpp.
                            Install with: <code className="px-1 rounded bg-gray-200 dark:bg-gray-800">uvx speaches</code> or via Docker: <code className="px-1 rounded bg-gray-200 dark:bg-gray-800">docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest</code>
                        </p>
                    </div>
                </div>
            )}

            {provider === 'elevenlabs' && (
                <div className="mb-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">ElevenLabs API Key</label>
                        <input
                            type="password"
                            value={elevenLabsApiKey}
                            onChange={(event) => setElevenLabsApiKey(event.target.value)}
                            placeholder="sk_..."
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Or set VITE_ELEVENLABS_API_KEY environment variable
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Model ID</label>
                        <input
                            value={elevenLabsModelId}
                            onChange={(event) => setElevenLabsModelId(event.target.value)}
                            placeholder="scribe_v1"
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Chunk Duration (ms)</label>
                        <input
                            type="number"
                            min={2000}
                            step={500}
                            value={elevenLabsChunkDurationMs}
                            onChange={(event) => setElevenLabsChunkDurationMs(Number(event.target.value || 5000))}
                            className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Lower values reduce delay but increase API calls.
                        </p>
                    </div>

                    <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700">
                        <p className="text-sm text-purple-800 dark:text-purple-300">
                            <strong>ElevenLabs Speech-to-Text:</strong> High-quality cloud transcription with word-level timestamps.
                            Get your API key from <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer" className="underline">elevenlabs.io</a>.
                        </p>
                    </div>
                </div>
            )}

            <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Language</label>
                <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                >
                    <option value="en-US">English (US)</option>
                    <option value="en-GB">English (UK)</option>
                    <option value="es-ES">Spanish</option>
                    <option value="fr-FR">French</option>
                    <option value="de-DE">German</option>
                    <option value="pt-BR">Portuguese (Brazil)</option>
                    <option value="zh-CN">Chinese (Simplified)</option>
                    <option value="ja-JP">Japanese</option>
                    <option value="ko-KR">Korean</option>
                    <option value="ar-SA">Arabic</option>
                </select>
            </div>

            <div className="mb-6 space-y-3">
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Behavior</label>

                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={autoLookup}
                        onChange={(event) => setAutoLookup(event.target.checked)}
                        className="w-4 h-4 rounded"
                    />
                    <div>
                        <div className="font-medium text-gray-900 dark:text-white">Auto-lookup verses</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            Automatically fetch scripture content when a verse is detected
                        </div>
                    </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={autoDisplay}
                        onChange={(event) => setAutoDisplay(event.target.checked)}
                        className="w-4 h-4 rounded"
                    />
                    <div>
                        <div className="font-medium text-gray-900 dark:text-white">Auto-display on live view</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            Automatically show detected verses on the live output
                        </div>
                    </div>
                </label>
            </div>

            <div className="flex justify-end gap-3">
                {onClose && (
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                    >
                        Cancel
                    </button>
                )}
                <button
                    onClick={saveSettings}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
                >
                    Save Settings
                </button>
            </div>
        </div>
    )
}

export default SermonListenerSettings
