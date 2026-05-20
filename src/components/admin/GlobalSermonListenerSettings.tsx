/**
 * Global Sermon Listener Settings Panel
 *
 * Allows super admins to configure the global sermon listener provider.
 * Only two providers are now supported: Web Speech API (browser) and
 * Desktop Whisper (local transcription).
 */

import { useEffect, useState } from 'react'
import { useUserRole } from '../../hooks/useUserRole'
import { useGlobalSermonListenerSettings } from '../../hooks/useGlobalAppSettings'
import { unifiedTranscriptionService } from '../../services/sermon-listener'
import type { TranscriptionProvider } from '../../services/sermon-listener'
import { IconWrapper } from '../utils/IconWrapper'
import { Info, Check, AlertTriangle, Shield, Loader2, Monitor } from 'lucide-react'
import { isDesktop } from '@/platform'

const DEFAULT_CHUNK_DURATION_MS = 2500

interface GlobalSermonListenerSettingsPanelProps {
    onClose?: () => void
}

export function GlobalSermonListenerSettingsPanel({ onClose }: GlobalSermonListenerSettingsPanelProps) {
    const { isSuperadmin, isLoading: isRoleLoading } = useUserRole()
    const { settings, isLoading: isSettingsLoading, canEdit, updateSettings } = useGlobalSermonListenerSettings()

    const [provider, setProvider] = useState<TranscriptionProvider>('web-speech')
    const [useVAD, setUseVAD] = useState(false)
    const [defaultLanguage, setDefaultLanguage] = useState('en-US')

    const [isSaving, setIsSaving] = useState(false)
    const [isLoadingProvider, setIsLoadingProvider] = useState(false)
    const [loadingProgress, setLoadingProgress] = useState(0)
    const [providerError, setProviderError] = useState<string | null>(null)
    const [showSaveSuccess, setShowSaveSuccess] = useState(false)
    const [webSpeechAvailable, setWebSpeechAvailable] = useState(false)
    const [desktopWhisperAvailable, setDesktopWhisperAvailable] = useState(false)

    useEffect(() => {
        if (settings) {
            setProvider((settings.sermonListener_transcriptionProvider as TranscriptionProvider) || 'web-speech')
            setUseVAD(settings.sermonListener_useVAD ?? false)
            setDefaultLanguage(settings.sermonListener_defaultLanguage || 'en-US')
        }
    }, [settings])

    useEffect(() => {
        unifiedTranscriptionService.isProviderAvailable('web-speech').then(setWebSpeechAvailable)
        unifiedTranscriptionService.isProviderAvailable('desktop-whisper').then(setDesktopWhisperAvailable)
    }, [])

    const handleProviderChange = async (newProvider: TranscriptionProvider) => {
        setProviderError(null)
        setProvider(newProvider)

        if (newProvider === 'web-speech') {
            return
        }

        if (newProvider === 'desktop-whisper' && !isDesktop()) {
            setProvider('web-speech')
            setProviderError('Local transcription is only available in the desktop app.')
            return
        }

        setIsLoadingProvider(true)
        setLoadingProgress(0)

        const success = await unifiedTranscriptionService.setProvider(newProvider, {
            language: defaultLanguage.split('-')[0],
            useVAD,
            onProgress: setLoadingProgress,
        })

        setIsLoadingProvider(false)
        if (!success) {
            setProvider('web-speech')
            setProviderError(`Failed to initialize transcription. Check settings and try again.`)
        }
    }

    const saveSettings = async () => {
        if (!canEdit) {
            return
        }

        setIsSaving(true)
        try {
            const result = await updateSettings({
                sermonListener_transcriptionProvider: provider,
                sermonListener_useVAD: useVAD,
                sermonListener_defaultLanguage: defaultLanguage,
            })

            if (result.success) {
                setShowSaveSuccess(true)
                setTimeout(() => setShowSaveSuccess(false), 2000)
            } else {
                setProviderError(result.error || 'Failed to save settings')
            }
        } finally {
            setIsSaving(false)
        }
    }

    if (isRoleLoading || isSettingsLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">Loading settings...</span>
            </div>
        )
    }

    if (!isSuperadmin) {
        return (
            <div className="p-6 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
                <div className="flex items-center gap-3">
                    <Shield className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                    <div>
                        <h3 className="font-semibold text-amber-800 dark:text-amber-300">Super Admin Access Required</h3>
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                            Only super admins can configure global sermon listener settings.
                        </p>
                    </div>
                </div>
            </div>
        )
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

            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-5 h-5 text-primary-500" />
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Global Sermon Listener Settings</h2>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    These settings apply to all users in your church. Changes will take effect immediately.
                </p>
            </div>

            {/* Provider Selection */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">Transcription Provider</label>
                <div className="space-y-3">
                    <button
                        onClick={() => !isLoadingProvider && handleProviderChange('web-speech')}
                        disabled={isLoadingProvider || !webSpeechAvailable}
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

                    {/* Desktop Whisper - Only show in desktop mode */}
                    {isDesktop() && (
                        <button
                            onClick={() => !isLoadingProvider && handleProviderChange('desktop-whisper')}
                            disabled={isLoadingProvider}
                            className={`w-full p-4 rounded-lg border-2 text-left transition-all ${provider === 'desktop-whisper'
                                ? 'border-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Monitor className="w-5 h-5 text-indigo-500" />
                                    <div>
                                <div className="font-medium text-gray-900 dark:text-white">Local Transcription (Offline)</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                    On-device transcription — works offline, no server needed
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!desktopWhisperAvailable && (
                                        <span className="text-xs text-gray-400 dark:text-gray-500">
                                            Starting...
                                        </span>
                                    )}
                                    {provider === 'desktop-whisper' && (
                                        <IconWrapper name="i-bx-check" className="text-indigo-500" />
                                    )}
                                </div>
                            </div>
                        </button>
                    )}
                </div>

                {isLoadingProvider && (
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

            {/* Desktop Whisper Settings */}
            {provider === 'desktop-whisper' && (
                <div className="mb-6 space-y-4">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Desktop Whisper Configuration</h3>

                    {/* VAD Toggle */}
                    <div className="p-4 rounded-lg bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200 dark:border-cyan-700">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="useVAD"
                                    checked={useVAD}
                                    onChange={(e) => setUseVAD(e.target.checked)}
                                    className="rounded border-gray-300 dark:border-gray-600"
                                />
                                <label htmlFor="useVAD" className="font-medium text-cyan-800 dark:text-cyan-300">
                                    Enable VAD Smart Chunking
                                </label>
                            </div>
                        </div>
                        <p className="text-sm text-cyan-700 dark:text-cyan-400">
                            <strong>Recommended for best quality.</strong> Uses browser-based Voice Activity Detection
                            to detect speech boundaries and avoid word cutoffs.
                        </p>
                    </div>
                </div>
            )}

            {/* Default Language */}
            <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Default Language</label>
                <select
                    value={defaultLanguage}
                    onChange={(e) => setDefaultLanguage(e.target.value)}
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

            {/* Save Button */}
            <div className="flex justify-end gap-3">
                <button
                    onClick={saveSettings}
                    disabled={isSaving || !canEdit}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white ${isSaving || !canEdit
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-primary-500 hover:bg-primary-600'
                        }`}
                >
                    {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isSaving ? 'Saving...' : 'Save Global Settings'}
                </button>
            </div>
        </div>
    )
}

export default GlobalSermonListenerSettingsPanel