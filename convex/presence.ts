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

/**
 * The same lookup, but returning null instead of throwing when the caller has no
 * identity yet.
 *
 * Presence is a heartbeat: it fires every 15 seconds whether or not the auth
 * token happens to be mid-refresh. Throwing made Convex log an uncaught
 * "Not authenticated" error with a full stack trace on every tick during a
 * reconnect — pages of noise in the console that would bury a real error
 * mid-service, for something whose only consequence is a presence dot lingering
 * a few seconds longer.
 *
 * Only the presence pings use this. Everything that reads or writes real data
 * still goes through `getAuthenticatedUser` and still throws.
 */
async function getUserOrNull(ctx: any) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        return null;
    }

    return await ctx.db
        .query("users")
        .withIndex("by_email", (q: any) => q.eq("email", identity.email!))
        .unique();
}

export const getPresenceByChurch = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getAuthenticatedUser(ctx);

        if (user.churchId !== args.churchId) {
            throw new Error("Unauthorized: not a member of this church");
        }

        const cutoff = Date.now() - 60_000;

        const presenceEntries = await ctx.db
            .query("presence")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .filter((q) => q.gte(q.field("lastSeen"), cutoff))
            .collect();

        const userIds = [...new Set(presenceEntries.map(p => p.userId))];

        const users = await Promise.all(
            userIds.map(id => ctx.db.get(id as any))
        );

        const userMap = new Map();
        for (const u of users) {
            if (u) userMap.set(u._id, u);
        }

        return presenceEntries.map(entry => ({
            ...entry,
            user: userMap.get(entry.userId) || null,
        }));
    },
});

export const getPresenceBySession = query({
    args: {
        sessionId: v.id("liveSessions"),
    },
    handler: async (ctx, args) => {
        const user = await getAuthenticatedUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            return [];
        }

        if (user.churchId !== session.churchId) {
            throw new Error("Unauthorized: not a member of this church");
        }

        const cutoff = Date.now() - 60_000;

        const presenceEntries = await ctx.db
            .query("presence")
            .withIndex("by_session", (q) => q.eq("liveSessionId", args.sessionId))
            .filter((q) => q.gte(q.field("lastSeen"), cutoff))
            .collect();

        const userIds = [...new Set(presenceEntries.map(p => p.userId))];
        const users = await Promise.all(
            userIds.map(id => ctx.db.get(id as any))
        );
        const userMap = new Map();
        for (const u of users) {
            if (u) userMap.set(u._id, u);
        }

        return presenceEntries.map(entry => ({
            ...entry,
            user: userMap.get(entry.userId) || null,
        }));
    },
});

export const heartbeat = mutation({
    args: {
        location: v.optional(v.string()),
        activeScheduleId: v.optional(v.string()),
        liveSessionId: v.optional(v.id("liveSessions")),
        sessionRole: v.optional(v.union(
            v.literal("operator"),
            v.literal("contributor"),
            v.literal("viewer"),
        )),
        selectedSlideId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Silently skip rather than throw — see getUserOrNull.
        const user = await getUserOrNull(ctx);
        if (!user) return null;

        const existingPresence = await ctx.db
            .query("presence")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        if (existingPresence) {
            await ctx.db.patch(existingPresence._id, {
                location: args.location || existingPresence.location,
                activeScheduleId: args.activeScheduleId ?? existingPresence.activeScheduleId,
                liveSessionId: args.liveSessionId ?? existingPresence.liveSessionId,
                sessionRole: args.sessionRole ?? existingPresence.sessionRole,
                selectedSlideId: args.selectedSlideId ?? existingPresence.selectedSlideId,
                lastSeen: Date.now(),
            });
            return existingPresence._id;
        }

        return await ctx.db.insert("presence", {
            userId: user._id!,
            churchId: user.churchId,
            location: args.location || "dashboard",
            activeScheduleId: args.activeScheduleId,
            liveSessionId: args.liveSessionId,
            sessionRole: args.sessionRole,
            selectedSlideId: args.selectedSlideId,
            lastSeen: Date.now(),
            createdAt: new Date().toISOString(),
        });
    },
});

export const leavePresence = mutation({
    args: {},
    handler: async (ctx) => {
        // Fires on unload, when the token may already be gone. Nothing to clean
        // up without an identity, so don't make it an error.
        const user = await getUserOrNull(ctx);
        if (!user) return null;

        const presenceEntry = await ctx.db
            .query("presence")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        if (presenceEntry) {
            await ctx.db.delete(presenceEntry._id);
        }

        return true;
    },
});

export const cleanupStalePresence = mutation({
    args: {
        churchId: v.string(),
        staleAfterMs: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const cutoff = Date.now() - (args.staleAfterMs || 120_000);

        const staleEntries = await ctx.db
            .query("presence")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .filter((q) => q.lt(q.field("lastSeen"), cutoff))
            .collect();

        for (const entry of staleEntries) {
            await ctx.db.delete(entry._id);
        }

        return staleEntries.length;
    },
});