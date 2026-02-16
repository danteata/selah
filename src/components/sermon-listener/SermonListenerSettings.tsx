/**
 * Sermon Listener Settings Component
 *
 * Configure live transcription providers:
 * - Web Speech API
 * - Whisper API endpoint
 * - Whisper.cpp local endpoint (offline)
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

const DEFAULT_WHISPER_CPP_ENDPOINT = 'http://127.0.0.1:8080/inference'

export function SermonListenerSettings({ onClose }: SermonListenerSettingsProps = {}) {
    const isDarkMode = useAppStore((state) => state.isDarkMode)
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
        sermonSettings?.whisperChunkDurationMs ?? 5000
    )

    const [whisperCppEndpoint, setWhisperCppEndpoint] = useState(
        sermonSettings?.whisperCppEndpoint || DEFAULT_WHISPER_CPP_ENDPOINT
    )
    const [whisperCppChunkDurationMs, setWhisperCppChunkDurationMs] = useState(
        sermonSettings?.whisperCppChunkDurationMs ?? 5000
    )

    const [isLoading, setIsLoading] = useState(false)
    const [loadingProgress, setLoadingProgress] = useState(0)
    const [providerError, setProviderError] = useState<string | null>(null)
    const [webSpeechAvailable, setWebSpeechAvailable] = useState(false)
    const [whisperAvailable, setWhisperAvailable] = useState(false)
    const [whisperCppAvailable, setWhisperCppAvailable] = useState(false)

    useEffect(() => {
        unifiedTranscriptionService.isProviderAvailable('web-speech').then(setWebSpeechAvailable)
        unifiedTranscriptionService.isProviderAvailable('whisper').then(setWhisperAvailable)
        unifiedTranscriptionService.isProviderAvailable('whisper-cpp').then(setWhisperCppAvailable)
    }, [])

    const isWhisperConfigured = useMemo(() => {
        return Boolean(whisperEndpoint.trim() || whisperApiKey.trim() || whisperAvailable)
    }, [whisperApiKey, whisperAvailable, whisperEndpoint])

    const isWhisperCppConfigured = useMemo(() => {
        return Boolean(whisperCppEndpoint.trim() || whisperCppAvailable)
    }, [whisperCppAvailable, whisperCppEndpoint])

    const saveSettings = () => {
        setAppSettings({
            ...useAppStore.getState().settings,
            sermonListener: {
                enabled: true,
                transcriptionProvider: provider,
                whisperModel,
                whisperEndpoint: whisperEndpoint.trim() || undefined,
                whisperApiKey: whisperApiKey.trim() || undefined,
                whisperChunkDurationMs: whisperChunkDurationMs > 0 ? whisperChunkDurationMs : 5000,
                whisperCppEndpoint: whisperCppEndpoint.trim() || DEFAULT_WHISPER_CPP_ENDPOINT,
                whisperCppChunkDurationMs: whisperCppChunkDurationMs > 0 ? whisperCppChunkDurationMs : 5000,
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
        <div className={`p-6 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h2 className="text-xl font-bold mb-6">Sermon Listener Settings</h2>

            <div className="mb-6">
                <label className="block text-sm font-medium mb-3">Transcription Provider</label>
                <div className="space-y-3">
                    <button
                        onClick={() => !isLoading && handleProviderChange('web-speech')}
                        disabled={isLoading || !webSpeechAvailable}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${provider === 'web-speech'
                            ? 'border-blue-500 bg-blue-500/10'
                            : isDarkMode
                                ? 'border-gray-700 hover:border-gray-600'
                                : 'border-gray-200 hover:border-gray-300'
                            } ${!webSpeechAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">Web Speech API</div>
                                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
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
                            ? 'border-blue-500 bg-blue-500/10'
                            : isDarkMode
                                ? 'border-gray-700 hover:border-gray-600'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">Whisper API Endpoint</div>
                                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
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
                            ? 'border-blue-500 bg-blue-500/10'
                            : isDarkMode
                                ? 'border-gray-700 hover:border-gray-600'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">Whisper.cpp Local (Offline)</div>
                                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Sends audio chunks to local whisper.cpp server
                                </div>
                            </div>
                            {provider === 'whisper-cpp' && (
                                <IconWrapper name="i-bx-check" className="text-blue-500" />
                            )}
                        </div>
                    </button>
                </div>

                {isLoading && (
                    <div className="mt-3">
                        <div className="flex justify-between text-xs mb-1">
                            <span>Initializing provider...</span>
                            <span>{Math.round(loadingProgress)}%</span>
                        </div>
                        <div className={`h-2 rounded-full ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                            <div
                                className="h-full bg-blue-500 rounded-full transition-all"
                                style={{ width: `${loadingProgress}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {providerError && (
                <div className={`mb-6 p-3 rounded-lg ${isDarkMode ? 'bg-red-900/30 text-red-300' : 'bg-red-100 text-red-700'}`}>
                    <p className="text-sm">{providerError}</p>
                </div>
            )}

            {provider === 'whisper' && (
                <div className="mb-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">Whisper API Endpoint URL</label>
                        <input
                            value={whisperEndpoint}
                            onChange={(event) => setWhisperEndpoint(event.target.value)}
                            placeholder="https://your-api.example.com/transcribe"
                            className={`w-full p-2 rounded-lg border ${isDarkMode
                                ? 'bg-gray-700 border-gray-600 text-white'
                                : 'bg-white border-gray-300'
                                }`}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">API Key (Optional)</label>
                        <input
                            value={whisperApiKey}
                            onChange={(event) => setWhisperApiKey(event.target.value)}
                            placeholder="Bearer token for endpoint"
                            className={`w-full p-2 rounded-lg border ${isDarkMode
                                ? 'bg-gray-700 border-gray-600 text-white'
                                : 'bg-white border-gray-300'
                                }`}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Chunk Duration (ms)</label>
                        <input
                            type="number"
                            min={1000}
                            step={500}
                            value={whisperChunkDurationMs}
                            onChange={(event) => setWhisperChunkDurationMs(Number(event.target.value || 5000))}
                            className={`w-full p-2 rounded-lg border ${isDarkMode
                                ? 'bg-gray-700 border-gray-600 text-white'
                                : 'bg-white border-gray-300'
                                }`}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-3">Model Preference</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.keys(modelDescriptions) as Array<keyof typeof modelDescriptions>).map((model) => (
                                <button
                                    key={model}
                                    onClick={() => setWhisperModel(model)}
                                    disabled={isLoading}
                                    className={`p-3 rounded-lg border text-left transition-all ${whisperModel === model
                                        ? 'border-blue-500 bg-blue-500/10'
                                        : isDarkMode
                                            ? 'border-gray-700 hover:border-gray-600'
                                            : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                >
                                    <div className="font-medium capitalize">{model}</div>
                                    <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {modelDescriptions[model]}
                                    </div>
                                </button>
                            ))}
                        </div>
                        <p className={`mt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            <Info className="inline w-4 h-4 mr-1" />
                            Keep `base` unless your API endpoint recommends another model.
                        </p>
                    </div>
                </div>
            )}

            {provider === 'whisper-cpp' && (
                <div className="mb-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">Whisper.cpp Endpoint URL</label>
                        <input
                            value={whisperCppEndpoint}
                            onChange={(event) => setWhisperCppEndpoint(event.target.value)}
                            placeholder={DEFAULT_WHISPER_CPP_ENDPOINT}
                            className={`w-full p-2 rounded-lg border ${isDarkMode
                                ? 'bg-gray-700 border-gray-600 text-white'
                                : 'bg-white border-gray-300'
                                }`}
                        />
                        <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Run whisper.cpp server locally and point this to its `/inference` endpoint.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Chunk Duration (ms)</label>
                        <input
                            type="number"
                            min={1000}
                            step={500}
                            value={whisperCppChunkDurationMs}
                            onChange={(event) => setWhisperCppChunkDurationMs(Number(event.target.value || 5000))}
                            className={`w-full p-2 rounded-lg border ${isDarkMode
                                ? 'bg-gray-700 border-gray-600 text-white'
                                : 'bg-white border-gray-300'
                                }`}
                        />
                        <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Lower values reduce delay but increase CPU/network calls to local server.
                        </p>
                    </div>

                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-amber-900/30 border border-amber-700' : 'bg-amber-50 border border-amber-200'}`}>
                        <p className={`text-sm ${isDarkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                            <strong>Setup required:</strong> The whisper.cpp server must be running before starting transcription.
                            Run it with: <code className={`px-1 rounded ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>./server -m models/ggml-base.en.bin --port 8080</code>
                        </p>
                    </div>
                </div>
            )}

            <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Language</label>
                <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className={`w-full p-2 rounded-lg border ${isDarkMode
                        ? 'bg-gray-700 border-gray-600 text-white'
                        : 'bg-white border-gray-300'
                        }`}
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
                <label className="block text-sm font-medium mb-2">Behavior</label>

                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={autoLookup}
                        onChange={(event) => setAutoLookup(event.target.checked)}
                        className="w-4 h-4 rounded"
                    />
                    <div>
                        <div className="font-medium">Auto-lookup verses</div>
                        <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
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
                        <div className="font-medium">Auto-display on live view</div>
                        <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Automatically show detected verses on the live output
                        </div>
                    </div>
                </label>
            </div>

            <div className="flex justify-end gap-3">
                {onClose && (
                    <button
                        onClick={onClose}
                        className={`px-4 py-2 rounded-lg ${isDarkMode
                            ? 'bg-gray-700 hover:bg-gray-600'
                            : 'bg-gray-200 hover:bg-gray-300'
                            }`}
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
