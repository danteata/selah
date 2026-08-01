import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { appliesToValidator } from "./schema";

// Generate upload URL for file storage
export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }
        return await ctx.storage.generateUploadUrl();
    },
});

// Get file URL from storage ID
export const getFileUrl = query({
    args: {
        storageId: v.string(),
    },
    handler: async (ctx, args) => {
        // Return null if no storage ID provided
        if (!args.storageId || args.storageId === '') {
            return null;
        }
        return await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    },
});

// Default backgrounds - must match src/constants/backgrounds.ts
const DEFAULT_BACKGROUNDS = {
    hymn: {
        backgroundType: 'image' as const,
        background: 'https://images.unsplash.com/photo-1506056820413-f8fa4de15de6?q=80&w=1740',
    },
    bible: {
        backgroundType: 'image' as const,
        background: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=1740',
    },
    text: {
        backgroundType: 'image' as const,
        background: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1740',
    },
    worship: {
        backgroundType: 'image' as const,
        background: 'https://images.unsplash.com/photo-1506056820413-f8fa4de15de6?q=80&w=1740',
    },
    sermon: {
        backgroundType: 'image' as const,
        background: 'https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=1740',
    },
    announcement: {
        backgroundType: 'image' as const,
        background: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1740',
    },
    prayer: {
        backgroundType: 'image' as const,
        background: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1740',
    },
    general: {
        backgroundType: 'image' as const,
        background: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1740',
    }
};

// Get all templates
export const getTemplates = query({
    args: {},
    handler: async (ctx) => {
        const templates = await ctx.db.query("templates").collect();
        return templates;
    },
});

// Get templates by category
export const getTemplatesByCategory = query({
    args: {
        category: v.union(
            v.literal("announcement"),
            v.literal("worship"),
            v.literal("sermon"),
            v.literal("prayer"),
            v.literal("general")
        ),
    },
    handler: async (ctx, args) => {
        const templates = await ctx.db
            .query("templates")
            .withIndex("by_category", (q) => q.eq("category", args.category))
            .collect();

        return templates;
    },
});

// Get template by ID
export const getTemplate = query({
    args: {
        templateId: v.string(),
    },
    handler: async (ctx, args) => {
        const template = await ctx.db
            .query("templates")
            .filter((q) => q.eq(q.field("_id"), args.templateId))
            .unique();

        return template;
    },
});

// Create template
export const createTemplate = mutation({
    args: {
        name: v.string(),
        description: v.optional(v.string()),
        slideId: v.union(v.string(), v.any()), // Can be slide ID or full slide object
        category: v.union(
            v.literal("announcement"),
            v.literal("worship"),
            v.literal("sermon"),
            v.literal("prayer"),
            v.literal("general")
        ),
        appliesTo: v.optional(appliesToValidator),
        thumbnail: v.optional(v.string()),
        backgroundStorageId: v.optional(v.string()), // Storage ID for video/image files
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        const now = new Date().toISOString();
        const templateId = await ctx.db.insert("templates", {
            name: args.name,
            description: args.description,
            slideId: args.slideId,
            createdBy: user._id!,
            category: args.category,
            appliesTo: args.appliesTo,
            thumbnail: args.thumbnail,
            backgroundStorageId: args.backgroundStorageId,
            createdAt: now,
            updatedAt: now,
        });

        return templateId;
    },
});

// Update template
export const updateTemplate = mutation({
    args: {
        templateId: v.string(),
        updates: v.object({
            name: v.optional(v.string()),
            description: v.optional(v.string()),
            slideId: v.optional(v.union(v.string(), v.any())),
            category: v.optional(v.union(
                v.literal("announcement"),
                v.literal("worship"),
                v.literal("sermon"),
                v.literal("prayer"),
                v.literal("general")
            )),
            appliesTo: v.optional(appliesToValidator),
            thumbnail: v.optional(v.string()),
            backgroundStorageId: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const template = await ctx.db
            .query("templates")
            .filter((q) => q.eq(q.field("_id"), args.templateId))
            .unique();

        if (!template) {
            throw new Error("Template not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || template.createdBy !== user._id) {
            throw new Error("Unauthorized");
        }

        await ctx.db.patch(args.templateId as Id<"templates">, {
            ...args.updates,
            updatedAt: new Date().toISOString(),
        });

        return args.templateId;
    },
});

// Delete template
export const deleteTemplate = mutation({
    args: {
        templateId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const template = await ctx.db
            .query("templates")
            .filter((q) => q.eq(q.field("_id"), args.templateId))
            .unique();

        if (!template) {
            throw new Error("Template not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || template.createdBy !== user._id) {
            throw new Error("Unauthorized");
        }

        await ctx.db.delete(args.templateId as Id<"templates">);
        return true;
    },
});

// Toggle favorite template
export const toggleFavoriteTemplate = mutation({
    args: {
        templateId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        const template = await ctx.db
            .query("templates")
            .filter((q) => q.eq(q.field("_id"), args.templateId))
            .unique();

        if (!template) {
            throw new Error("Template not found");
        }

        const currentFavorites = template.favoritedBy || [];
        const isFavorited = currentFavorites.includes(user._id!);

        const updatedFavorites = isFavorited
            ? currentFavorites.filter(id => id !== user._id)
            : [...currentFavorites, user._id!];

        await ctx.db.patch(args.templateId as Id<"templates">, {
            favoritedBy: updatedFavorites,
            updatedAt: new Date().toISOString(),
        });

        return !isFavorited; // Returns the new favorite state
    },
});

// Get active advert
export const getActiveAdvert = query({
    args: {},
    handler: async (ctx) => {
        // For simplicity, return the most recent advert
        // In a real app, you might have an "active" flag
        const adverts = await ctx.db.query("adverts").collect();
        return adverts.length > 0 ? adverts[adverts.length - 1] : null;
    },
});

// Seed default templates (only if none exist)
export const seedDefaultTemplates = mutation({
    args: {},
    handler: async (ctx) => {
        const existingTemplates = await ctx.db.query("templates").collect();

        // Only seed if no templates exist
        if (existingTemplates.length > 0) {
            return { seeded: false, message: "Templates already exist" };
        }

        const now = new Date().toISOString();
        const defaultTemplates = [
            {
                name: "Welcome Slide",
                description: "A welcoming slide for church services",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Welcome to Church"],
                    background: DEFAULT_BACKGROUNDS.general.background,
                    backgroundType: DEFAULT_BACKGROUNDS.general.backgroundType
                }),
                category: "general" as const,
                thumbnail: DEFAULT_BACKGROUNDS.general.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Announcement",
                description: "General announcement template",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Announcement Title", "Details go here"],
                    background: DEFAULT_BACKGROUNDS.announcement.background,
                    backgroundType: DEFAULT_BACKGROUNDS.announcement.backgroundType
                }),
                category: "announcement" as const,
                thumbnail: DEFAULT_BACKGROUNDS.announcement.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Worship Lyrics",
                description: "Template for song lyrics",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Song lyrics here"],
                    background: DEFAULT_BACKGROUNDS.worship.background,
                    backgroundType: DEFAULT_BACKGROUNDS.worship.backgroundType
                }),
                category: "worship" as const,
                thumbnail: DEFAULT_BACKGROUNDS.worship.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Sermon Title",
                description: "Template for sermon titles",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Sermon Title", "Scripture Reference"],
                    background: DEFAULT_BACKGROUNDS.sermon.background,
                    backgroundType: DEFAULT_BACKGROUNDS.sermon.backgroundType
                }),
                category: "sermon" as const,
                thumbnail: DEFAULT_BACKGROUNDS.sermon.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Prayer Slide",
                description: "Template for prayer points",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Prayer Point"],
                    background: DEFAULT_BACKGROUNDS.prayer.background,
                    backgroundType: DEFAULT_BACKGROUNDS.prayer.backgroundType
                }),
                category: "prayer" as const,
                thumbnail: DEFAULT_BACKGROUNDS.prayer.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Scripture Verse",
                description: "Template for Bible verses",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Bible verse text here", "- Reference"],
                    background: DEFAULT_BACKGROUNDS.bible.background,
                    backgroundType: DEFAULT_BACKGROUNDS.bible.backgroundType
                }),
                category: "general" as const,
                thumbnail: DEFAULT_BACKGROUNDS.bible.background,
                createdAt: now,
                updatedAt: now,
            },
        ];

        for (const template of defaultTemplates) {
            await ctx.db.insert("templates", template);
        }

        return { seeded: true, count: defaultTemplates.length };
    },
});

// Reset default templates (delete all non-custom templates and re-seed)
export const resetDefaultTemplates = mutation({
    args: {},
    handler: async (ctx) => {
        const existingTemplates = await ctx.db.query("templates").collect();

        // Delete all non-custom templates (those without createdBy)
        for (const template of existingTemplates) {
            if (!template.createdBy) {
                await ctx.db.delete(template._id);
            }
        }

        const now = new Date().toISOString();
        const defaultTemplates = [
            {
                name: "Welcome Slide",
                description: "A welcoming slide for church services",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Welcome to Church"],
                    background: DEFAULT_BACKGROUNDS.general.background,
                    backgroundType: DEFAULT_BACKGROUNDS.general.backgroundType
                }),
                category: "general" as const,
                thumbnail: DEFAULT_BACKGROUNDS.general.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Announcement",
                description: "General announcement template",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Announcement Title", "Details go here"],
                    background: DEFAULT_BACKGROUNDS.announcement.background,
                    backgroundType: DEFAULT_BACKGROUNDS.announcement.backgroundType
                }),
                category: "announcement" as const,
                thumbnail: DEFAULT_BACKGROUNDS.announcement.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Worship Lyrics",
                description: "Template for song lyrics",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Song lyrics here"],
                    background: DEFAULT_BACKGROUNDS.worship.background,
                    backgroundType: DEFAULT_BACKGROUNDS.worship.backgroundType
                }),
                category: "worship" as const,
                thumbnail: DEFAULT_BACKGROUNDS.worship.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Sermon Title",
                description: "Template for sermon titles",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Sermon Title", "Scripture Reference"],
                    background: DEFAULT_BACKGROUNDS.sermon.background,
                    backgroundType: DEFAULT_BACKGROUNDS.sermon.backgroundType
                }),
                category: "sermon" as const,
                thumbnail: DEFAULT_BACKGROUNDS.sermon.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Prayer Slide",
                description: "Template for prayer points",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Prayer Point"],
                    background: DEFAULT_BACKGROUNDS.prayer.background,
                    backgroundType: DEFAULT_BACKGROUNDS.prayer.backgroundType
                }),
                category: "prayer" as const,
                thumbnail: DEFAULT_BACKGROUNDS.prayer.background,
                createdAt: now,
                updatedAt: now,
            },
            {
                name: "Scripture Verse",
                description: "Template for Bible verses",
                slideId: JSON.stringify({
                    type: "text",
                    layout: "full-text",
                    contents: ["Bible verse text here", "- Reference"],
                    background: DEFAULT_BACKGROUNDS.bible.background,
                    backgroundType: DEFAULT_BACKGROUNDS.bible.backgroundType
                }),
                category: "general" as const,
                thumbnail: DEFAULT_BACKGROUNDS.bible.background,
                createdAt: now,
                updatedAt: now,
            },
        ];

        for (const template of defaultTemplates) {
            await ctx.db.insert("templates", template);
        }

        return { seeded: true, count: defaultTemplates.length };
    },
});
