/**
 * Sermon Listener Settings Component
 *
 * Settings panel for configuring the sermon listener feature,
 * including provider selection and Whisper endpoint options.
 */

import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '../../store/appStore'
import { unifiedTranscriptionService } from '../../services/sermon-listener'
import type { TranscriptionProvider } from '../../services/sermon-listener'
import { IconWrapper } from '../utils/IconWrapper'
import { Info, Loader2 } from 'lucide-react'

interface SermonListenerSettingsProps {
    onClose?: () => void
}

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

    const [isLoading, setIsLoading] = useState(false)
    const [loadingProgress, setLoadingProgress] = useState(0)
    const [providerError, setProviderError] = useState<string | null>(null)
    const [webSpeechAvailable, setWebSpeechAvailable] = useState(false)
    const [whisperAvailable, setWhisperAvailable] = useState(false)

    useEffect(() => {
        unifiedTranscriptionService.isProviderAvailable('web-speech').then(setWebSpeechAvailable)
        unifiedTranscriptionService.isProviderAvailable('whisper').then(setWhisperAvailable)
    }, [])

    const isWhisperConfigured = useMemo(() => {
        return Boolean(whisperEndpoint.trim() || whisperApiKey.trim() || whisperAvailable)
    }, [whisperApiKey, whisperAvailable, whisperEndpoint])

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

        if (newProvider !== 'whisper') return

        if (!isWhisperConfigured) {
            setProvider('web-speech')
            setProviderError('Whisper needs a transcription endpoint or API key before it can be used.')
            return
        }

        setIsLoading(true)
        setLoadingProgress(0)

        const success = await unifiedTranscriptionService.setProvider('whisper', {
            whisperModel,
            language: language.split('-')[0],
            whisperEndpoint: whisperEndpoint.trim() || undefined,
            whisperApiKey: whisperApiKey.trim() || undefined,
            whisperChunkDurationMs,
            onProgress: setLoadingProgress,
        })

        setIsLoading(false)
        if (!success) {
            setProvider('web-speech')
            setProviderError('Failed to initialize Whisper provider. Check endpoint credentials and try again.')
        }
    }

    const modelDescriptions = {
        tiny: 'Fastest (maps to lightweight API model)',
        base: 'Balanced (recommended)',
        small: 'Higher quality (if supported by endpoint)',
        medium: 'Highest quality (if supported by endpoint)',
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
                                    Built-in browser speech recognition
                                </div>
                            </div>
                            {provider === 'web-speech' && (
                                <IconWrapper name="i-bx-check" className="text-blue-500" />
                            )}
                        </div>
                        <div className="mt-2 flex gap-4 text-xs">
                            <span className="text-green-500">✓ No extra backend required</span>
                            <span className="text-green-500">✓ Lowest latency</span>
                            {!webSpeechAvailable && (
                                <span className="text-red-500">✗ Not supported in this browser</span>
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
                                <div className="font-medium">Whisper-Compatible Endpoint</div>
                                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Chunked microphone upload to your transcription API
                                </div>
                            </div>
                            {isLoading ? (
                                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                            ) : provider === 'whisper' ? (
                                <IconWrapper name="i-bx-check" className="text-blue-500" />
                            ) : null}
                        </div>
                        <div className="mt-2 flex gap-4 text-xs">
                            <span className="text-green-500">✓ Consistent across browsers</span>
                            <span className="text-amber-500">⚠ Requires endpoint config</span>
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
                    </button>
                </div>
            </div>

            {providerError && (
                <div className={`mb-6 p-3 rounded-lg ${isDarkMode ? 'bg-red-900/30 text-red-300' : 'bg-red-100 text-red-700'}`}>
                    <p className="text-sm">{providerError}</p>
                </div>
            )}

            {provider === 'whisper' && (
                <div className="mb-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">Whisper Endpoint URL</label>
                        <input
                            value={whisperEndpoint}
                            onChange={(event) => setWhisperEndpoint(event.target.value)}
                            placeholder="https://your-api.example.com/transcribe"
                            className={`w-full p-2 rounded-lg border ${isDarkMode
                                ? 'bg-gray-700 border-gray-600 text-white'
                                : 'bg-white border-gray-300'
                                }`}
                        />
                        <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Endpoint should accept multipart audio and return JSON with a `text` field.
                        </p>
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
                        <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Lower values reduce delay but increase request volume.
                        </p>
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
                            Keep `base` unless your endpoint documents a different best model.
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
