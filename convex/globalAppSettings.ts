/**
 * Global App Settings
 *
 * These settings are managed by system super admins and apply to ALL users across ALL churches.
 * This is a SINGLE document for the entire system (singleton pattern).
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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

// Singleton document ID - we use a fixed ID for the single global settings document
const GLOBAL_SETTINGS_ID = "global_settings";

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

        return {
            ...DEFAULT_SETTINGS,
            ...settings,
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
        // Get the current user
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        // Get the user to check if they are a super admin
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .first();

        if (!user) {
            throw new Error("User not found");
        }

        // Only super admins can update global settings
        if (user.role !== "superadmin") {
            throw new Error("Only system super admins can update global app settings");
        }

        const now = new Date().toISOString();

        // Check if settings already exist
        const existingSettings = await ctx.db
            .query("globalAppSettings")
            .first();

        const settingsData = {
            sermonListener_transcriptionProvider: args.sermonListener_transcriptionProvider,
            sermonListener_whisperModel: args.sermonListener_whisperModel,
            sermonListener_whisperEndpoint: args.sermonListener_whisperEndpoint,
            sermonListener_whisperApiKey: args.sermonListener_whisperApiKey,
            sermonListener_whisperChunkDurationMs: args.sermonListener_whisperChunkDurationMs,
            sermonListener_whisperCppEndpoint: args.sermonListener_whisperCppEndpoint,
            sermonListener_whisperCppChunkDurationMs: args.sermonListener_whisperCppChunkDurationMs,
            sermonListener_fasterWhisperEndpoint: args.sermonListener_fasterWhisperEndpoint,
            sermonListener_fasterWhisperModel: args.sermonListener_fasterWhisperModel,
            sermonListener_fasterWhisperChunkDurationMs: args.sermonListener_fasterWhisperChunkDurationMs,
            sermonListener_fasterWhisperAudioCaptureMode: args.sermonListener_fasterWhisperAudioCaptureMode,
            sermonListener_fasterWhisperDisableBrowserProcessing: args.sermonListener_fasterWhisperDisableBrowserProcessing,
            sermonListener_useVAD: args.sermonListener_useVAD,
            sermonListener_vadPositiveSpeechThreshold: args.sermonListener_vadPositiveSpeechThreshold,
            sermonListener_vadNegativeSpeechThreshold: args.sermonListener_vadNegativeSpeechThreshold,
            sermonListener_vadMinSpeechFrames: args.sermonListener_vadMinSpeechFrames,
            sermonListener_vadPreSpeechPadFrames: args.sermonListener_vadPreSpeechPadFrames,
            sermonListener_vadRedemptionFrames: args.sermonListener_vadRedemptionFrames,
            sermonListener_elevenLabsApiKey: args.sermonListener_elevenLabsApiKey,
            sermonListener_elevenLabsModelId: args.sermonListener_elevenLabsModelId,
            sermonListener_elevenLabsChunkDurationMs: args.sermonListener_elevenLabsChunkDurationMs,
            sermonListener_defaultLanguage: args.sermonListener_defaultLanguage,
            updatedAt: now,
            updatedBy: user._id,
        };

        if (existingSettings) {
            // Update existing settings
            await ctx.db.patch(existingSettings._id, settingsData);
            return { success: true, action: "updated" };
        } else {
            // Create new settings
            await ctx.db.insert("globalAppSettings", {
                ...settingsData,
                createdAt: now,
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
                    apiKey: settings.sermonListener_whisperApiKey,
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
                    apiKey: settings.sermonListener_elevenLabsApiKey,
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
