import { query, mutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { appliesToValidator } from "./schema";
import { getById, getCurrentUser, requireSuperadmin, requireUser, type User } from "./lib/auth";

/**
 * Templates a user may see: the shared system templates (no creator) plus those
 * made by anyone in their church. Templates carry no churchId, so membership is
 * resolved through the creator. `getTemplates` used to return every church's
 * templates — including their background storage ids — to any caller.
 */
async function templateVisibility(ctx: QueryCtx, user: User | null) {
    const creators = new Set<string>();
    if (user) {
        creators.add(user._id);
        if (user.churchId) {
            const members = await ctx.db
                .query("users")
                .withIndex("by_church", (q) => q.eq("churchId", user.churchId))
                .take(500);
            for (const member of members) creators.add(member._id);
        }
    }
    return (template: Doc<"templates">) => !template.createdBy || creators.has(template.createdBy);
}

/**
 * Template backgrounds a church may keep on the server, in total. Desktop
 * template backgrounds upload automatically (see templateMediaSync.ts); this
 * bounds what that costs. Past it, a background stays on the computer that
 * has it and the template says so.
 */
export const TEMPLATE_MEDIA_LIMIT_BYTES = 100 * 1024 * 1024;

/** The church's own templates (not the system ones), as `user` sees them. */
async function churchTemplates(ctx: QueryCtx, user: User) {
    const visible = await templateVisibility(ctx, user);
    const templates = await ctx.db.query("templates").take(2000);
    return templates.filter((t) => !!t.createdBy && visible(t));
}

async function storageSize(ctx: QueryCtx, storageId: string): Promise<number | null> {
    const id = ctx.db.system.normalizeId("_storage", storageId);
    if (!id) return null;
    const meta = await ctx.db.system.get(id);
    return meta ? meta.size : null;
}

/** Bytes of background files the church's templates use, each file counted once. */
async function backgroundBytes(ctx: QueryCtx, user: User, excludingTemplateId?: string): Promise<number> {
    const ids = new Set<string>();
    for (const t of await churchTemplates(ctx, user)) {
        if (t._id !== excludingTemplateId && t.backgroundStorageId) ids.add(t.backgroundStorageId);
    }
    let total = 0;
    for (const id of ids) total += (await storageSize(ctx, id)) ?? 0;
    return total;
}

/**
 * Refuse a background that would take the church past its limit, deleting the
 * uploaded file so a refused upload doesn't count against storage either.
 */
async function requireRoomFor(ctx: MutationCtx, user: User, storageId: string, excludingTemplateId?: string) {
    const size = await storageSize(ctx, storageId);
    if (size === null) throw new Error("Uploaded file not found");
    const used = await backgroundBytes(ctx, user, excludingTemplateId);
    if (used + size > TEMPLATE_MEDIA_LIMIT_BYTES) {
        const id = ctx.db.system.normalizeId("_storage", storageId);
        if (id) await ctx.storage.delete(id);
        return { ok: false as const, usedBytes: used, limitBytes: TEMPLATE_MEDIA_LIMIT_BYTES };
    }
    return { ok: true as const, usedBytes: used + size, limitBytes: TEMPLATE_MEDIA_LIMIT_BYTES };
}

/** Delete a background file once no template or media library item uses it. */
async function deleteBackgroundIfUnused(ctx: MutationCtx, user: User, storageId: string) {
    const inTemplates = (await churchTemplates(ctx, user)).some((t) => t.backgroundStorageId === storageId);
    const inLibrary = await ctx.db
        .query("mediaLibrary")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first();
    const id = ctx.db.system.normalizeId("_storage", storageId);
    if (!inTemplates && !inLibrary && id) await ctx.storage.delete(id);
}

/** The church's template background usage against its limit. */
export const backgroundUsage = query({
    args: {},
    handler: async (ctx) => {
        const user = await getCurrentUser(ctx);
        if (!user) return { usedBytes: 0, limitBytes: TEMPLATE_MEDIA_LIMIT_BYTES };
        return { usedBytes: await backgroundBytes(ctx, user), limitBytes: TEMPLATE_MEDIA_LIMIT_BYTES };
    },
});

/**
 * Give a template the background file a device just uploaded. Any member of
 * the church may, since the file is often on a teammate's computer rather than
 * the creator's. Refused (and the upload deleted) past the church's limit.
 * The template-level `backgroundStorageId` is the one source of truth; a JSON
 * slide snapshot gets it too, for clients that read it there.
 */
export const attachBackground = mutation({
    args: { templateId: v.string(), storageId: v.string() },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);
        const template = await getById(ctx, "templates", args.templateId);
        const visible = await templateVisibility(ctx, user);
        if (!template || !template.createdBy || !visible(template)) throw new Error("Template not found");

        const room = await requireRoomFor(ctx, user, args.storageId, template._id);
        if (!room.ok) return room;

        const previous = template.backgroundStorageId;
        let slideId = template.slideId;
        if (typeof slideId === "string") {
            try {
                slideId = JSON.stringify({ ...JSON.parse(slideId), backgroundStorageId: args.storageId });
            } catch {
                // Not JSON: leave the snapshot; the template-level id is enough.
            }
        }
        await ctx.db.patch(template._id, {
            backgroundStorageId: args.storageId,
            slideId,
            updatedAt: new Date().toISOString(),
        });
        if (previous && previous !== args.storageId) await deleteBackgroundIfUnused(ctx, user, previous);
        return room;
    },
});

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
        const storageId = args.storageId ? ctx.db.system.normalizeId("_storage", args.storageId) : null;
        if (!storageId) return null;
        return await ctx.storage.getUrl(storageId);
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
        const visible = await templateVisibility(ctx, await getCurrentUser(ctx));
        const templates = await ctx.db.query("templates").take(2000);
        return templates.filter(visible);
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
        const visible = await templateVisibility(ctx, await getCurrentUser(ctx));
        const templates = await ctx.db
            .query("templates")
            .withIndex("by_category", (q) => q.eq("category", args.category))
            .take(2000);

        return templates.filter(visible);
    },
});

// Get template by ID
export const getTemplate = query({
    args: {
        templateId: v.string(),
    },
    handler: async (ctx, args) => {
        const template = await getById(ctx, "templates", args.templateId);
        if (!template) return null;
        const visible = await templateVisibility(ctx, await getCurrentUser(ctx));
        return visible(template) ? template : null;
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
        const user = await requireUser(ctx);
        if (args.backgroundStorageId) {
            const room = await requireRoomFor(ctx, user, args.backgroundStorageId);
            if (!room.ok) throw new Error("Your church's template backgrounds are over the 100 MB limit");
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
        const user = await requireUser(ctx);
        const template = await getById(ctx, "templates", args.templateId);
        if (!template) {
            throw new Error("Template not found");
        }
        if (template.createdBy !== user._id) {
            throw new Error("Unauthorized");
        }
        const newStorageId = args.updates.backgroundStorageId;
        if (newStorageId && newStorageId !== template.backgroundStorageId) {
            const room = await requireRoomFor(ctx, user, newStorageId, template._id);
            if (!room.ok) throw new Error("Your church's template backgrounds are over the 100 MB limit");
        }

        await ctx.db.patch(template._id, {
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
        const user = await requireUser(ctx);
        const template = await getById(ctx, "templates", args.templateId);
        if (!template) {
            throw new Error("Template not found");
        }
        if (template.createdBy !== user._id) {
            throw new Error("Unauthorized");
        }

        await ctx.db.delete(template._id);
        return true;
    },
});

// Toggle favorite template
export const toggleFavoriteTemplate = mutation({
    args: {
        templateId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        const template = await getById(ctx, "templates", args.templateId);
        const visible = await templateVisibility(ctx, user);
        if (!template || !visible(template)) {
            throw new Error("Template not found");
        }

        const currentFavorites = template.favoritedBy || [];
        const isFavorited = currentFavorites.includes(user._id!);

        const updatedFavorites = isFavorited
            ? currentFavorites.filter(id => id !== user._id)
            : [...currentFavorites, user._id!];

        await ctx.db.patch(template._id, {
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

// The shared system templates (no creator), seeded once per deployment.
function defaultTemplates(now: string) {
    return [
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
        ...MOTION_TEMPLATES.map(([name, description, motionId, category, contents]) => ({
            name,
            description,
            slideId: JSON.stringify({
                type: "text",
                layout: "full-text",
                contents,
                background: `motion:${motionId}`,
                backgroundType: "motion",
            }),
            category,
            createdAt: now,
            updatedAt: now,
        })),
    ];
}

/** Built-in templates since withdrawn: seeding removes them. ("Ocean" was
 *  replaced by "Silk"; slides already using its background still draw.) */
const RETIRED_SYSTEM_TEMPLATES = new Set(["Ocean"]);

/**
 * Built-in motion backgrounds, drawn by the app itself (see
 * src/components/motion/motionBackgrounds.ts; the ids must match). Every church
 * gets them with nothing to upload, download or license. No thumbnail: the
 * template picker draws them live.
 */
const MOTION_TEMPLATES: Array<[string, string, string, "worship" | "general" | "prayer" | "sermon" | "announcement", string[]]> = [
    ["Galaxy", "Drifting stars and a slow-turning nebula", "galaxy", "worship", ["Your content here"]],
    ["Aurora", "Soft green and violet light", "aurora", "worship", ["Your content here"]],
    ["Warm Glow", "Gold and rose light leaks", "warm-glow", "worship", ["Your content here"]],
    ["Embers", "Rising sparks over a dark fire", "embers", "prayer", ["Your content here"]],
    ["Silk", "Ribbons of colour flowing across the screen", "silk", "general", ["Your content here"]],
    ["Light Rays", "Beams of light from above", "light-rays", "sermon", ["Your content here"]],
];

// Seed default templates (only if none exist)
export const seedDefaultTemplates = mutation({
    args: {},
    handler: async (ctx) => {
        await requireUser(ctx);

        // Adds whichever system templates are missing, by name, so built-ins
        // added in a later release (the motion backgrounds) reach deployments
        // seeded before them. It used to stop at the first system template.
        const existingSystem = await ctx.db
            .query("templates")
            .withIndex("by_creator", (q) => q.eq("createdBy", undefined))
            .take(500);
        let removed = 0;
        for (const t of existingSystem) {
            if (RETIRED_SYSTEM_TEMPLATES.has(t.name)) {
                await ctx.db.delete(t._id);
                removed++;
            }
        }
        const have = new Set(existingSystem.map((t) => t.name));
        const missing = defaultTemplates(new Date().toISOString()).filter((t) => !have.has(t.name));
        for (const template of missing) {
            await ctx.db.insert("templates", template);
        }

        return missing.length > 0 || removed > 0
            ? { seeded: true, count: missing.length }
            : { seeded: false, message: "Templates already exist" };
    },
});

// Replace the system templates with the latest versions. Custom templates are
// untouched. Superadmin only: the system templates are shared by every church,
// so a reset by anyone else rewrote them — and dropped their favourites — for
// all of them.
export const resetDefaultTemplates = mutation({
    args: {},
    handler: async (ctx) => {
        await requireSuperadmin(ctx);

        const existingSystem = await ctx.db
            .query("templates")
            .withIndex("by_creator", (q) => q.eq("createdBy", undefined))
            .collect();

        // Keep each template's favourites across the reset, matched by name.
        const favoritesByName = new Map(existingSystem.map((t) => [t.name, t.favoritedBy]));
        for (const template of existingSystem) {
            await ctx.db.delete(template._id);
        }

        const templates = defaultTemplates(new Date().toISOString());
        for (const template of templates) {
            await ctx.db.insert("templates", {
                ...template,
                favoritedBy: favoritesByName.get(template.name),
            });
        }

        return { seeded: true, count: templates.length };
    },
});
