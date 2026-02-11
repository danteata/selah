import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Get slides by schedule
export const getSlides = query({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const slides = await ctx.db
            .query("slides")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .collect();

        return slides.sort((a, b) => a.index - b.index);
    },
});

// Get slide by ID
export const getSlide = query({
    args: {
        slideId: v.string(),
    },
    handler: async (ctx, args) => {
        const slide = await ctx.db
            .query("slides")
            .filter((q) => q.eq(q.field("_id"), args.slideId))
            .unique();

        return slide;
    },
});

// Create slide
export const createSlide = mutation({
    args: {
        scheduleId: v.string(),
        slideData: v.object({
            name: v.string(),
            type: v.string(),
            layout: v.string(),
            contents: v.array(v.string()),
            backgroundType: v.optional(v.string()),
            background: v.optional(v.string()),
            backgroundVideoKey: v.optional(v.union(v.string(), v.null())),
            title: v.optional(v.string()),
            songId: v.optional(v.string()),
            hasChorus: v.optional(v.boolean()),
            data: v.optional(v.any()),
            slideStyle: v.optional(v.any()),
            saved: v.optional(v.boolean()),
        }),
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

        // Get the highest index for this schedule
        const slides = await ctx.db
            .query("slides")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .collect();

        const maxIndex = slides.length > 0 ? Math.max(...slides.map(s => s.index)) : -1;

        const now = new Date().toISOString();
        const slideId = await ctx.db.insert("slides", {
            id: `slide_${Date.now()}`,
            index: maxIndex + 1,
            userId: user._id!,
            churchId: user.churchId,
            scheduleId: args.scheduleId,
            ...args.slideData,
            createdAt: now,
            updatedAt: now,
        });

        return slideId;
    },
});

// Update slide
export const updateSlide = mutation({
    args: {
        slideId: v.string(),
        updates: v.object({
            name: v.optional(v.string()),
            contents: v.optional(v.array(v.string())),
            backgroundType: v.optional(v.string()),
            background: v.optional(v.string()),
            backgroundVideoKey: v.optional(v.union(v.string(), v.null())),
            title: v.optional(v.string()),
            data: v.optional(v.any()),
            slideStyle: v.optional(v.any()),
            saved: v.optional(v.boolean()),
        }),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const slide = await ctx.db
            .query("slides")
            .filter((q) => q.eq(q.field("_id"), args.slideId))
            .unique();

        if (!slide) {
            throw new Error("Slide not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || user.churchId !== slide.churchId) {
            throw new Error("Unauthorized");
        }

        await ctx.db.patch(args.slideId as Id<"slides">, {
            ...args.updates,
            updatedAt: new Date().toISOString(),
        });

        return args.slideId;
    },
});

// Delete slide
export const deleteSlide = mutation({
    args: {
        slideId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const slide = await ctx.db
            .query("slides")
            .filter((q) => q.eq(q.field("_id"), args.slideId))
            .unique();

        if (!slide) {
            throw new Error("Slide not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || user.churchId !== slide.churchId) {
            throw new Error("Unauthorized");
        }

        await ctx.db.delete(args.slideId as Id<"slides">);
        return true;
    },
});

// Batch update slides
export const batchUpdateSlides = mutation({
    args: {
        slides: v.array(v.object({
            _id: v.string(),
            updates: v.object({
                index: v.optional(v.number()),
                name: v.optional(v.string()),
                contents: v.optional(v.array(v.string())),
                backgroundType: v.optional(v.string()),
                background: v.optional(v.string()),
                backgroundVideoKey: v.optional(v.union(v.string(), v.null())),
                title: v.optional(v.string()),
                data: v.optional(v.any()),
                slideStyle: v.optional(v.any()),
                saved: v.optional(v.boolean()),
            }),
        })),
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

        for (const slideUpdate of args.slides) {
            const slide = await ctx.db
                .query("slides")
                .filter((q) => q.eq(q.field("_id"), slideUpdate._id))
                .unique();

            if (slide && user.churchId === slide.churchId) {
                await ctx.db.patch(slideUpdate._id as Id<"slides">, {
                    ...slideUpdate.updates,
                    updatedAt: new Date().toISOString(),
                });
            }
        }

        return true;
    },
});

// Save slide (mark as saved)
export const saveSlide = mutation({
    args: {
        slideId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const slide = await ctx.db
            .query("slides")
            .filter((q) => q.eq(q.field("_id"), args.slideId))
            .unique();

        if (!slide) {
            throw new Error("Slide not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || user.churchId !== slide.churchId) {
            throw new Error("Unauthorized");
        }

        await ctx.db.patch(args.slideId as Id<"slides">, {
            saved: true,
            updatedAt: new Date().toISOString(),
        });

        return args.slideId;
    },
});

// Unsave slide
export const unsaveSlide = mutation({
    args: {
        slideId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const slide = await ctx.db
            .query("slides")
            .filter((q) => q.eq(q.field("_id"), args.slideId))
            .unique();

        if (!slide) {
            throw new Error("Slide not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || user.churchId !== slide.churchId) {
            throw new Error("Unauthorized");
        }

        await ctx.db.patch(args.slideId as Id<"slides">, {
            saved: false,
            updatedAt: new Date().toISOString(),
        });

        return args.slideId;
    },
});
