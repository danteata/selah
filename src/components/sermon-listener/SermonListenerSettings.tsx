/**
 * Sermon Listener Settings Component
 * 
 * Settings panel for configuring the sermon listener feature,
 * including the ability to switch between Web Speech API and Whisper.cpp
 */

import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { unifiedTranscriptionService } from '../../services/sermon-listener'
import type { TranscriptionProvider } from '../../services/sermon-listener'
import { IconWrapper } from '../utils/IconWrapper'
import { Check, Info, Loader2 } from 'lucide-react'

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

    const [isLoading, setIsLoading] = useState(false)
    const [loadingProgress, setLoadingProgress] = useState(0)
    const [webSpeechAvailable, setWebSpeechAvailable] = useState(false)

    // Check Web Speech API availability
    useEffect(() => {
        unifiedTranscriptionService.isProviderAvailable('web-speech').then(setWebSpeechAvailable)
    }, [])

    // Save settings
    const saveSettings = () => {
        setAppSettings({
            ...useAppStore.getState().settings,
            sermonListener: {
                enabled: true,
                transcriptionProvider: provider,
                whisperModel,
                autoDisplay,
                autoLookup,
                language,
            },
        })
        onClose?.()
    }

    // Handle provider change
    const handleProviderChange = async (newProvider: TranscriptionProvider) => {
        setProvider(newProvider)

        if (newProvider === 'whisper') {
            setIsLoading(true)
            setLoadingProgress(0)

            const success = await unifiedTranscriptionService.setProvider('whisper', {
                whisperModel,
                language: language.split('-')[0], // Convert en-US to en
                onProgress: setLoadingProgress,
            })

            setIsLoading(false)
            if (!success) {
                // Revert to web-speech if Whisper fails
                setProvider('web-speech')
            }
        }
    }

    const modelSizes = {
        tiny: { size: '~75MB', speed: 'Fastest', accuracy: 'Good' },
        base: { size: '~142MB', speed: 'Fast', accuracy: 'Better' },
        small: { size: '~466MB', speed: 'Medium', accuracy: 'Great' },
        medium: { size: '~1.5GB', speed: 'Slow', accuracy: 'Excellent' },
    }

    return (
        <div className={`p-6 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h2 className="text-xl font-bold mb-6">Sermon Listener Settings</h2>

            {/* Transcription Provider */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-3">Transcription Provider</label>
                <div className="space-y-3">
                    {/* Web Speech API Option */}
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
                            <span className="text-green-500">✓ No download required</span>
                            <span className="text-green-500">✓ Real-time streaming</span>
                            {!webSpeechAvailable && (
                                <span className="text-red-500">✗ Not supported in this browser</span>
                            )}
                        </div>
                    </button>

                    {/* Whisper.cpp Option */}
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
                                <div className="font-medium">Whisper.cpp (Offline)</div>
                                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    High-quality offline transcription
                                </div>
                            </div>
                            {isLoading ? (
                                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                            ) : provider === 'whisper' ? (
                                <IconWrapper name="i-bx-check" className="text-blue-500" />
                            ) : null}
                        </div>
                        <div className="mt-2 flex gap-4 text-xs">
                            <span className="text-green-500">✓ Works offline</span>
                            <span className="text-green-500">✓ Better accuracy</span>
                            <span className="text-amber-500">⚠ Model download required</span>
                        </div>

                        {/* Loading progress */}
                        {isLoading && (
                            <div className="mt-3">
                                <div className="flex justify-between text-xs mb-1">
                                    <span>Downloading model...</span>
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

            {/* Whisper Model Selection */}
            {provider === 'whisper' && (
                <div className="mb-6">
                    <label className="block text-sm font-medium mb-3">Whisper Model Size</label>
                    <div className="grid grid-cols-2 gap-2">
                        {(Object.keys(modelSizes) as Array<keyof typeof modelSizes>).map((model) => (
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
                                    {modelSizes[model].size} • {modelSizes[model].accuracy}
                                </div>
                            </button>
                        ))}
                    </div>
                    <p className={`mt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        <Info className="inline w-4 h-4 mr-1" />
                        Recommended: "base" for best balance of speed and accuracy
                    </p>
                </div>
            )}

            {/* Language */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Language</label>
                <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
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

            {/* Behavior Settings */}
            <div className="mb-6 space-y-3">
                <label className="block text-sm font-medium mb-2">Behavior</label>

                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={autoLookup}
                        onChange={(e) => setAutoLookup(e.target.checked)}
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
                        onChange={(e) => setAutoDisplay(e.target.checked)}
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

            {/* Action Buttons */}
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