import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Structured song section — mirrors SongSection in src/types/index.ts.
// Additive/optional wherever it appears; songs without it fall back to the
// freeform `lyrics` string. Used by the predictive lyric tracker.
export const songSectionValidator = v.object({
    id: v.string(),
    type: v.union(
        v.literal("verse"),
        v.literal("chorus"),
        v.literal("prechorus"),
        v.literal("bridge"),
        v.literal("tag"),
        v.literal("intro"),
        v.literal("ending"),
        v.literal("other"),
    ),
    label: v.optional(v.string()),
    number: v.optional(v.number()),
    lines: v.array(v.string()),
    slideId: v.optional(v.string()),
});

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
            plan: v.union(v.literal("free"), v.literal("pro")),
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
        subscriptionPlan: v.union(v.literal("free"), v.literal("pro")),
        // Default invite code for quick sharing
        defaultInviteCode: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.string(),
    }),

    // Subscriptions table — the server-side source of truth for billing,
    // kept in sync with Paystack via webhooks (convex/http.ts). The signed
    // license files handed to the desktop app (convex/licensing.ts) are
    // derived from these rows. Keyed by the Paystack customer email so a
    // webhook can land before the user has ever signed in to Selah.
    subscriptions: defineTable({
        // Paystack customer email, always stored lowercased.
        email: v.string(),
        // Linked Selah user id once we can resolve one (may be unknown at first).
        userId: v.optional(v.string()),
        plan: v.union(v.literal("free"), v.literal("pro")),
        // Mirrors Paystack subscription status plus a local "past_due" we set
        // while charges are being retried, so the app doesn't hard-lock mid-retry.
        status: v.union(
            v.literal("active"),
            v.literal("non-renewing"),
            v.literal("attention"),
            v.literal("past_due"),
            v.literal("cancelled")
        ),
        paystackCustomerCode: v.optional(v.string()),
        paystackSubscriptionCode: v.optional(v.string()),
        paystackPlanCode: v.optional(v.string()),
        // End of the current paid period (ISO 8601) — becomes the license's
        // `expires_at`. Null before the first successful charge.
        currentPeriodEnd: v.union(v.string(), v.null()),
        // How long the app keeps working past `currentPeriodEnd` while offline.
        gracePeriodDays: v.number(),
        // How this subscription was granted. "promo" rows are comped Pro (no
        // Paystack billing); "paystack" rows are billed normally (possibly on a
        // discounted intro plan that later rolls over — see the fields below).
        // "trial" covers pre-existing manually-granted trial rows (no current
        // code path creates new ones, but existing data must stay valid).
        source: v.optional(v.union(v.literal("paystack"), v.literal("promo"), v.literal("trial"))),
        // The promo code applied, if any (for audit / UI).
        promoCode: v.optional(v.string()),
        // --- intro-discount rollover (kind: "discount" promos) ---------------
        // Saved card authorization, captured from charge.success, used to start
        // the normal-priced subscription once the discounted cycles are spent.
        paystackAuthorizationCode: v.optional(v.string()),
        // The normal plan to roll into after the intro cycles end.
        revertPlanCode: v.optional(v.string()),
        // Remaining discounted billing cycles. Decremented on each charge; when
        // it hits 0 we create the normal-priced subscription. Null = not on an
        // intro discount.
        introCyclesRemaining: v.optional(v.union(v.number(), v.null())),
        // Timestamps for auditing / debugging the webhook stream.
        lastEventAt: v.optional(v.string()),
        lastChargeAt: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_email", ["email"])
        .index("by_subscription_code", ["paystackSubscriptionCode"])
        .index("by_user", ["userId"]),

    // Promo codes — there is no native Paystack coupon system, so codes are
    // modeled here. Two kinds:
    //   "comp"     → grants Pro free for `compDays` with no payment at all.
    //   "discount" → checkout uses `introPlanCode` (a cheaper Paystack plan with
    //                invoice_limit = introCycles); after those cycles the
    //                subscription rolls over to `revertPlanCode` (normal price).
    promoCodes: defineTable({
        code: v.string(), // stored UPPERCASED
        kind: v.union(v.literal("comp"), v.literal("discount")),
        description: v.optional(v.string()),
        active: v.boolean(),
        // The code itself stops working after this instant (null = never).
        expiresAt: v.optional(v.union(v.string(), v.null())),
        // Total redemptions allowed across all users (null = unlimited).
        maxRedemptions: v.optional(v.union(v.number(), v.null())),
        timesRedeemed: v.number(),
        // comp:
        compDays: v.optional(v.number()),
        // discount:
        introPlanCode: v.optional(v.string()),
        introCycles: v.optional(v.number()),
        revertPlanCode: v.optional(v.string()), // defaults to PAYSTACK_PRO_PLAN_CODE
        createdAt: v.string(),
        updatedAt: v.string(),
    }).index("by_code", ["code"]),

    // One row per (code, email) so a user can't redeem the same code twice and
    // so we can audit who used what.
    promoRedemptions: defineTable({
        code: v.string(),
        email: v.string(),
        kind: v.string(),
        redeemedAt: v.string(),
    })
        .index("by_code", ["code"])
        .index("by_code_email", ["code", "email"]),

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
                sections: v.optional(v.array(songSectionValidator)),
                defaultArrangement: v.optional(v.array(v.string())),
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
            }),
            v.object({
                url: v.string(),
                type: v.string(),
                name: v.optional(v.string()),
                thumbnail: v.optional(v.string()),
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
        // Structured lyrics for the predictive tracker (additive; see SongSection).
        sections: v.optional(v.array(songSectionValidator)),
        // Default play order as a list of section ids, e.g. ["v1","c1","v2","c1"].
        defaultArrangement: v.optional(v.array(v.string())),
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
            v.literal("sermon"),
            v.literal("prayer"),
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

    // Media library — reusable images/videos (uploaded or linked YouTube/Vimeo)
    // that persist across sessions, independent of any one slide.
    mediaLibrary: defineTable({
        name: v.string(),
        type: v.union(v.literal("image"), v.literal("video")),
        // Uploaded file, stored in Convex file storage.
        storageId: v.optional(v.string()),
        // YouTube/Vimeo link — no storageId, just the source URL.
        isExternal: v.optional(v.boolean()),
        externalType: v.optional(v.union(v.literal("youtube"), v.literal("vimeo"))),
        url: v.optional(v.string()),
        createdBy: v.optional(v.string()),
        churchId: v.optional(v.string()),
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_church", ["churchId"])
        .index("by_creator", ["createdBy"]),

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
        // Optional speaker name for learning
        speakerName: v.optional(v.string()),
        // Raw utterances from the transcription engine
        rawUtterances: v.optional(v.array(v.object({
            text: v.string(),
            timestamp: v.number(),
            confidence: v.optional(v.number()),
        }))),
        // Detected verses from the sermon
        detectedVerses: v.optional(v.array(v.object({
            reference: v.string(),
            book: v.string(),
            chapter: v.number(),
            verseStart: v.number(),
            verseEnd: v.optional(v.number()),
            confidence: v.string(),
            detectionMethod: v.optional(v.string()),
            rawText: v.optional(v.string()),
        }))),
        // User corrections — what the operator had to fix
        userCorrections: v.optional(v.array(v.object({
            originalReference: v.optional(v.string()),
            correctedReference: v.string(),
            correctionType: v.union(v.literal("missed"), v.literal("wrong-verse"), v.literal("wrong-book")),
            timestamp: v.number(),
            closestRawText: v.optional(v.string()),
        }))),
        // Failed semantic candidates — verses the system almost found
        failedCandidates: v.optional(v.array(v.object({
            reference: v.string(),
            score: v.number(),
            threshold: v.number(),
            rawText: v.string(),
        }))),
        // Timestamped transcript segments
        segments: v.optional(v.array(v.object({
            id: v.string(),
            text: v.string(),
            startMs: v.number(),
            endMs: v.number(),
            source: v.union(v.literal('web-speech'), v.literal('whisper'), v.literal('elevenlabs')),
            confidence: v.optional(v.number()),
            speaker: v.optional(v.number()),
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

    // Speaker profiles — learned phonetic patterns per speaker
    speakerProfiles: defineTable({
        speakerName: v.string(),
        churchId: v.string(),
        totalSermons: v.number(),
        totalCorrections: v.number(),
        // Learned book mishearings: { "Matthew": ["mathu", "machu"] }
        bookMishearings: v.optional(v.string()), // JSON Record<string, string[]>
        // Learned keyword mishearings
        keywordMishearings: v.optional(v.string()), // JSON Record<string, string[]>
        // Per-book detection stats
        bookStats: v.optional(v.string()), // JSON Record<string, { detected: number; missed: number }>
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_speaker_church", ["speakerName", "churchId"]),

    // Misheard patterns — auto-discovered accent corrections (review queue)
    misheardPatterns: defineTable({
        correctForm: v.string(),
        heardAs: v.string(),
        patternType: v.union(v.literal("book"), v.literal("chapter-keyword"), v.literal("verse-keyword"), v.literal("version"), v.literal("number")),
        speakerName: v.optional(v.string()),
        churchId: v.string(),
        frequency: v.number(),
        confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
        status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
        createdAt: v.string(),
        updatedAt: v.string(),
    })
        .index("by_status", ["status"])
        .index("by_speaker", ["speakerName", "churchId"])
        .index("by_type", ["patternType", "status"]),

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
        // Predictive lyric tracking (Phase 1 groundwork): the song currently
        // being tracked and the play order in effect for this service, which
        // defaults to the song's `defaultArrangement` but can be edited live.
        // Empty/absent arrangement => freeform tracking across all sections.
        trackedSongId: v.optional(v.string()),
        songArrangement: v.optional(v.array(v.string())),
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
