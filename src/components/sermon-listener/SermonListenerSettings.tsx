import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useUserRole } from '../../hooks/useUserRole'
import { useGlobalSermonListenerSettings } from '../../hooks/useGlobalAppSettings'
import { useNativeAudioCapture } from '../../services/sermon-listener/nativeAudioCapture'
import { useAudioDevices } from '../../hooks/useAudioDevices'
import { IconWrapper } from '../utils/IconWrapper'
import { Info, Check, Shield, Loader2, Settings, Mic, Monitor, RefreshCw } from 'lucide-react'

interface SermonListenerSettingsProps {
    onClose?: () => void
}

export function SermonListenerSettings({ onClose }: SermonListenerSettingsProps = {}) {
    const sermonSettings = useAppStore((state) => state.settings.sermonListener)
    const setAppSettings = useAppStore((state) => state.setAppSettings)
    const { isSuperadmin } = useUserRole()
    const { systemAudioSupported } = useNativeAudioCapture()

    // Get global settings to display current provider (system-wide, no churchId needed)
    const { settings: globalSettings, isLoading: isGlobalLoading } = useGlobalSermonListenerSettings()

    // User-specific settings only
    const [autoDisplay, setAutoDisplay] = useState(sermonSettings?.autoDisplay ?? false)
    const [autoLookup, setAutoLookup] = useState(sermonSettings?.autoLookup ?? true)
    const [language, setLanguage] = useState(sermonSettings?.language || 'en-US')
    const [captureSource, setCaptureSource] = useState<'microphone' | 'system'>(sermonSettings?.captureSource || 'microphone')
    const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string>(sermonSettings?.selectedMicrophoneId || '')

    const { devices: micDevices, isLoading: isLoadingDevices, refresh: refreshDevices } = useAudioDevices()

    const [showSaveSuccess, setShowSaveSuccess] = useState(false)

    const saveSettings = () => {
        setAppSettings({
            ...useAppStore.getState().settings,
            sermonListener: {
                ...useAppStore.getState().settings.sermonListener,
                enabled: true,
                autoDisplay,
                autoLookup,
                language,
                captureSource,
                selectedMicrophoneId,
            },
        })
        // Show success toast
        setShowSaveSuccess(true)
        setTimeout(() => {
            setShowSaveSuccess(false)
            onClose?.()
        }, 1500)
    }

    // Get provider display name
    const getProviderDisplayName = (provider?: string) => {
        switch (provider) {
            case 'web-speech':
                return 'Web Speech API'
            case 'whisper':
                return 'Whisper API'
            case 'whisper-cpp':
                return 'Whisper.cpp Local'
            case 'faster-whisper':
                return 'Faster-Whisper'
            case 'elevenlabs':
                return 'ElevenLabs'
            case 'desktop-whisper':
                return 'Desktop Whisper (Offline)'
            default:
                return 'Web Speech API'
        }
    }

    return (
        <div className="p-6 rounded-lg bg-white dark:bg-gray-800 relative">
            {/* Success Toast */}
            {showSaveSuccess && (
                <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg shadow-lg animate-fade-in">
                    <Check className="w-4 h-4" />
                    <span className="text-sm font-medium">Settings saved!</span>
                </div>
            )}

            <h2 className="text-xl font-bold mb-6 text-gray-900 dark:text-white">Sermon Listener Settings</h2>

            {/* Global Settings Info */}
            <div className="mb-6 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700">
                <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div>
                        <h3 className="font-medium text-blue-800 dark:text-blue-300">Global Configuration</h3>
                        {isGlobalLoading ? (
                            <div className="flex items-center gap-2 mt-1">
                                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                                <span className="text-sm text-blue-600 dark:text-blue-400">Loading configuration...</span>
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                                    Transcription provider is configured globally by your super admin.
                                </p>
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                                        Current Provider:
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 text-sm">
                                        {getProviderDisplayName(globalSettings?.sermonListener_transcriptionProvider)}
                                    </span>
                                </div>
                                {globalSettings?.sermonListener_defaultLanguage && (
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                                            Default Language:
                                        </span>
                                        <span className="text-sm text-blue-700 dark:text-blue-400">
                                            {globalSettings.sermonListener_defaultLanguage}
                                        </span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* User-specific settings */}
            <div className="mb-6 space-y-3">
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Behavior</label>

                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={autoLookup}
                        onChange={(e) => setAutoLookup(e.target.checked)}
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
                        onChange={(e) => setAutoDisplay(e.target.checked)}
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

            {/* Capture Source */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Audio Source</label>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={() => setCaptureSource('microphone')}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${captureSource === 'microphone'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-600 dark:text-gray-400'
                            }`}
                    >
                        <Mic className="w-5 h-5" />
                        <div className="text-left">
                            <div className="font-medium text-sm">Microphone</div>
                            <div className="text-xs opacity-70">External or built-in mic</div>
                        </div>
                    </button>
                    <button
                        onClick={() => systemAudioSupported && setCaptureSource('system')}
                        disabled={!systemAudioSupported}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${!systemAudioSupported
                                ? 'opacity-50 grayscale cursor-not-allowed border-gray-200 dark:border-gray-700'
                                : captureSource === 'system'
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-600 dark:text-gray-400'
                            }`}
                    >
                        <Monitor className="w-5 h-5" />
                        <div className="text-left">
                            <div className="font-medium text-sm">System Audio</div>
                            <div className="text-xs opacity-70">Capture speaker output</div>
                        </div>
                    </button>
                </div>
                {!systemAudioSupported && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        System audio capture is not supported on this platform or version.
                    </p>
                )}
            </div>

            {/* Microphone Device Selection */}
            {captureSource === 'microphone' && (
                <div className="mb-6">
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Microphone</label>
                    {micDevices.length === 0 && !isLoadingDevices ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            No microphone devices found. Grant microphone permission to see available devices.
                        </p>
                    ) : (
                        <div className="relative">
                            <select
                                value={selectedMicrophoneId}
                                onChange={(e) => setSelectedMicrophoneId(e.target.value)}
                                disabled={isLoadingDevices}
                                className="w-full p-2 pr-9 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white appearance-none"
                            >
                                <option value="">Default Microphone</option>
                                {micDevices.map((device) => (
                                    <option key={device.id} value={device.id}>
                                        {device.label}{device.isDefault ? ' (Default)' : ''}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={refreshDevices}
                                disabled={isLoadingDevices}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                title="Refresh devices"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDevices ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    )}
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Choose a specific microphone, or leave as default to use the system default.
                    </p>
                </div>
            )}

            {/* Language Override */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Language Override</label>
                <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full p-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                >
                    <option value="">Use global default</option>
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
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Override the global language setting for your transcription. Leave empty to use the global default.
                </p>
            </div>

            {/* Super Admin Notice */}
            {isSuperadmin && (
                <div className="mb-6 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
                    <div className="flex items-center gap-2">
                        <Settings className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span className="text-sm text-amber-800 dark:text-amber-300">
                            <strong>Super Admin:</strong> You can configure the global transcription provider in the
                            <strong> Admin Panel</strong> (click the shield icon in the header).
                        </span>
                    </div>
                </div>
            )}

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
