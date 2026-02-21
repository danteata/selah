/**
 * Hook for accessing global app settings
 *
 * These settings are managed by system super admins and apply to ALL users across ALL churches.
 * The hook provides both read and write access (for super admins).
 */

import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useUserRole } from './useUserRole'

// Types for global settings - using the prefixed field names from schema
export interface GlobalAppSettings {
    _id?: string
    // Sermon Listener settings (prefixed)
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
    updateSettings: (settings: Partial<GlobalAppSettings>) => Promise<{ success: boolean; action?: string; error?: string }>
}

/**
 * Hook to access global app settings (system-wide)
 * No churchId needed - settings apply to all users across all churches
 */
export function useGlobalAppSettings(): UseGlobalAppSettingsReturn {
    const { isSuperadmin, isLoading: isRoleLoading } = useUserRole()

    // Query global settings (no churchId needed)
    const settings = useQuery(api.globalAppSettings.getGlobalSettings, {})

    // Query transcription config (simplified version for the transcription service)
    const transcriptionConfig = useQuery(api.globalAppSettings.getTranscriptionConfig, {})

    // Mutation to update settings
    const updateSettingsMutation = useMutation(api.globalAppSettings.updateGlobalSettings)

    const isLoading = isRoleLoading || settings === undefined || transcriptionConfig === undefined
    const canEdit = isSuperadmin

    const updateSettings = async (newSettings: Partial<GlobalAppSettings>) => {
        if (!canEdit) {
            return { success: false, error: 'Only system super admins can update global settings' }
        }

        try {
            const result = await updateSettingsMutation(newSettings)
            return result
        } catch (error) {
            console.error('Failed to update global app settings:', error)
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
        }
    }

    return {
        settings: settings || null,
        transcriptionConfig: transcriptionConfig || null,
        isLoading,
        canEdit,
        updateSettings,
    }
}

/**
 * Hook to get just the transcription config for the transcription service
 * This is a lighter-weight hook for components that only need the config
 */
export function useTranscriptionConfig() {
    const transcriptionConfig = useQuery(api.globalAppSettings.getTranscriptionConfig, {})

    return {
        config: transcriptionConfig || null,
        isLoading: transcriptionConfig === undefined,
    }
}

// Legacy export for backwards compatibility
export const useGlobalSermonListenerSettings = useGlobalAppSettings
export type { GlobalAppSettings as GlobalSermonListenerSettings, UseGlobalAppSettingsReturn as UseGlobalSermonListenerSettingsReturn }
