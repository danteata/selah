import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useNativeAudioCapture } from '../../services/sermon-listener/nativeAudioCapture'
import { useAudioDevices } from '../../hooks/useAudioDevices'
import { Check, Mic, Monitor, RefreshCw, Info } from 'lucide-react'

interface SermonListenerSettingsProps {
    onClose?: () => void
}

export function SermonListenerSettings({ onClose }: SermonListenerSettingsProps = {}) {
    const sermonSettings = useAppStore((state) => state.settings.sermonListener)
    const setAppSettings = useAppStore((state) => state.setAppSettings)
    const { systemAudioSupported } = useNativeAudioCapture()

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
        setShowSaveSuccess(true)
        setTimeout(() => {
            setShowSaveSuccess(false)
            onClose?.()
        }, 1500)
    }

    return (
        <div className="space-y-6">
            {/* Success Toast */}
            {showSaveSuccess && (
                <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg shadow-lg animate-fade-in">
                    <Check className="w-4 h-4" />
                    <span className="text-sm font-medium">Settings saved!</span>
                </div>
            )}

            {/* Behavior */}
            <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Behavior</label>

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
                            Fetch scripture content when a verse is detected
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
                            Show detected verses on the live output automatically
                        </div>
                    </div>
                </label>
            </div>

            {/* Audio Source */}
            <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Audio Source</label>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={() => setCaptureSource('microphone')}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${captureSource === 'microphone'
                            ? 'border-[var(--accent-teal)] bg-blue-50 dark:bg-blue-900/20 text-[var(--accent-teal)] dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-600 dark:text-gray-400'
                        }`}
                    >
                        <Mic className="w-5 h-5" />
                        <div className="text-left">
                            <div className="font-medium text-sm">Microphone</div>
                            <div className="text-xs opacity-70">External or built-in</div>
                        </div>
                    </button>
                    <button
                        onClick={() => systemAudioSupported && setCaptureSource('system')}
                        disabled={!systemAudioSupported}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${!systemAudioSupported
                            ? 'opacity-50 grayscale cursor-not-allowed border-gray-200 dark:border-gray-700'
                            : captureSource === 'system'
                                ? 'border-[var(--accent-teal)] bg-blue-50 dark:bg-blue-900/20 text-[var(--accent-teal)] dark:text-blue-300'
                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-600 dark:text-gray-400'
                        }`}
                    >
                        <Monitor className="w-5 h-5" />
                        <div className="text-left">
                            <div className="font-medium text-sm">System Audio</div>
                            <div className="text-xs opacity-70">Speaker output</div>
                        </div>
                    </button>
                </div>
                {!systemAudioSupported && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        System audio capture is not available on this platform.
                    </p>
                )}
            </div>

            {/* Microphone Device */}
            {captureSource === 'microphone' && (
                <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Microphone</label>
                    <div className="relative">
                        <select
                            value={selectedMicrophoneId}
                            onChange={(e) => setSelectedMicrophoneId(e.target.value)}
                            disabled={isLoadingDevices}
                            className="w-full p-2 pr-9 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white appearance-none"
                        >
                            <option value="">Default</option>
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
                </div>
            )}

            {/* Language */}
            <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Language</label>
                <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
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

            {/* Save */}
            <div className="flex justify-end gap-3 pt-2">
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
                    className="px-4 py-2 bg-[var(--accent-teal)] hover:brightness-110 text-white rounded-lg transition-all shadow-sm"
                >
                    Save
                </button>
            </div>
        </div>
    )
}

export default SermonListenerSettings