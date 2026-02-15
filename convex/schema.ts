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

    // Bible Versions table - stores complete Bible version data
    bibleVersions: defineTable({
        id: v.string(), // KJV, NIV, etc.
        name: v.string(), // King James Version, New International Version, etc.
        data: v.array(v.object({
            book: v.string(),
            chapter: v.string(),
            verse: v.string(),
            scripture: v.string(),
        })),
        copyrightContent: v.string(),
        isPublicDomain: v.boolean(),
        uploadedAt: v.string(),
        uploadedBy: v.string(),
    })
        .index("by_version_id", ["id"]),
});
