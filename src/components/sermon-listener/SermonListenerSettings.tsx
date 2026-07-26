import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { useNativeAudioCapture } from '../../services/sermon-listener/nativeAudioCapture'
import { useAudioDevices, saveSelectedDeviceLabel } from '../../hooks/useAudioDevices'
import { audioFeedbackService } from '../../services/sermon-listener/audioFeedback'
import { DEFAULT_NATIVE_MODEL_ID } from '../../services/sermon-listener/nativeModelManager'
import { NativeModelPicker } from './NativeModelPicker'
import { LLM_PROVIDERS, DEFAULT_LLM_PROVIDER_ID, getLlmProvider } from '../../services/sermon-listener/llmProviders'
import { listModels } from '../../services/sermon-listener/llmClient'
import { Mic, Monitor, RefreshCw, Info, Loader2 } from 'lucide-react'
import { AudioLevelTest } from './AudioLevelTest'

const CUSTOM_MODEL_OPTION = '__custom__'

// The spoken phrases the sermon listener recognizes (see
// services/sermon-listener/voiceCommandDetection). Shown as a quick reference
// so operators know what they can say; phrasing is flexible — these are
// representative examples, not the only accepted wording.
const VOICE_COMMAND_EXAMPLES: { say: string; does: string }[] = [
    { say: 'next verse', does: 'advance one verse' },
    { say: 'previous verse', does: 'go back one verse' },
    { say: 'next chapter', does: 'jump a chapter forward' },
    { say: 'previous chapter', does: 'jump a chapter back' },
    { say: 'go to verse 7', does: 'jump within the chapter' },
    { say: 'open Psalm 23', does: 'load a reference' },
    { say: 'switch to NIV', does: 'change Bible version' },
    { say: 'put that up', does: 'send to live' },
    { say: 'stop listening', does: 'pause the listener' },
    { say: 'start listening', does: 'resume the listener' },
]

interface SermonListenerSettingsProps {
    onClose?: () => void
}

export function SermonListenerSettings({ onClose }: SermonListenerSettingsProps = {}) {
    const settings = useAppStore((state) => state.settings)
    const setAppSettings = useAppStore((state) => state.setAppSettings)
    const songAutoDetect = useAppStore((state) => state.songTracking.autoDetect)
    const setSongAutoDetect = useAppStore((state) => state.setSongAutoDetect)
    const songExternalLyrics = useAppStore((state) => state.songTracking.externalLyrics)
    const setSongExternalLyrics = useAppStore((state) => state.setSongExternalLyrics)
    const llmConfigured = useAppStore((state) => !!(state.settings.llm?.enabled && state.settings.llm?.baseUrl && state.settings.llm?.model))
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

    // Resolve the active provider: explicit selection → inferred from a stored
    // base URL (back-compat) → custom (if a URL exists) → default.
    const llmProvider =
        getLlmProvider(llm?.provider) ??
        LLM_PROVIDERS.find((p) => !!p.baseUrl && p.baseUrl === llm?.baseUrl) ??
        (llm?.baseUrl ? getLlmProvider('custom')! : getLlmProvider(DEFAULT_LLM_PROVIDER_ID)!)
    // Live model list fetched from the provider (where supported), plus a manual
    // "custom model" override.
    const [fetchedModels, setFetchedModels] = useState<string[]>([])
    const [modelsLoading, setModelsLoading] = useState(false)
    const [customModelMode, setCustomModelMode] = useState(false)

    const selectLlmProvider = (id: string) => {
        const next = getLlmProvider(id)
        if (!next) return
        // Preset the base URL from the provider (custom keeps the user's value),
        // and default the model to the provider's first suggestion if the current
        // one isn't valid for the new provider.
        const keepModel = llm?.model && next.models.includes(llm.model)
        setCustomModelMode(false)
        updateLlm({
            provider: id,
            baseUrl: next.isCustom ? (llm?.baseUrl ?? '') : next.baseUrl,
            model: keepModel ? llm?.model : (next.models[0] ?? ''),
        })
    }

    // Fetch the provider's available models when the endpoint/key changes.
    useEffect(() => {
        const baseUrl = llm?.baseUrl
        const apiKey = llm?.apiKey
        if (!llm?.enabled || !baseUrl || !apiKey?.trim()) {
            setFetchedModels([])
            return
        }
        const controller = new AbortController()
        setModelsLoading(true)
        listModels({ baseUrl, apiKey }, controller.signal)
            .then(setFetchedModels)
            .catch(() => setFetchedModels([]))
            .finally(() => setModelsLoading(false))
        return () => controller.abort()
    }, [llm?.enabled, llm?.baseUrl, llm?.apiKey])

    // Curated suggestions first, then any extra live models; deduped.
    const modelOptions = Array.from(new Set([...llmProvider.models, ...fetchedModels]))
    const isCustomModel = !!llm?.model && !modelOptions.includes(llm.model)
    const showCustomModelInput = customModelMode || isCustomModel

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

                <div className="flex items-center justify-between">
                    <div>
                        <div className="font-medium text-gray-900 dark:text-white">Voice commands</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            Act on phrases heard in the sermon — “next verse”, “switch to NIV”, “put that up”
                        </div>
                    </div>
                    <button
                        onClick={() => update({ enableVoiceCommands: !(sermon?.enableVoiceCommands ?? true) })}
                        className={`relative w-12 h-6 rounded-full transition-colors ${(sermon?.enableVoiceCommands ?? true) ? 'bg-[var(--accent-teal)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <span
                            className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                            style={{ transform: (sermon?.enableVoiceCommands ?? true) ? 'translateX(28px)' : 'translateX(0)' }}
                        />
                    </button>
                </div>

                {(sermon?.enableVoiceCommands ?? true) && (
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Things you can say</div>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                            {VOICE_COMMAND_EXAMPLES.map((ex) => (
                                <li key={ex.say} className="flex items-baseline gap-1.5">
                                    <span className="font-medium text-gray-800 dark:text-gray-200">“{ex.say}”</span>
                                    <span className="opacity-70">— {ex.does}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
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

                    {/* Live signal test for the selected microphone */}
                    <div className="mt-3">
                        <AudioLevelTest deviceId={activeMicId || undefined} />
                    </div>
                </div>
            )}

            {/* Song detection */}
            <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Song detection</label>
                <div className="space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={songAutoDetect}
                            onChange={(e) => setSongAutoDetect(e.target.checked)}
                            className="w-4 h-4 rounded mt-0.5"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                            Auto-detect songs from your library
                            <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                                When singing starts and nothing is on screen, identify the song and pull it up.
                            </span>
                        </span>
                    </label>

                    <label className={`flex items-start gap-2 ${llmConfigured ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                        <input
                            type="checkbox"
                            checked={songExternalLyrics && llmConfigured}
                            disabled={!llmConfigured}
                            onChange={(e) => setSongExternalLyrics(e.target.checked)}
                            className="w-4 h-4 rounded mt-0.5"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                            Look up unknown songs online
                            <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                                {llmConfigured
                                    ? 'If a song isn’t in your library, find it via AI + LRCLIB and import it. Only display songs your church is licensed for (e.g. CCLI).'
                                    : 'Requires an AI provider configured below.'}
                            </span>
                        </span>
                    </label>
                </div>
            </div>

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
                        onClick={() => {
                            const enabling = !(llm?.enabled ?? false)
                            // On first enable, seed a default provider so the
                            // base URL + model are populated (key is all that's left).
                            if (enabling && !llm?.baseUrl && !llm?.provider) {
                                const p = getLlmProvider(DEFAULT_LLM_PROVIDER_ID)!
                                updateLlm({ enabled: true, provider: p.id, baseUrl: p.baseUrl, model: llm?.model || p.models[0] })
                            } else {
                                updateLlm({ enabled: enabling })
                            }
                        }}
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
                        {/* Provider */}
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Provider</label>
                        <select
                            value={llmProvider.id}
                            onChange={(e) => selectLlmProvider(e.target.value)}
                            className="w-full p-2 text-sm rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        >
                            {LLM_PROVIDERS.map((p) => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                        </select>

                        {/* Base URL — only for the custom provider */}
                        {llmProvider.isCustom && (
                            <input
                                type="text"
                                value={llm?.baseUrl || ''}
                                onChange={(e) => updateLlm({ baseUrl: e.target.value })}
                                placeholder="Base URL (e.g. https://api.example.com/v1)"
                                className="w-full p-2 text-sm rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                            />
                        )}

                        {/* API key — optional for local providers */}
                        <input
                            type="password"
                            value={llm?.apiKey || ''}
                            onChange={(e) => updateLlm({ apiKey: e.target.value })}
                            placeholder={llmProvider.requiresKey ? 'API key (stored on this device)' : 'API key (optional for local servers)'}
                            className="w-full p-2 text-sm rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                        />

                        {/* Model — a selector of available (live + curated) models, overridable */}
                        <div className="flex items-center gap-2">
                            <select
                                value={showCustomModelInput ? CUSTOM_MODEL_OPTION : (llm?.model || '')}
                                onChange={(e) => {
                                    if (e.target.value === CUSTOM_MODEL_OPTION) {
                                        setCustomModelMode(true)
                                        updateLlm({ model: '' })
                                    } else {
                                        setCustomModelMode(false)
                                        updateLlm({ model: e.target.value })
                                    }
                                }}
                                className="flex-1 p-2 text-sm rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                            >
                                {modelOptions.length === 0 && !showCustomModelInput && (
                                    <option value="" disabled>Select a model…</option>
                                )}
                                {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                                <option value={CUSTOM_MODEL_OPTION}>Custom model…</option>
                            </select>
                            {modelsLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400 flex-shrink-0" />}
                        </div>
                        {showCustomModelInput && (
                            <input
                                type="text"
                                value={llm?.model || ''}
                                onChange={(e) => updateLlm({ model: e.target.value })}
                                placeholder={llmProvider.models[0] ? `Model id (e.g. ${llmProvider.models[0]})` : 'Model id'}
                                className="w-full p-2 text-sm rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                            />
                        )}

                        {llmProvider.hint && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">{llmProvider.hint}</p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <Info className="w-3 h-3 flex-shrink-0" />
                            AI-found references are added to the detected list; your local detection always runs first.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}

export default SermonListenerSettings