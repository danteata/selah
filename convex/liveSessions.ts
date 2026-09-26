import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getById, isChurchAdmin, isMemberOf, requireUser, type User } from "./lib/auth";

/**
 * An active session in the caller's own church.
 *
 * Every control below used to trust `role === "admin"` alone. The role is
 * global, and anyone can become an admin by founding a church, so any admin
 * anywhere could blank or hijack another church's projector mid-service.
 */
async function requireActiveSession(ctx: QueryCtx, sessionId: Id<"liveSessions">) {
    const user = await requireUser(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.status !== "active") {
        throw new Error("No active session found");
    }
    if (!isMemberOf(user, session.churchId)) {
        throw new Error("Unauthorized: not a member of this church");
    }
    return { user, session };
}

function isOperatorOrAdmin(user: User, session: { operatorId: string; churchId: string }) {
    return session.operatorId === user._id || isChurchAdmin(user, session.churchId);
}

/** The church's active session for a schedule, if there is one. */
async function findActiveSession(ctx: QueryCtx, churchId: string, scheduleId: string) {
    return await ctx.db
        .query("liveSessions")
        .withIndex("by_church_active", (q) => q.eq("churchId", churchId).eq("status", "active"))
        .filter((q) => q.eq(q.field("scheduleId"), scheduleId))
        .first();
}

function removeQueueEntriesByOccurrence(
    queue: Array<{ slideId: string; suggestedBy: string; suggestedAt: number }>,
    slideIds: string[]
) {
    const counts = new Map<string, number>();
    for (const id of slideIds) {
        counts.set(id, (counts.get(id) || 0) + 1);
    }

    return queue.filter((entry) => {
        const remaining = counts.get(entry.slideId) || 0;
        if (remaining > 0) {
            counts.set(entry.slideId, remaining - 1);
            return false;
        }
        return true;
    });
}

export const getActiveSession = query({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);
        if (!user.churchId) return null;
        // Scoped to the caller's church: a session another church opened on
        // this schedule id is not ours to see — and used to make this throw.
        return await findActiveSession(ctx, user.churchId, args.scheduleId);
    },
});

export const getActiveSessionByChurch = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        if (!isMemberOf(user, args.churchId)) {
            throw new Error("Unauthorized: not a member of this church");
        }

        const sessions = await ctx.db
            .query("liveSessions")
            .withIndex("by_church_active", (q) =>
                q.eq("churchId", args.churchId).eq("status", "active")
            )
            .take(50);

        return sessions;
    },
});

export const getSession = query({
    args: {
        sessionId: v.id("liveSessions"),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        const session = await ctx.db.get(args.sessionId);

        if (session && !isMemberOf(user, session.churchId)) {
            throw new Error("Unauthorized: not a member of this church");
        }

        return session;
    },
});

export const startSession = mutation({
    args: {
        scheduleId: v.string(),
        churchId: v.string(),
        collaborationMode: v.optional(v.union(
            v.literal("strict"),
            v.literal("open"),
            v.literal("moderated"),
        )),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        if (!isMemberOf(user, args.churchId)) {
            throw new Error("Unauthorized: not a member of this church");
        }

        const schedule = await getById(ctx, "schedules", args.scheduleId);
        if (schedule && schedule.churchId !== args.churchId) {
            throw new Error("Unauthorized");
        }

        const existingSession = await findActiveSession(ctx, args.churchId, args.scheduleId);

        if (existingSession) {
            throw new Error("An active session already exists for this schedule");
        }

        const mode = args.collaborationMode || "moderated";
        const now = new Date().toISOString();
        const sessionId = await ctx.db.insert("liveSessions", {
            churchId: args.churchId,
            scheduleId: args.scheduleId,
            operatorId: user._id!,
            liveSlideId: undefined,
            operatorSlideIds: [],
            queue: [],
            collaborationMode: mode,
            isLive: true,
            isBlank: false,
            activeAlertId: undefined,
            activeOverlay: undefined,
            status: "active",
            startedAt: now,
            endedAt: undefined,
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.insert("presence", {
            userId: user._id!,
            churchId: args.churchId,
            location: "live",
            activeScheduleId: args.scheduleId,
            liveSessionId: sessionId,
            sessionRole: "operator",
            selectedSlideId: undefined,
            lastSeen: Date.now(),
            createdAt: now,
        });

        return sessionId;
    },
});

export const endSession = mutation({
    args: {
        sessionId: v.id("liveSessions"),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session) {
            throw new Error("Session not found");
        }
        if (!isMemberOf(user, session.churchId)) {
            throw new Error("Unauthorized: not a member of this church");
        }

        if (!isOperatorOrAdmin(user, session)) {
            throw new Error("Only the operator or an admin can end the session");
        }

        const now = new Date().toISOString();
        await ctx.db.patch(args.sessionId, {
            status: "ended",
            endedAt: now,
            isLive: false,
            updatedAt: now,
        });

        const presenceEntries = await ctx.db
            .query("presence")
            .withIndex("by_session", (q) => q.eq("liveSessionId", args.sessionId))
            .collect();

        for (const entry of presenceEntries) {
            await ctx.db.delete(entry._id!);
        }

        return true;
    },
});

export const setLiveSlide = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        slideId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        const isOperator = session.operatorId === user._id;
        const isAdmin = isChurchAdmin(user, session.churchId);
        const isOpen = session.collaborationMode === "open";

        if (!isOperator && !isAdmin && !isOpen) {
            throw new Error("Only the operator can change the live slide");
        }

        await ctx.db.patch(args.sessionId, {
            liveSlideId: args.slideId,
            // Any explicit live slide change should unblank the output.
            isBlank: false,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const setOperatorSlides = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        slideIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        if (!isOperatorOrAdmin(user, session)) {
            throw new Error("Only the operator can set the slide order");
        }

        await ctx.db.patch(args.sessionId, {
            operatorSlideIds: args.slideIds,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const addToQueue = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        slideIds: v.array(v.string()),
        position: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        const mode = session.collaborationMode || "moderated";
        const isOperator = session.operatorId === user._id;
        const isAdmin = isChurchAdmin(user, session.churchId);

        if (mode === "strict" && !isOperator && !isAdmin) {
            throw new Error("Only the operator can add slides in strict mode");
        }

        const now = Date.now();
        const newEntries = args.slideIds.map(slideId => ({
            slideId,
            suggestedBy: user._id!,
            suggestedAt: now,
        }));

        const currentQueue = session.queue || [];
        let updatedQueue;

        if (mode === "open") {
            if (args.position !== undefined && args.position >= 0) {
                updatedQueue = [...currentQueue];
                updatedQueue.splice(args.position, 0, ...newEntries);
            } else {
                updatedQueue = [...currentQueue, ...newEntries];
            }
        } else {
            updatedQueue = [...currentQueue, ...newEntries];
        }

        await ctx.db.patch(args.sessionId, {
            queue: updatedQueue,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const addToOperatorDeck = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        slideIds: v.array(v.string()),
        position: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        const mode = session.collaborationMode || "moderated";
        const isAdmin = isChurchAdmin(user, session.churchId);

        if (mode === "strict" && session.operatorId !== user._id && !isAdmin) {
            throw new Error("Only the operator can add slides in strict mode");
        }

        const currentSlides = session.operatorSlideIds || [];
        const newSlideIds = args.slideIds.filter(id => !currentSlides.includes(id));
        if (newSlideIds.length === 0) return true;

        let updatedSlides;
        if (args.position !== undefined && args.position >= 0 && args.position <= currentSlides.length) {
            updatedSlides = [...currentSlides];
            updatedSlides.splice(args.position, 0, ...newSlideIds);
        } else {
            updatedSlides = [...currentSlides, ...newSlideIds];
        }

        await ctx.db.patch(args.sessionId, {
            operatorSlideIds: updatedSlides,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const removeFromQueue = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        slideIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const { session } = await requireActiveSession(ctx, args.sessionId);

        const currentQueue = session.queue || [];
        const updatedQueue = removeQueueEntriesByOccurrence(currentQueue, args.slideIds);

        await ctx.db.patch(args.sessionId, {
            queue: updatedQueue,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const acceptFromQueue = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        slideIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        if (!isOperatorOrAdmin(user, session)) {
            throw new Error("Only the operator can accept slides from the queue");
        }

        const currentQueue = session.queue || [];
        const updatedQueue = removeQueueEntriesByOccurrence(currentQueue, args.slideIds);

        const currentSlides = session.operatorSlideIds || [];
        const newSlides = [...currentSlides, ...args.slideIds.filter(id => !currentSlides.includes(id))];

        await ctx.db.patch(args.sessionId, {
            queue: updatedQueue,
            operatorSlideIds: newSlides,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const reorderQueue = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        orderedSlideIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        if (!isOperatorOrAdmin(user, session)) {
            throw new Error("Only the operator can reorder the queue");
        }

        const currentQueue = session.queue || [];
        const buckets = new Map<string, Array<typeof currentQueue[number]>>();
        for (const entry of currentQueue) {
            const existing = buckets.get(entry.slideId) || [];
            existing.push(entry);
            buckets.set(entry.slideId, existing);
        }

        const reorderedQueue: typeof currentQueue = [];
        for (const slideId of args.orderedSlideIds) {
            const bucket = buckets.get(slideId);
            if (bucket && bucket.length > 0) {
                const next = bucket.shift();
                if (next) reorderedQueue.push(next);
            }
        }

        await ctx.db.patch(args.sessionId, {
            queue: reorderedQueue,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const toggleBlank = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        isBlank: v.boolean(),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        if (!isOperatorOrAdmin(user, session)) {
            throw new Error("Only the operator can toggle blank");
        }

        await ctx.db.patch(args.sessionId, {
            isBlank: args.isBlank,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const setOverlay = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        overlay: v.optional(v.string()),
        alertId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await requireActiveSession(ctx, args.sessionId);

        await ctx.db.patch(args.sessionId, {
            activeOverlay: args.overlay,
            activeAlertId: args.alertId,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const transferOperator = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        newOperatorId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        const isCurrentOperator = session.operatorId === user._id;
        const isAdmin = isChurchAdmin(user, session.churchId);

        if (!isCurrentOperator && !isAdmin) {
            throw new Error("Only the current operator or an admin can transfer control");
        }

        const newOperator = await ctx.db.get(args.newOperatorId);

        if (!newOperator || newOperator.churchId !== session.churchId) {
            throw new Error("New operator not found or not in the same church");
        }

        await ctx.db.patch(args.sessionId, {
            operatorId: args.newOperatorId,
            updatedAt: new Date().toISOString(),
        });

        const currentOperatorPresence = await ctx.db
            .query("presence")
            .withIndex("by_session", (q) => q.eq("liveSessionId", args.sessionId))
            .filter((q) => q.eq(q.field("userId"), session.operatorId))
            .first();

        if (currentOperatorPresence) {
            await ctx.db.patch(currentOperatorPresence._id, {
                sessionRole: "contributor",
            });
        }

        const newOperatorPresence = await ctx.db
            .query("presence")
            .withIndex("by_session", (q) => q.eq("liveSessionId", args.sessionId))
            .filter((q) => q.eq(q.field("userId"), args.newOperatorId))
            .first();

        if (newOperatorPresence) {
            await ctx.db.patch(newOperatorPresence._id, {
                sessionRole: "operator",
            });
        }

        return true;
    },
});

export const updateCollaborationMode = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        collaborationMode: v.union(
            v.literal("strict"),
            v.literal("moderated"),
            v.literal("open"),
        ),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        const isOperator = session.operatorId === user._id;
        const isAdmin = isChurchAdmin(user, session.churchId);

        if (!isOperator && !isAdmin) {
            throw new Error("Only the operator or an admin can change collaboration mode");
        }

        await ctx.db.patch(args.sessionId, {
            collaborationMode: args.collaborationMode,
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

export const joinSession = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        role: v.optional(v.union(
            v.literal("contributor"),
            v.literal("viewer"),
        )),
    },
    handler: async (ctx, args) => {
        const { user, session } = await requireActiveSession(ctx, args.sessionId);

        const existingPresence = await ctx.db
            .query("presence")
            .withIndex("by_session", (q) => q.eq("liveSessionId", args.sessionId))
            .filter((q) => q.eq(q.field("userId"), user._id))
            .first();

        if (existingPresence) {
            await ctx.db.patch(existingPresence._id, {
                sessionRole: args.role || "contributor",
                lastSeen: Date.now(),
            });
            return true;
        }

        await ctx.db.insert("presence", {
            userId: user._id!,
            churchId: session.churchId,
            location: "live",
            activeScheduleId: session.scheduleId,
            liveSessionId: args.sessionId,
            sessionRole: args.role || "contributor",
            selectedSlideId: undefined,
            lastSeen: Date.now(),
            createdAt: new Date().toISOString(),
        });

        return true;
    },
});

export const leaveSession = mutation({
    args: {
        sessionId: v.id("liveSessions"),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        const presenceEntry = await ctx.db
            .query("presence")
            .withIndex("by_session", (q) => q.eq("liveSessionId", args.sessionId))
            .filter((q) => q.eq(q.field("userId"), user._id))
            .first();

        if (presenceEntry) {
            await ctx.db.delete(presenceEntry._id);
        }

        return true;
    },
});
