/* eslint-disable @typescript-eslint/no-explicit-any */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

async function getAuthenticatedUser(ctx: any) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        throw new Error("Not authenticated");
    }

    const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q: any) => q.eq("email", identity.email!))
        .unique();

    if (!user) {
        throw new Error("User not found");
    }

    return user;
}

export const getActiveSession = query({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db
            .query("liveSessions")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .filter((q) => q.eq(q.field("status"), "active"))
            .first();

        if (session && user.churchId !== session.churchId) {
            throw new Error("Unauthorized: not a member of this church");
        }

        return session;
    },
});

export const getActiveSessionByChurch = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getAuthenticatedUser(ctx);

        if (user.churchId !== args.churchId) {
            throw new Error("Unauthorized: not a member of this church");
        }

        const sessions = await ctx.db
            .query("liveSessions")
            .withIndex("by_church_active", (q) =>
                q.eq("churchId", args.churchId).eq("status", "active")
            )
            .collect();

        return sessions;
    },
});

export const getSession = query({
    args: {
        sessionId: v.id("liveSessions"),
    },
    handler: async (ctx, args) => {
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);

        if (session && user.churchId !== session.churchId) {
            throw new Error("Unauthorized: not a member of this church");
        }

        return session;
    },
});

export const startSession = mutation({
    args: {
        scheduleId: v.string(),
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getAuthenticatedUser(ctx);

        if (user.churchId !== args.churchId) {
            throw new Error("Unauthorized: not a member of this church");
        }

        const existingSession = await ctx.db
            .query("liveSessions")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .filter((q) => q.eq(q.field("status"), "active"))
            .first();

        if (existingSession) {
            throw new Error("An active session already exists for this schedule");
        }

        const now = new Date().toISOString();
        const sessionId = await ctx.db.insert("liveSessions", {
            churchId: args.churchId,
            scheduleId: args.scheduleId,
            operatorId: user._id!,
            liveSlideId: undefined,
            queuedSlideIds: [],
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
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session) {
            throw new Error("Session not found");
        }

        if (session.operatorId !== user._id && user.role !== "superadmin" && user.role !== "admin") {
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
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            throw new Error("No active session found");
        }

        if (session.operatorId !== user._id && user.role !== "superadmin" && user.role !== "admin") {
            throw new Error("Only the operator can change the live slide");
        }

        await ctx.db.patch(args.sessionId, {
            liveSlideId: args.slideId,
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
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            throw new Error("No active session found");
        }

        if (user.churchId !== session.churchId) {
            throw new Error("Unauthorized");
        }

        const currentQueue = session.queuedSlideIds || [];
        let updatedQueue: string[];

        if (args.position !== undefined && args.position >= 0) {
            updatedQueue = [...currentQueue];
            updatedQueue.splice(args.position, 0, ...args.slideIds);
        } else {
            updatedQueue = [...currentQueue, ...args.slideIds];
        }

        await ctx.db.patch(args.sessionId, {
            queuedSlideIds: updatedQueue,
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
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            throw new Error("No active session found");
        }

        if (user.churchId !== session.churchId) {
            throw new Error("Unauthorized");
        }

        const currentQueue = session.queuedSlideIds || [];
        const updatedQueue = currentQueue.filter(id => !args.slideIds.includes(id));

        await ctx.db.patch(args.sessionId, {
            queuedSlideIds: updatedQueue,
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
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            throw new Error("No active session found");
        }

        if (session.operatorId !== user._id && user.role !== "superadmin" && user.role !== "admin") {
            throw new Error("Only the operator can reorder the queue");
        }

        await ctx.db.patch(args.sessionId, {
            queuedSlideIds: args.orderedSlideIds,
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
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            throw new Error("No active session found");
        }

        if (session.operatorId !== user._id && user.role !== "superadmin" && user.role !== "admin") {
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
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            throw new Error("No active session found");
        }

        if (user.churchId !== session.churchId) {
            throw new Error("Unauthorized");
        }

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
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            throw new Error("No active session found");
        }

        const isCurrentOperator = session.operatorId === user._id;
        const isAdmin = user.role === "superadmin" || user.role === "admin";

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

export const joinSession = mutation({
    args: {
        sessionId: v.id("liveSessions"),
        role: v.optional(v.union(
            v.literal("contributor"),
            v.literal("viewer"),
        )),
    },
    handler: async (ctx, args) => {
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            throw new Error("No active session found");
        }

        if (user.churchId !== session.churchId) {
            throw new Error("Unauthorized: not a member of this church");
        }

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
        const user = await getAuthenticatedUser(ctx);

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