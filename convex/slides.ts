import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getById, getCurrentUser, isChurchAdmin, isMemberOf, requireUser, type User } from "./lib/auth";

/**
 * Refuse a schedule that belongs to another church.
 *
 * A schedule created offline has a local id that never reaches the server, so
 * an id that doesn't resolve is allowed through: its slides are still stamped
 * with — and only ever read back for — the caller's own church.
 */
async function assertScheduleWritable(ctx: QueryCtx, user: User, scheduleId: string) {
    const schedule = await getById(ctx, "schedules", scheduleId);
    if (schedule && !isMemberOf(user, schedule.churchId)) {
        throw new Error("Unauthorized");
    }
}

/** A slide in the caller's church, or a thrown error. */
async function requireOwnSlide(ctx: QueryCtx, slideId: string) {
    const user = await requireUser(ctx);
    const slide = await getById(ctx, "slides", slideId);
    if (!slide) throw new Error("Slide not found");
    if (!isMemberOf(user, slide.churchId)) throw new Error("Unauthorized");
    return { user, slide };
}

// Get slides by schedule
export const getSlides = query({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user?.churchId) return [];

        const slides = await ctx.db
            .query("slides")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .collect();

        return slides
            .filter((slide) => slide.churchId === user.churchId)
            .sort((a, b) => a.index - b.index);
    },
});

// Get slide by ID
export const getSlide = query({
    args: {
        slideId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) return null;
        const slide = await getById(ctx, "slides", args.slideId);
        return slide && isMemberOf(user, slide.churchId) ? slide : null;
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
        const user = await requireUser(ctx);
        if (!user.churchId) throw new Error("Join a church first");

        await assertScheduleWritable(ctx, user, args.scheduleId);

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
        const { user, slide } = await requireOwnSlide(ctx, args.slideId);

        await ctx.db.patch(slide._id, {
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
        const { user, slide } = await requireOwnSlide(ctx, args.slideId);

        await ctx.db.delete(slide._id);
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
        const user = await requireUser(ctx);
        if (!user.churchId) throw new Error("Join a church first");

        for (const slideUpdate of args.slides) {
            const slide = await getById(ctx, "slides", slideUpdate._id);

            if (slide && isMemberOf(user, slide.churchId)) {
                await ctx.db.patch(slide._id, {
                    ...slideUpdate.updates,
                    updatedAt: new Date().toISOString(),
                });
            }
        }

        return true;
    },
});

export const syncScheduleSlides = mutation({
    args: {
        scheduleId: v.string(),
        slides: v.array(v.object({
            id: v.string(),
            index: v.number(),
            name: v.string(),
            type: v.string(),
            layout: v.string(),
            contents: v.array(v.string()),
            backgroundType: v.optional(v.string()),
            background: v.optional(v.string()),
            backgroundVideoKey: v.optional(v.union(v.string(), v.null())),
            backgroundStorageId: v.optional(v.union(v.string(), v.null())),
            title: v.optional(v.string()),
            songId: v.optional(v.string()),
            hasChorus: v.optional(v.boolean()),
            data: v.optional(v.any()),
            slideStyle: v.optional(v.any()),
            saved: v.optional(v.boolean()),
            verseIndex: v.optional(v.number()),
            totalVerses: v.optional(v.number()),
            verseLabel: v.optional(v.string()),
        })),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);
        if (!user.churchId) throw new Error("Join a church first");

        await assertScheduleWritable(ctx, user, args.scheduleId);

        const now = new Date().toISOString();
        const existingSlides = await ctx.db
            .query("slides")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .collect();

        const existingByStableId = new Map(existingSlides.map((slide) => [slide.id, slide]));
        const incomingIds = new Set(args.slides.map((slide) => slide.id));

        for (const slide of existingSlides) {
            if (slide.churchId === user.churchId && !incomingIds.has(slide.id)) {
                await ctx.db.delete(slide._id);
            }
        }

        for (const slide of args.slides) {
            const existing = existingByStableId.get(slide.id);
            const payload = {
                ...slide,
                userId: user._id!,
                churchId: user.churchId,
                scheduleId: args.scheduleId,
                updatedAt: now,
            };

            if (existing) {
                if (existing.churchId !== user.churchId) {
                    throw new Error("Unauthorized");
                }
                await ctx.db.patch(existing._id, payload);
            } else {
                await ctx.db.insert("slides", {
                    ...payload,
                    createdAt: now,
                });
            }
        }

        return true;
    },
});

export const upsertScheduleSlide = mutation({
    args: {
        scheduleId: v.string(),
        slide: v.object({
            id: v.string(),
            index: v.number(),
            name: v.string(),
            type: v.string(),
            layout: v.string(),
            contents: v.array(v.string()),
            backgroundType: v.optional(v.string()),
            background: v.optional(v.string()),
            backgroundVideoKey: v.optional(v.union(v.string(), v.null())),
            backgroundStorageId: v.optional(v.union(v.string(), v.null())),
            title: v.optional(v.string()),
            songId: v.optional(v.string()),
            hasChorus: v.optional(v.boolean()),
            data: v.optional(v.any()),
            slideStyle: v.optional(v.any()),
            saved: v.optional(v.boolean()),
            verseIndex: v.optional(v.number()),
            totalVerses: v.optional(v.number()),
            verseLabel: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);
        if (!user.churchId) throw new Error("Join a church first");

        await assertScheduleWritable(ctx, user, args.scheduleId);

        const existing = await ctx.db
            .query("slides")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .filter((q) => q.and(
                q.eq(q.field("id"), args.slide.id),
                q.eq(q.field("churchId"), user.churchId),
            ))
            .first();

        const now = new Date().toISOString();
        const payload = {
            ...args.slide,
            userId: user._id!,
            churchId: user.churchId,
            scheduleId: args.scheduleId,
            updatedAt: now,
        };

        if (existing) {
            if (existing.churchId !== user.churchId) {
                throw new Error("Unauthorized");
            }
            await ctx.db.patch(existing._id, payload);
            return existing._id;
        }

        return await ctx.db.insert("slides", {
            ...payload,
            createdAt: now,
        });
    },
});

// Save slide (mark as saved)
export const saveSlide = mutation({
    args: {
        slideId: v.string(),
    },
    handler: async (ctx, args) => {
        const { user, slide } = await requireOwnSlide(ctx, args.slideId);

        await ctx.db.patch(slide._id, {
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
        const { user, slide } = await requireOwnSlide(ctx, args.slideId);

        await ctx.db.patch(slide._id, {
            saved: false,
            updatedAt: new Date().toISOString(),
        });

        return args.slideId;
    },
});

export const lockSlide = mutation({
    args: {
        slideId: v.string(),
    },
    handler: async (ctx, args) => {
        const { user, slide } = await requireOwnSlide(ctx, args.slideId);

        const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
        if (slide.lockedBy && slide.lockedBy !== user._id) {
            const lockAge = Date.now() - (slide.lockedAt || 0);
            if (lockAge < LOCK_TIMEOUT_MS) {
                const lockingUser = await getById(ctx, "users", slide.lockedBy);
                throw new Error(`This slide is being edited by ${lockingUser?.fullname || 'another user'}`);
            }
        }

        await ctx.db.patch(slide._id, {
            lockedBy: user._id,
            lockedAt: Date.now(),
            updatedAt: new Date().toISOString(),
        });

        return args.slideId;
    },
});

export const unlockSlide = mutation({
    args: {
        slideId: v.string(),
    },
    handler: async (ctx, args) => {
        const { user, slide } = await requireOwnSlide(ctx, args.slideId);

        if (slide.lockedBy && slide.lockedBy !== user._id && !isChurchAdmin(user, slide.churchId)) {
            throw new Error("Only the locking user or an admin can unlock this slide");
        }

        await ctx.db.patch(slide._id, {
            lockedBy: undefined,
            lockedAt: undefined,
            updatedAt: new Date().toISOString(),
        });

        return args.slideId;
    },
});
