import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getById, getCurrentUser, isChurchAdmin, isMemberOf, requireUser, type User } from "./lib/auth";

/** A schedule the caller's church owns, or a thrown error. */
async function requireOwnSchedule(ctx: QueryCtx, scheduleId: string) {
    const user = await requireUser(ctx);
    const schedule = await getById(ctx, "schedules", scheduleId);
    if (!schedule) throw new Error("Schedule not found");
    if (!isMemberOf(user, schedule.churchId)) throw new Error("Unauthorized");
    return { user, schedule };
}

function canManage(user: User, schedule: { authorId: string; churchId: string }) {
    return schedule.authorId === user._id || isChurchAdmin(user, schedule.churchId);
}

// Get schedules by church
export const getSchedules = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user || !isMemberOf(user, args.churchId)) return [];

        return await ctx.db
            .query("schedules")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .take(1000);
    },
});

// Get schedule by ID
export const getSchedule = query({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) return null;
        const schedule = await getById(ctx, "schedules", args.scheduleId);
        return schedule && isMemberOf(user, schedule.churchId) ? schedule : null;
    },
});

// Create schedule
export const createSchedule = mutation({
    args: {
        name: v.string(),
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);
        if (!isMemberOf(user, args.churchId)) throw new Error("Unauthorized");

        const now = new Date().toISOString();
        return await ctx.db.insert("schedules", {
            name: args.name,
            authorId: user._id,
            editorIds: [user._id],
            churchId: args.churchId,
            lastUpdated: now,
            createdAt: now,
            updatedAt: now,
        });
    },
});

// Update schedule
export const updateSchedule = mutation({
    args: {
        scheduleId: v.string(),
        name: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { user, schedule } = await requireOwnSchedule(ctx, args.scheduleId);

        const isEditor = schedule.editorIds?.includes(user._id);
        if (!isEditor && !isChurchAdmin(user, schedule.churchId)) {
            throw new Error("Only editors and admins can update this schedule");
        }

        const now = new Date().toISOString();
        // Only the schedule's own fields. Spreading `args` here wrote
        // `scheduleId` into the document, which the schema rejects — so every
        // rename failed.
        await ctx.db.patch(schedule._id, {
            ...(args.name !== undefined ? { name: args.name } : {}),
            lastUpdated: now,
            updatedAt: now,
        });

        return args.scheduleId;
    },
});

// Delete schedule, with its slides
export const deleteSchedule = mutation({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const { user, schedule } = await requireOwnSchedule(ctx, args.scheduleId);
        if (!canManage(user, schedule)) {
            throw new Error("Only the schedule author or an admin can delete this schedule");
        }

        const slides = await ctx.db
            .query("slides")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .collect();
        for (const slide of slides) {
            await ctx.db.delete(slide._id);
        }

        await ctx.db.delete(schedule._id);
        return true;
    },
});

export const addScheduleEditor = mutation({
    args: {
        scheduleId: v.string(),
        editorId: v.string(),
    },
    handler: async (ctx, args) => {
        const { user, schedule } = await requireOwnSchedule(ctx, args.scheduleId);
        if (!canManage(user, schedule)) {
            throw new Error("Only the schedule author or an admin can add editors");
        }

        const editor = await getById(ctx, "users", args.editorId);
        if (!editor || !isMemberOf(editor, schedule.churchId)) {
            throw new Error("Editors must be members of this church");
        }

        const editorIds = schedule.editorIds || [];
        if (!editorIds.includes(editor._id)) {
            await ctx.db.patch(schedule._id, {
                editorIds: [...editorIds, editor._id],
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
        const { user, schedule } = await requireOwnSchedule(ctx, args.scheduleId);
        if (!canManage(user, schedule)) {
            throw new Error("Only the schedule author or an admin can remove editors");
        }

        await ctx.db.patch(schedule._id, {
            editorIds: (schedule.editorIds || []).filter((id) => id !== args.editorId),
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});
