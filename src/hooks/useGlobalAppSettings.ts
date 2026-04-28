import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useUserRole } from './useUserRole'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { cacheAppSetting, getCachedAppSetting } from './useIndexedDB'
import { useState, useEffect } from 'react'

export interface GlobalAppSettings {
    _id?: string
    sermonListener_transcriptionProvider?: string
    sermonListener_whisperModel?: string
    sermonListener_whisperEndpoint?: string
    sermonListener_whisperApiKey?: string
    sermonListener_whisperChunkDurationMs?: number
    sermonListener_whisperCppEndpoint?: string
    sermonListener_whisperCppChunkDurationMs?: number
    sermonListener_fasterWhisperEndpoint?: string
    sermonListener_fasterWhisperModel?: string
    sermonListener_fasterWhisperChunkDurationMs?: number
    sermonListener_fasterWhisperAudioCaptureMode?: string
    sermonListener_fasterWhisperDisableBrowserProcessing?: boolean
    sermonListener_useVAD?: boolean
    sermonListener_vadPositiveSpeechThreshold?: number
    sermonListener_vadNegativeSpeechThreshold?: number
    sermonListener_vadMinSpeechFrames?: number
    sermonListener_vadPreSpeechPadFrames?: number
    sermonListener_vadRedemptionFrames?: number
    sermonListener_elevenLabsApiKey?: string
    sermonListener_elevenLabsModelId?: string
    sermonListener_elevenLabsChunkDurationMs?: number
    sermonListener_defaultLanguage?: string
    exists?: boolean
}

export interface TranscriptionConfig {
    provider: string
    language: string
    config: Record<string, unknown>
}

export interface UseGlobalAppSettingsReturn {
    settings: GlobalAppSettings | null
    transcriptionConfig: TranscriptionConfig | null
    isLoading: boolean
    canEdit: boolean
    isOfflineMode: boolean
    updateSettings: (settings: Partial<GlobalAppSettings>) => Promise<{ success: boolean; action?: string; error?: string }>
}

export function useGlobalAppSettings(): UseGlobalAppSettingsReturn {
    const { isSuperadmin, isLoading: isRoleLoading } = useUserRole()
    const { isOffline } = useConvexConnection()

    const settings = useQuery(api.globalAppSettings.getGlobalSettings, {})
    const transcriptionConfig = useQuery(api.globalAppSettings.getTranscriptionConfig, {})

    const [cachedSettings, setCachedSettings] = useState<GlobalAppSettings | null>(null)
    const [cachedConfig, setCachedConfig] = useState<TranscriptionConfig | null>(null)

    const [cacheChecked, setCacheChecked] = useState(false)

    useEffect(() => {
        if (!isOffline) return

        const loadCached = async () => {
            try {
                const cachedSetting = await getCachedAppSetting('globalSettings')
                if (cachedSetting) setCachedSettings(cachedSetting.data)
                const cachedConf = await getCachedAppSetting('transcriptionConfig')
                if (cachedConf) setCachedConfig(cachedConf.data)
            } catch (err) {
                console.warn('[useGlobalAppSettings] Failed to load cached settings:', err)
            } finally {
                setCacheChecked(true)
            }
        }
        loadCached()
    }, [isOffline])

    useEffect(() => {
        if (settings) {
            cacheAppSetting('globalSettings', settings).catch(() => {})
        }
    }, [settings])

    useEffect(() => {
        if (transcriptionConfig) {
            cacheAppSetting('transcriptionConfig', transcriptionConfig).catch(() => {})
        }
    }, [transcriptionConfig])

    const updateSettingsMutation = useMutation(api.globalAppSettings.updateGlobalSettings)

    const effectiveSettings = settings ?? cachedSettings
    const effectiveConfig = transcriptionConfig ?? cachedConfig

    const isLoading = isOffline
        ? isRoleLoading || !cacheChecked
        : isRoleLoading || (settings === undefined && !cachedSettings) || (transcriptionConfig === undefined && !cachedConfig)
    const canEdit = isSuperadmin

    const updateSettings = async (newSettings: Partial<GlobalAppSettings>) => {
        if (!canEdit) {
            return { success: false, error: 'Only system super admins can update global settings' }
        }

        try {
            const result = await updateSettingsMutation(newSettings)
            await cacheAppSetting('globalSettings', { ...effectiveSettings, ...newSettings })
            return result
        } catch (error) {
            console.error('Failed to update global app settings:', error)
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
        }
    }

    return {
        settings: effectiveSettings || null,
        transcriptionConfig: effectiveConfig || null,
        isLoading,
        canEdit,
        isOfflineMode: isOffline,
        updateSettings,
    }
}

export function useTranscriptionConfig() {
    const transcriptionConfig = useQuery(api.globalAppSettings.getTranscriptionConfig, {})
    const { isOffline } = useConvexConnection()
    const [cachedConfig, setCachedConfig] = useState<TranscriptionConfig | null>(null)

    useEffect(() => {
        if (transcriptionConfig) {
            cacheAppSetting('transcriptionConfig', transcriptionConfig).catch(() => {})
        }
    }, [transcriptionConfig])

    useEffect(() => {
        if (!isOffline) return

        const loadCached = async () => {
            try {
                const cached = await getCachedAppSetting('transcriptionConfig')
                if (cached) setCachedConfig(cached.data)
            } catch {}
        }
        loadCached()
    }, [isOffline])

    return {
        config: transcriptionConfig ?? cachedConfig ?? null,
        isLoading: transcriptionConfig === undefined && !cachedConfig,
    }
}

export const useGlobalSermonListenerSettings = useGlobalAppSettings
export type { GlobalAppSettings as GlobalSermonListenerSettings, UseGlobalAppSettingsReturn as UseGlobalSermonListenerSettingsReturn }