/**
 * Global App Settings
 *
 * These settings are managed by system super admins and apply to ALL users across ALL churches.
 * This is a SINGLE document for the entire system (singleton pattern).
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, isSuperadmin, requireSuperadmin } from "./lib/auth";

// Provider credentials live in this document. Only a superadmin (who edits
// them) ever receives them; everyone else gets the settings without.
const SECRET_FIELDS = ["sermonListener_whisperApiKey", "sermonListener_elevenLabsApiKey"] as const;

// Default settings
const DEFAULT_SETTINGS = {
    // Sermon Listener defaults
    sermonListener_transcriptionProvider: "web-speech",
    sermonListener_whisperModel: "base",
    sermonListener_whisperChunkDurationMs: 2500,
    sermonListener_whisperCppEndpoint: "/whisper-cpp/inference",
    sermonListener_whisperCppChunkDurationMs: 2500,
    sermonListener_fasterWhisperEndpoint: "/faster-whisper",
    sermonListener_fasterWhisperModel: "base",
    sermonListener_fasterWhisperChunkDurationMs: 2000,
    sermonListener_fasterWhisperAudioCaptureMode: "browser-wav",
    sermonListener_fasterWhisperDisableBrowserProcessing: false,
    sermonListener_useVAD: false,
    sermonListener_elevenLabsModelId: "scribe_v1",
    sermonListener_elevenLabsChunkDurationMs: 2500,
    sermonListener_defaultLanguage: "en-US",
};


/**
 * Get global app settings (system-wide)
 * This returns the single settings document for the entire system
 */
export const getGlobalSettings = query({
    args: {},
    handler: async (ctx) => {
        // Get the first (and only) settings document
        const settings = await ctx.db
            .query("globalAppSettings")
            .first();

        if (!settings) {
            return {
                ...DEFAULT_SETTINGS,
                exists: false,
            };
        }

        const user = await getCurrentUser(ctx);
        const visible: Record<string, unknown> = { ...settings };
        if (!user || !isSuperadmin(user)) {
            for (const field of SECRET_FIELDS) delete visible[field];
        }

        return {
            ...DEFAULT_SETTINGS,
            ...visible,
            exists: true,
        };
    },
});

/**
 * Update global app settings
 * Only system super admins can update these settings
 */
export const updateGlobalSettings = mutation({
    args: {
        // Sermon Listener settings
        sermonListener_transcriptionProvider: v.optional(v.string()),
        sermonListener_whisperModel: v.optional(v.string()),
        sermonListener_whisperEndpoint: v.optional(v.string()),
        sermonListener_whisperApiKey: v.optional(v.string()),
        sermonListener_whisperChunkDurationMs: v.optional(v.number()),
        sermonListener_whisperCppEndpoint: v.optional(v.string()),
        sermonListener_whisperCppChunkDurationMs: v.optional(v.number()),
        sermonListener_fasterWhisperEndpoint: v.optional(v.string()),
        sermonListener_fasterWhisperModel: v.optional(v.string()),
        sermonListener_fasterWhisperChunkDurationMs: v.optional(v.number()),
        sermonListener_fasterWhisperAudioCaptureMode: v.optional(v.string()),
        sermonListener_fasterWhisperDisableBrowserProcessing: v.optional(v.boolean()),
        sermonListener_useVAD: v.optional(v.boolean()),
        sermonListener_vadPositiveSpeechThreshold: v.optional(v.number()),
        sermonListener_vadNegativeSpeechThreshold: v.optional(v.number()),
        sermonListener_vadMinSpeechFrames: v.optional(v.number()),
        sermonListener_vadPreSpeechPadFrames: v.optional(v.number()),
        sermonListener_vadRedemptionFrames: v.optional(v.number()),
        sermonListener_elevenLabsApiKey: v.optional(v.string()),
        sermonListener_elevenLabsModelId: v.optional(v.string()),
        sermonListener_elevenLabsChunkDurationMs: v.optional(v.number()),
        sermonListener_defaultLanguage: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await requireSuperadmin(ctx);
        const now = new Date().toISOString();

        const existingSettings = await ctx.db
            .query("globalAppSettings")
            .first();

        // Only the fields this call actually sets. Patching an explicit
        // `undefined` deletes the field, so writing every key wiped whatever
        // the caller left out — the admin form sends three, and each save
        // erased the rest (endpoints, chunk sizes, VAD thresholds, API keys).
        const settingsData: Record<string, unknown> = { updatedAt: now, updatedBy: user._id };
        for (const [key, value] of Object.entries(args)) {
            if (value !== undefined) settingsData[key] = value;
        }

        if (existingSettings) {
            // Update existing settings
            await ctx.db.patch(existingSettings._id, settingsData);
            return { success: true, action: "updated" };
        } else {
            // Create new settings
            await ctx.db.insert("globalAppSettings", {
                ...DEFAULT_SETTINGS,
                ...settingsData,
                createdAt: now,
                updatedAt: now,
                updatedBy: user._id,
            });
            return { success: true, action: "created" };
        }
    },
});

/**
 * Initialize default settings if they don't exist
 * Called when the app is first set up
 */
export const initializeDefaultSettings = mutation({
    args: {},
    handler: async (ctx) => {
        await requireSuperadmin(ctx);
        // Check if settings already exist
        const existingSettings = await ctx.db
            .query("globalAppSettings")
            .first();

        if (existingSettings) {
            return { success: true, action: "already_exists" };
        }

        const now = new Date().toISOString();

        // Create default settings
        await ctx.db.insert("globalAppSettings", {
            ...DEFAULT_SETTINGS,
            createdAt: now,
            updatedAt: now,
            updatedBy: "system",
        });

        return { success: true, action: "created" };
    },
});

/**
 * Get the transcription provider configuration
 * This is a simplified query that returns only the necessary fields
 * for the transcription service
 */
export const getTranscriptionConfig = query({
    args: {},
    handler: async (ctx) => {
        // API keys are deliberately absent from this config: it goes to every
        // signed-in client, and none of the providers still in use needs one.
        const settings = await ctx.db
            .query("globalAppSettings")
            .first();

        if (!settings) {
            return {
                provider: DEFAULT_SETTINGS.sermonListener_transcriptionProvider,
                language: DEFAULT_SETTINGS.sermonListener_defaultLanguage,
                config: {},
            };
        }

        const provider = settings.sermonListener_transcriptionProvider || DEFAULT_SETTINGS.sermonListener_transcriptionProvider;
        const language = settings.sermonListener_defaultLanguage || DEFAULT_SETTINGS.sermonListener_defaultLanguage;

        // Build provider-specific config
        let config: Record<string, unknown> = {};

        switch (provider) {
            case "whisper":
                config = {
                    model: settings.sermonListener_whisperModel || DEFAULT_SETTINGS.sermonListener_whisperModel,
                    endpoint: settings.sermonListener_whisperEndpoint,
                    chunkDurationMs: settings.sermonListener_whisperChunkDurationMs || DEFAULT_SETTINGS.sermonListener_whisperChunkDurationMs,
                };
                break;

            case "whisper-cpp":
                config = {
                    endpoint: settings.sermonListener_whisperCppEndpoint || DEFAULT_SETTINGS.sermonListener_whisperCppEndpoint,
                    chunkDurationMs: settings.sermonListener_whisperCppChunkDurationMs || DEFAULT_SETTINGS.sermonListener_whisperCppChunkDurationMs,
                };
                break;

            case "faster-whisper":
                config = {
                    endpoint: settings.sermonListener_fasterWhisperEndpoint || DEFAULT_SETTINGS.sermonListener_fasterWhisperEndpoint,
                    model: settings.sermonListener_fasterWhisperModel || DEFAULT_SETTINGS.sermonListener_fasterWhisperModel,
                    chunkDurationMs: settings.sermonListener_fasterWhisperChunkDurationMs || DEFAULT_SETTINGS.sermonListener_fasterWhisperChunkDurationMs,
                    audioCaptureMode: settings.sermonListener_fasterWhisperAudioCaptureMode || DEFAULT_SETTINGS.sermonListener_fasterWhisperAudioCaptureMode,
                    disableBrowserProcessing: settings.sermonListener_fasterWhisperDisableBrowserProcessing ?? DEFAULT_SETTINGS.sermonListener_fasterWhisperDisableBrowserProcessing,
                    useVAD: settings.sermonListener_useVAD ?? DEFAULT_SETTINGS.sermonListener_useVAD,
                    vadConfig: {
                        positiveSpeechThreshold: settings.sermonListener_vadPositiveSpeechThreshold,
                        negativeSpeechThreshold: settings.sermonListener_vadNegativeSpeechThreshold,
                        minSpeechFrames: settings.sermonListener_vadMinSpeechFrames,
                        preSpeechPadFrames: settings.sermonListener_vadPreSpeechPadFrames,
                        redemptionFrames: settings.sermonListener_vadRedemptionFrames,
                    },
                };
                break;

            case "elevenlabs":
                config = {
                    modelId: settings.sermonListener_elevenLabsModelId || DEFAULT_SETTINGS.sermonListener_elevenLabsModelId,
                    chunkDurationMs: settings.sermonListener_elevenLabsChunkDurationMs || DEFAULT_SETTINGS.sermonListener_elevenLabsChunkDurationMs,
                };
                break;

            case "web-speech":
            default:
                config = {};
                break;
        }

        return {
            provider,
            language,
            config,
        };
    },
});
