import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useNativeAudioCapture } from '../../services/sermon-listener/nativeAudioCapture'
import { useAudioDevices, saveSelectedDeviceLabel } from '../../hooks/useAudioDevices'
import { audioFeedbackService } from '../../services/sermon-listener/audioFeedback'
import { DEFAULT_NATIVE_MODEL_ID } from '../../services/sermon-listener/nativeModelManager'
import { NativeModelPicker } from './NativeModelPicker'
import { Mic, Monitor, RefreshCw, Info } from 'lucide-react'

interface SermonListenerSettingsProps {
    onClose?: () => void
}

export function SermonListenerSettings({ onClose }: SermonListenerSettingsProps = {}) {
    const settings = useAppStore((state) => state.settings)
    const setAppSettings = useAppStore((state) => state.setAppSettings)
    const { systemAudioSupported } = useNativeAudioCapture()

    const [audioFeedback, setAudioFeedbackState] = useState(() => audioFeedbackService.isEnabled())
    const toggleAudioFeedback = () => {
        const next = !audioFeedback
        audioFeedbackService.setEnabled(next)
        setAudioFeedbackState(next)
        if (next) audioFeedbackService.playStart() // preview the cue when enabling
    }

    const sermon = settings.sermonListener

    const update = (patch: Record<string, unknown>) => {
        setAppSettings({
            ...settings,
            sermonListener: {
                ...settings.sermonListener,
                ...patch,
            },
        })
    }

    const llm = settings.llm
    const updateLlm = (patch: Record<string, unknown>) => {
        setAppSettings({
            ...settings,
            llm: {
                ...settings.llm,
                ...patch,
            },
        })
    }

    const { devices: micDevices, isLoading: isLoadingDevices, refresh: refreshDevices, resolvedDeviceId } = useAudioDevices()

    // Use the resolved device ID (from label persistence) if available,
    // otherwise fall back to the stored deviceId
    const activeMicId = sermon?.selectedMicrophoneId || resolvedDeviceId || ''

    const handleDeviceChange = (deviceId: string) => {
        // Find the label for this device to persist it
        const selectedDevice = micDevices.find(d => d.id === deviceId)
        if (selectedDevice) {
            saveSelectedDeviceLabel(selectedDevice.label)
        } else if (!deviceId) {
            saveSelectedDeviceLabel(null)
        }
        update({ selectedMicrophoneId: deviceId })
    }

    return (
        <div className="space-y-6">
            {/* Behavior */}
            <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Behavior</label>

                <div className="flex items-center justify-between">
                    <div>
                        <div className="font-medium text-gray-900 dark:text-white">Auto-lookup verses</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            Fetch scripture content when a verse is detected
                        </div>
                    </div>
                    <button
                        onClick={() => update({ autoLookup: !(sermon?.autoLookup ?? true) })}
                        className={`relative w-12 h-6 rounded-full transition-colors ${(sermon?.autoLookup ?? true) ? 'bg-[var(--accent-teal)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <span
                            className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                            style={{ transform: (sermon?.autoLookup ?? true) ? 'translateX(28px)' : 'translateX(0)' }}
                        />
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div>
                        <div className="font-medium text-gray-900 dark:text-white">Auto-display on live view</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            Show detected verses on the live output automatically
                        </div>
                    </div>
                    <button
                        onClick={() => update({ autoDisplay: !(sermon?.autoDisplay ?? false) })}
                        className={`relative w-12 h-6 rounded-full transition-colors ${(sermon?.autoDisplay ?? false) ? 'bg-[var(--accent-teal)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <span
                            className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                            style={{ transform: (sermon?.autoDisplay ?? false) ? 'translateX(28px)' : 'translateX(0)' }}
                        />
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <div>
                        <div className="font-medium text-gray-900 dark:text-white">Audio feedback</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            Play a chime when listening starts and stops
                        </div>
                    </div>
                    <button
                        onClick={toggleAudioFeedback}
                        className={`relative w-12 h-6 rounded-full transition-colors ${audioFeedback ? 'bg-[var(--accent-teal)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <span
                            className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                            style={{ transform: audioFeedback ? 'translateX(28px)' : 'translateX(0)' }}
                        />
                    </button>
                </div>
            </div>

            {/* Audio Source */}
            <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Audio Source</label>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={() => update({ captureSource: 'microphone' })}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${(sermon?.captureSource || 'microphone') === 'microphone'
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
                        onClick={() => systemAudioSupported && update({ captureSource: 'system' })}
                        disabled={!systemAudioSupported}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${!systemAudioSupported
                            ? 'opacity-50 grayscale cursor-not-allowed border-gray-200 dark:border-gray-700'
                            : sermon?.captureSource === 'system'
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
            {(sermon?.captureSource || 'microphone') === 'microphone' && (
                <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Microphone</label>
                    <div className="relative">
                        <select
                            value={activeMicId}
                            onChange={(e) => handleDeviceChange(e.target.value)}
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
                    value={sermon?.language || 'en-US'}
                    onChange={(e) => update({ language: e.target.value })}
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

            {/* Transcription model */}
            <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Transcription model</label>
                <NativeModelPicker
                    selectedId={sermon?.whisperModel || DEFAULT_NATIVE_MODEL_ID}
                    onSelect={(id) => update({ whisperModel: id })}
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <Info className="w-3 h-3 flex-shrink-0" />
                    All models run on-device and download once. Whisper is GPU-accelerated;
                    Parakeet and other multilingual models add automatic language detection.
                    Higher accuracy generally means slower.
                </p>
            </div>

            {/* AI verse extraction (optional, OpenAI-compatible) */}
            <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="font-medium text-gray-900 dark:text-white">AI verse extraction</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            Optional. Uses an OpenAI-compatible LLM to catch references the
                            detector misses. Leave off to stay fully offline.
                        </div>
                    </div>
                    <button
                        onClick={() => updateLlm({ enabled: !(llm?.enabled ?? false) })}
                        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${llm?.enabled ? 'bg-[var(--accent-teal)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <span
                            className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                            style={{ transform: llm?.enabled ? 'translateX(28px)' : 'translateX(0)' }}
                        />
                    </button>
                </div>

                {llm?.enabled && (
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={llm?.baseUrl || ''}
                            onChange={(e) => updateLlm({ baseUrl: e.target.value })}
                            placeholder="Base URL (e.g. https://api.openai.com/v1)"
                            className="w-full p-2 text-sm rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <input
                            type="password"
                            value={llm?.apiKey || ''}
                            onChange={(e) => updateLlm({ apiKey: e.target.value })}
                            placeholder="API key (stored on this device)"
                            className="w-full p-2 text-sm rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <input
                            type="text"
                            value={llm?.model || ''}
                            onChange={(e) => updateLlm({ model: e.target.value })}
                            placeholder="Model (e.g. gpt-4o-mini)"
                            className="w-full p-2 text-sm rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <Info className="w-3 h-3 flex-shrink-0" />
                            Verse references found by the AI are added to the detected list; your local detection always runs first.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}

export default SermonListenerSettings