import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Get schedules by church
export const getSchedules = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const schedules = await ctx.db
            .query("schedules")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .collect();

        return schedules;
    },
});

// Get schedule by ID
export const getSchedule = query({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const schedule = await ctx.db
            .query("schedules")
            .filter((q) => q.eq(q.field("_id"), args.scheduleId))
            .unique();

        return schedule;
    },
});

// Create schedule
export const createSchedule = mutation({
    args: {
        name: v.string(),
        churchId: v.string(),
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

        if (!user || user.churchId !== args.churchId) {
            throw new Error("Unauthorized");
        }

        const now = new Date().toISOString();
        const scheduleId = await ctx.db.insert("schedules", {
            name: args.name,
            authorId: user._id!,
            editorIds: [user._id!],
            churchId: args.churchId,
            lastUpdated: now,
            createdAt: now,
            updatedAt: now,
        });

        return scheduleId;
    },
});

// Update schedule
export const updateSchedule = mutation({
    args: {
        scheduleId: v.string(),
        name: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const schedule = await ctx.db
            .query("schedules")
            .filter((q) => q.eq(q.field("_id"), args.scheduleId))
            .unique();

        if (!schedule) {
            throw new Error("Schedule not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || user.churchId !== schedule.churchId) {
            throw new Error("Unauthorized");
        }

        const isEditor = schedule.editorIds?.includes(user._id!);
        const isAdmin = user.role === "superadmin" || user.role === "admin";

        if (!isEditor && !isAdmin) {
            throw new Error("Only editors and admins can update this schedule");
        }

        await ctx.db.patch(args.scheduleId as Id<"schedules">, {
            ...args,
            updatedAt: new Date().toISOString(),
        });

        return args.scheduleId;
    },
});

// Delete schedule
export const deleteSchedule = mutation({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const schedule = await ctx.db
            .query("schedules")
            .filter((q) => q.eq(q.field("_id"), args.scheduleId))
            .unique();

        if (!schedule) {
            throw new Error("Schedule not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || user.churchId !== schedule.churchId) {
            throw new Error("Unauthorized");
        }

        const isAuthor = schedule.authorId === user._id;
        const isAdmin = user.role === "superadmin" || user.role === "admin";

        if (!isAuthor && !isAdmin) {
            throw new Error("Only the schedule author or an admin can delete this schedule");
        }

        // Delete all slides in this schedule
        const slides = await ctx.db
            .query("slides")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .collect();

        for (const slide of slides) {
            await ctx.db.delete(slide._id!);
        }

        await ctx.db.delete(args.scheduleId as Id<"schedules">);
        return true;
    },
});

export const addScheduleEditor = mutation({
    args: {
        scheduleId: v.string(),
        editorId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const schedule = await ctx.db
            .query("schedules")
            .filter((q) => q.eq(q.field("_id"), args.scheduleId))
            .unique();

        if (!schedule) {
            throw new Error("Schedule not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || user.churchId !== schedule.churchId) {
            throw new Error("Unauthorized");
        }

        const isAuthor = schedule.authorId === user._id;
        const isAdmin = user.role === "superadmin" || user.role === "admin";

        if (!isAuthor && !isAdmin) {
            throw new Error("Only the schedule author or an admin can add editors");
        }

        const editorIds = schedule.editorIds || [];
        if (!editorIds.includes(args.editorId)) {
            await ctx.db.patch(args.scheduleId as Id<"schedules">, {
                editorIds: [...editorIds, args.editorId],
                updatedAt: new Date().toISOString(),
            });
        }

        return true;
    },
});

export const removeScheduleEditor = mutation({
    args: {
        scheduleId: v.string(),
        editorId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const schedule = await ctx.db
            .query("schedules")
            .filter((q) => q.eq(q.field("_id"), args.scheduleId))
            .unique();

        if (!schedule) {
            throw new Error("Schedule not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || user.churchId !== schedule.churchId) {
            throw new Error("Unauthorized");
        }

        const isAuthor = schedule.authorId === user._id;
        const isAdmin = user.role === "superadmin" || user.role === "admin";

        if (!isAuthor && !isAdmin) {
            throw new Error("Only the schedule author or an admin can remove editors");
        }

        const editorIds = (schedule.editorIds || []).filter(id => id !== args.editorId);
        await ctx.db.patch(args.scheduleId as Id<"schedules">, {
            editorIds,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});
