import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    // Users table
    users: defineTable({
        _id: v.optional(v.string()),
        clerkId: v.optional(v.string()), // Clerk authentication ID
        fullname: v.string(),
        email: v.string(),
        role: v.union(
            v.literal("superadmin"),
            v.literal("admin"),
            v.literal("member")
        ),
        avatar: v.string(),
        theme: v.string(),
        churchId: v.string(),
        emailVerified: v.optional(v.boolean()),
        subscription: v.optional(v.object({
            plan: v.union(v.literal("free"), v.literal("teams")),
            startDate: v.string(),
            endDate: v.union(v.string(), v.null()),
        })),
        preferences: v.optional(v.string()), // JSON string for user preferences
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_email", ["email"])
        .index("by_church", ["churchId"])
        .index("by_clerk_id", ["clerkId"])
        .index("by_role", ["role"]),

    // Churches table
    churches: defineTable({
        _id: v.optional(v.string()),
        name: v.string(),
        type: v.string(),
        address: v.string(),
        pastor: v.string(),
        userIds: v.optional(v.array(v.string())),
        storageUsed: v.optional(v.number()),
        subscriptionPlan: v.union(v.literal("free"), v.literal("teams")),
        // Default invite code for quick sharing
        defaultInviteCode: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.string(),
    }),

    // Schedules table
    schedules: defineTable({
        _id: v.optional(v.string()),
        name: v.string(),
        authorId: v.string(),
        editorIds: v.optional(v.array(v.string())),
        churchId: v.string(),
        lastUpdated: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_church", ["churchId"])
        .index("by_author", ["authorId"]),

    // Slides table
    slides: defineTable({
        _id: v.optional(v.string()),
        id: v.string(),
        index: v.number(),
        name: v.string(),
        type: v.string(),
        layout: v.string(),
        userId: v.string(),
        churchId: v.string(),
        scheduleId: v.string(),
        contents: v.array(v.string()),
        backgroundType: v.optional(v.string()),
        background: v.optional(v.string()),
        backgroundVideoKey: v.optional(v.union(v.string(), v.null())),
        backgroundStorageId: v.optional(v.union(v.string(), v.null())),
        title: v.optional(v.string()),
        songId: v.optional(v.string()),
        hasChorus: v.optional(v.boolean()),
        data: v.optional(v.union(
            v.object({
                _id: v.optional(v.string()),
                id: v.string(),
                lyrics: v.string(),
                title: v.string(),
                artist: v.string(),
                album: v.optional(v.string()),
                cover: v.optional(v.string()),
                author: v.optional(v.string()),
                verses: v.optional(v.array(v.string())),
                isPublic: v.optional(v.boolean()),
                createdBy: v.optional(v.string()),
                churchId: v.optional(v.string()),
                createdAt: v.optional(v.string()),
                updatedAt: v.optional(v.string()),
            }),
            v.object({
                label: v.string(),
                labelShortFormat: v.string(),
                version: v.string(),
                content: v.union(v.string(), v.array(v.object({
                    book: v.string(),
                    chapter: v.string(),
                    verse: v.string(),
                    scripture: v.string(),
                }))),
            }),
            v.object({
                number: v.string(),
                title: v.string(),
                chorus: v.string(),
                verses: v.array(v.string()),
                author: v.string(),
                source: v.string(),
                meta: v.string(),
            }),
            v.object({
                _id: v.optional(v.string()),
                id: v.string(),
                time: v.string(),
                timeLeft: v.string(),
                content: v.string(),
            }),
            v.object({
                blob: v.optional(v.any()),
                url: v.string(),
            })
        )),
        slideStyle: v.optional(v.object({
            blur: v.optional(v.number()),
            brightness: v.optional(v.number()),
            alignment: v.optional(v.string()),
            font: v.optional(v.string()),
            linesPerSlide: v.optional(v.number()),
            fontSize: v.optional(v.number()),
            fontSizePercent: v.optional(v.number()),
            backgroundFillType: v.optional(v.string()),
            repeatMedia: v.optional(v.boolean()),
            isMediaPlaying: v.optional(v.boolean()),
            mediaSeekPosition: v.optional(v.number()),
            isMediaMuted: v.optional(v.boolean()),
            windowPadding: v.optional(v.object({
                left: v.optional(v.number()),
                right: v.optional(v.number()),
                top: v.optional(v.number()),
                bottom: v.optional(v.number()),
            })),
            lettercase: v.optional(v.string()),
            lineSpacing: v.optional(v.string()),
            textOutlined: v.optional(v.boolean()),
            bibleVersion: v.optional(v.string()),
            // Lower Third settings
            lowerThirdStyle: v.optional(v.string()),
            lowerThirdPosition: v.optional(v.string()),
            lowerThirdAccentColor: v.optional(v.string()),
            lowerThirdSubtitle: v.optional(v.string()),
        })),
        lockedBy: v.optional(v.string()),
        lockedAt: v.optional(v.number()),
        saved: v.optional(v.boolean()),
        verseIndex: v.optional(v.number()),
        totalVerses: v.optional(v.number()),
        verseLabel: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    })
        .index("by_schedule", ["scheduleId"])
        .index("by_church", ["churchId"])
        .index("by_user", ["userId"])
        .index("by_locked", ["lockedBy"]),

    // Songs table
    songs: defineTable({
        _id: v.optional(v.string()),
        id: v.string(),
        lyrics: v.string(),
        title: v.string(),
        artist: v.string(),
        album: v.optional(v.string()),
        cover: v.optional(v.string()),
        author: v.optional(v.string()),
        verses: v.optional(v.array(v.string())),
        copyright: v.optional(v.string()),
        ccli: v.optional(v.string()),
        isPublic: v.optional(v.boolean()),
        createdBy: v.optional(v.string()),
        churchId: v.optional(v.string()),
        createdAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    })
        .index("by_church", ["churchId"])
        .index("by_creator", ["createdBy"]),

    // Templates table
    templates: defineTable({
        _id: v.optional(v.string()),
        name: v.string(),
        description: v.optional(v.string()),
        slideId: v.union(v.string(), v.object({
            _id: v.optional(v.string()),
            id: v.string(),
            index: v.number(),
            name: v.string(),
            type: v.string(),
            layout: v.string(),
            userId: v.string(),
            churchId: v.string(),
            scheduleId: v.string(),
            contents: v.array(v.string()),
            backgroundType: v.optional(v.string()),
            background: v.optional(v.string()),
            backgroundVideoKey: v.optional(v.union(v.string(), v.null())),
            title: v.optional(v.string()),
            songId: v.optional(v.string()),
            hasChorus: v.optional(v.boolean()),
            slideStyle: v.optional(v.any()),
            saved: v.optional(v.boolean()),
            createdAt: v.optional(v.string()),
            updatedAt: v.optional(v.string()),
        })),
        createdBy: v.optional(v.string()), // Optional - system templates don't have a creator
        favoritedBy: v.optional(v.array(v.string())), // Array of user IDs who favorited this template
        backgroundStorageId: v.optional(v.string()), // Storage ID for video/image files
        category: v.union(
            v.literal("announcement"),
            v.literal("worship"),
            v.literal("sermon"),
            v.literal("prayer"),
            v.literal("general")
        ),
        // Which slide types this template can be applied to
        appliesTo: v.optional(v.array(v.union(
            v.literal("bible"),
            v.literal("song"),
            v.literal("hymn"),
            v.literal("text"),
            v.literal("media"),
            v.literal("announcement"),
            v.literal("countdown"),
            v.literal("any")
        ))),
        thumbnail: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_category", ["category"])
        .index("by_creator", ["createdBy"]),

    // Adverts table
    adverts: defineTable({
        _id: v.optional(v.string()),
        title: v.string(),
        url: v.string(),
        image: v.string(),
        createdAt: v.string(),
        updatedAt: v.string(),
    }),

    // Bible Versions table - metadata only (actual Bible text stored in Convex file storage)
    bibleVersions: defineTable({
        id: v.string(), // KJV, NIV, etc.
        name: v.string(), // King James Version, New International Version, etc.
        verseCount: v.number(), // Number of verses (for quick reference)
        copyrightContent: v.string(),
        isPublicDomain: v.boolean(),
        fileId: v.optional(v.id("_storage")), // Reference to file in Convex storage
        fileSize: v.optional(v.number()), // File size in bytes for progress tracking
        uploadedAt: v.string(),
        uploadedBy: v.string(),
    })
        .index("by_version_id", ["id"]),

    // Verse Embeddings table - for semantic Bible verse search
    // Used by AI sermon listener to detect paraphrased verses
    verseEmbeddings: defineTable({
        reference: v.string(),
        book: v.string(),
        bookNumber: v.number(),
        chapter: v.number(),
        verse: v.number(),
        text: v.string(),
        version: v.string(),
        embedding: v.array(v.float64()),
        fragmentType: v.optional(v.string()),
        fragmentIndex: v.optional(v.number()),
        embeddingVersion: v.optional(v.string()),
    })
        .vectorIndex("by_embedding", {
            vectorField: "embedding",
            dimensions: 384,
            filterFields: ["book", "version"]
        })
        .index("by_reference", ["reference"])
        .index("by_book_chapter", ["book", "chapter"])
        .index("by_version", ["version"]),

    // Transcripts table - for sermon listener transcripts
    transcripts: defineTable({
        _id: v.optional(v.string()),
        title: v.string(),
        transcript: v.string(),
        // Detected verses from the sermon
        detectedVerses: v.optional(v.array(v.object({
            reference: v.string(),
            book: v.string(),
            chapter: v.number(),
            verseStart: v.number(),
            verseEnd: v.optional(v.number()),
            confidence: v.string(),
        }))),
        // Transcription provider used
        provider: v.string(),
        // Language used for transcription
        language: v.optional(v.string()),
        // Schedule this transcript is associated with
        scheduleId: v.optional(v.string()),
        // Church this transcript belongs to
        churchId: v.string(),
        // User who created the transcript
        createdBy: v.string(),
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_schedule", ["scheduleId"])
        .index("by_church", ["churchId"])
        .index("by_creator", ["createdBy"])
        .index("by_schedule_created", ["scheduleId", "createdAt"]),

    // Invitations table - for team member invitations
    invitations: defineTable({
        // Unique invite code (URL-safe, used in join links)
        code: v.string(),
        // Church this invitation belongs to
        churchId: v.string(),
        // Type of invitation
        type: v.union(
            v.literal("link"),      // Generic shareable link
            v.literal("email")      // Direct email invitation
        ),
        // For email invitations: recipient email
        email: v.optional(v.string()),
        // User who created the invitation
        createdBy: v.string(),
        // Status tracking
        status: v.union(
            v.literal("pending"),    // Not yet accepted
            v.literal("accepted"),   // User joined via this invite
            v.literal("revoked"),    // Admin revoked the invite
            v.literal("expired")     // Past expiration date
        ),
        // Who accepted the invitation (filled on join)
        acceptedBy: v.optional(v.string()),
        acceptedAt: v.optional(v.string()),
        // Timestamps
        createdAt: v.string(),
        updatedAt: v.string(),
        // Optional expiration (null = never expires)
        expiresAt: v.optional(v.string()),
        // Optional note from inviter
        message: v.optional(v.string()),
    })
        .index("by_code", ["code"])
        .index("by_church", ["churchId"])
        .index("by_email", ["email"])
        .index("by_status", ["status"]),

    // Live Sessions - for collaborative live presentation control
    liveSessions: defineTable({
        churchId: v.string(),
        scheduleId: v.string(),
        operatorId: v.string(),
        liveSlideId: v.optional(v.string()),
        operatorSlideIds: v.optional(v.array(v.string())),
        queue: v.optional(v.array(v.object({
            slideId: v.string(),
            suggestedBy: v.string(),
            suggestedAt: v.number(),
        }))),
        collaborationMode: v.optional(v.union(
            v.literal("strict"),
            v.literal("open"),
            v.literal("moderated"),
        )),
        isLive: v.boolean(),
        isBlank: v.optional(v.boolean()),
        activeAlertId: v.optional(v.string()),
        activeOverlay: v.optional(v.string()),
        status: v.union(v.literal("active"), v.literal("ended")),
        startedAt: v.string(),
        endedAt: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_church", ["churchId"])
        .index("by_schedule", ["scheduleId"])
        .index("by_church_active", ["churchId", "status"]),

    // Presence - tracks who's currently online and what they're viewing
    presence: defineTable({
        userId: v.string(),
        churchId: v.string(),
        location: v.string(),
        activeScheduleId: v.optional(v.string()),
        liveSessionId: v.optional(v.string()),
        sessionRole: v.optional(v.union(
            v.literal("operator"),
            v.literal("contributor"),
            v.literal("viewer")
        )),
        selectedSlideId: v.optional(v.string()),
        lastSeen: v.number(),
        createdAt: v.string(),
    })
        .index("by_church", ["churchId"])
        .index("by_user", ["userId"])
        .index("by_session", ["liveSessionId"]),

    // Global App Settings - managed by super admin (system-wide)
    // These settings apply to ALL users across ALL churches
    // This is a SINGLE document for the entire system
    globalAppSettings: defineTable({
        // Singleton identifier - always "global" for the single settings document
        _id: v.optional(v.string()),

        // === Sermon Listener Settings ===
        // Transcription provider: 'web-speech' | 'whisper' | 'whisper-cpp' | 'faster-whisper' | 'elevenlabs'
        sermonListener_transcriptionProvider: v.optional(v.string()),
        // Whisper API settings
        sermonListener_whisperModel: v.optional(v.string()),
        sermonListener_whisperEndpoint: v.optional(v.string()),
        sermonListener_whisperApiKey: v.optional(v.string()),
        sermonListener_whisperChunkDurationMs: v.optional(v.number()),
        // Whisper.cpp settings
        sermonListener_whisperCppEndpoint: v.optional(v.string()),
        sermonListener_whisperCppChunkDurationMs: v.optional(v.number()),
        // Faster-Whisper settings
        sermonListener_fasterWhisperEndpoint: v.optional(v.string()),
        sermonListener_fasterWhisperModel: v.optional(v.string()),
        sermonListener_fasterWhisperChunkDurationMs: v.optional(v.number()),
        sermonListener_fasterWhisperAudioCaptureMode: v.optional(v.string()),
        sermonListener_fasterWhisperDisableBrowserProcessing: v.optional(v.boolean()),
        // VAD settings
        sermonListener_useVAD: v.optional(v.boolean()),
        sermonListener_vadPositiveSpeechThreshold: v.optional(v.number()),
        sermonListener_vadNegativeSpeechThreshold: v.optional(v.number()),
        sermonListener_vadMinSpeechFrames: v.optional(v.number()),
        sermonListener_vadPreSpeechPadFrames: v.optional(v.number()),
        sermonListener_vadRedemptionFrames: v.optional(v.number()),
        // ElevenLabs settings
        sermonListener_elevenLabsApiKey: v.optional(v.string()),
        sermonListener_elevenLabsModelId: v.optional(v.string()),
        sermonListener_elevenLabsChunkDurationMs: v.optional(v.number()),
        // Default language for transcription
        sermonListener_defaultLanguage: v.optional(v.string()),

        // === Future Global Settings ===
        // Add more global settings here as needed
        // e.g., defaultBibleVersion, defaultTheme, etc.

        // Timestamps
        createdAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
        // User who last updated the settings
        updatedBy: v.optional(v.string()),
    }),
});
