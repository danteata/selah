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
        saved: v.optional(v.boolean()),
        createdAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
    })
        .index("by_schedule", ["scheduleId"])
        .index("by_church", ["churchId"])
        .index("by_user", ["userId"]),

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
        // Standardized reference (e.g., "John 3:16")
        reference: v.string(),
        // Book name (e.g., "John")
        book: v.string(),
        // Book number (1-66, for quick lookups)
        bookNumber: v.number(),
        // Chapter number
        chapter: v.number(),
        // Verse number
        verse: v.number(),
        // Verse text (for display and context)
        text: v.string(),
        // Bible version this embedding was generated from
        version: v.string(),
        // Embedding vector (384 dimensions for all-MiniLM-L6-v2)
        embedding: v.array(v.float64()),
    })
        // Vector index for semantic similarity search
        .vectorIndex("by_embedding", {
            vectorField: "embedding",
            dimensions: 384,
            filterFields: ["book", "version"]
        })
        // Standard indexes for lookups
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
});
