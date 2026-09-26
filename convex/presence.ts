import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, isMemberOf, requireUser } from "./lib/auth";

/**
 * Presence is a heartbeat: it fires every 15 seconds whether or not the auth
 * token happens to be mid-refresh. Throwing made Convex log an uncaught
 * "Not authenticated" error with a full stack trace on every tick during a
 * reconnect — pages of noise in the console that would bury a real error
 * mid-service, for something whose only consequence is a presence dot lingering
 * a few seconds longer. So the pings use `getCurrentUser` and quietly skip;
 * everything that reads real data still goes through `requireUser`.
 */

/**
 * Attach each entry's user — the fields a presence avatar needs, not the whole
 * row (clerkId, preferences, subscription).
 */
async function withUsers(ctx: QueryCtx, entries: Doc<"presence">[]) {
    const ids = [...new Set(entries.map((entry) => entry.userId))];
    const users = await Promise.all(
        ids.map(async (id) => {
            const normalized = ctx.db.normalizeId("users", id);
            return normalized ? await ctx.db.get(normalized as Id<"users">) : null;
        })
    );
    const byId = new Map(
        users.filter((u) => u !== null).map((u) => [u._id as string, {
            _id: u._id,
            fullname: u.fullname,
            email: u.email,
            avatar: u.avatar,
            role: u.role,
        }])
    );
    return entries.map((entry) => ({ ...entry, user: byId.get(entry.userId) ?? null }));
}

export const getPresenceByChurch = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        if (!isMemberOf(user, args.churchId)) {
            throw new Error("Unauthorized: not a member of this church");
        }

        const cutoff = Date.now() - 60_000;

        const presenceEntries = await ctx.db
            .query("presence")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .filter((q) => q.gte(q.field("lastSeen"), cutoff))
            .take(200);

        return await withUsers(ctx, presenceEntries);
    },
});

export const getPresenceBySession = query({
    args: {
        sessionId: v.id("liveSessions"),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        const session = await ctx.db.get(args.sessionId);
        if (!session || session.status !== "active") {
            return [];
        }

        if (!isMemberOf(user, session.churchId)) {
            throw new Error("Unauthorized: not a member of this church");
        }

        const cutoff = Date.now() - 60_000;

        const presenceEntries = await ctx.db
            .query("presence")
            .withIndex("by_session", (q) => q.eq("liveSessionId", args.sessionId))
            .filter((q) => q.gte(q.field("lastSeen"), cutoff))
            .take(200);

        return await withUsers(ctx, presenceEntries);
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
        const user = await getCurrentUser(ctx);
        if (!user) return null;

        // Don't let a ping announce the caller inside another church's session.
        if (args.liveSessionId) {
            const session = await ctx.db.get(args.liveSessionId);
            if (!session || !isMemberOf(user, session.churchId)) return null;
        }

        const existingPresence = await ctx.db
            .query("presence")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        if (existingPresence) {
            await ctx.db.patch(existingPresence._id, {
                // Follow the user if they have switched churches since.
                churchId: user.churchId,
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
        const user = await getCurrentUser(ctx);
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
