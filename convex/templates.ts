import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

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
        thumbnail: v.optional(v.string()),
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
            thumbnail: args.thumbnail,
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
            thumbnail: v.optional(v.string()),
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
