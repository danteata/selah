import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, isMemberOf, requireUser } from "./lib/auth";

/**
 * How long after its last ping an entry still counts as present: a few pings'
 * worth of the client's interval (usePresence.ts), 30 seconds in a live
 * session and 2 minutes outside one. Every ping re-runs every presence list in
 * the church for everyone watching one, so outside a session, where it only
 * says who's around, it pings far less often than in one, where the avatars
 * show who is there.
 */
const LIVE_TIMEOUT_MS = 90_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;

/** A ping that changes nothing but `lastSeen` sooner than this after the last isn't written. */
const MIN_PING_GAP_MS = 20_000;

function isPresent(entry: Doc<"presence">, now: number): boolean {
    return entry.lastSeen >= now - (entry.location === "live" ? LIVE_TIMEOUT_MS : IDLE_TIMEOUT_MS);
}

/**
 * Presence is a heartbeat: it fires every so often whether or not the auth
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

        const now = Date.now();

        const presenceEntries = await ctx.db
            .query("presence")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .filter((q) => q.gte(q.field("lastSeen"), now - IDLE_TIMEOUT_MS))
            .take(200);

        return await withUsers(ctx, presenceEntries.filter((entry) => isPresent(entry, now)));
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

        const now = Date.now();

        const presenceEntries = await ctx.db
            .query("presence")
            .withIndex("by_session", (q) => q.eq("liveSessionId", args.sessionId))
            .filter((q) => q.gte(q.field("lastSeen"), now - IDLE_TIMEOUT_MS))
            .take(200);

        return await withUsers(ctx, presenceEntries.filter((entry) => isPresent(entry, now)));
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
            // Carry the last-known schedule, session and slide forward only
            // within the same church. After a church switch the old values
            // named the old church's session, so the user stayed listed in it
            // (as its operator) for as long as they worked in the new one.
            const kept = existingPresence.churchId === user.churchId ? existingPresence : undefined;
            const fields = {
                // Follow the user if they have switched churches since.
                churchId: user.churchId,
                location: args.location || existingPresence.location,
                activeScheduleId: args.activeScheduleId ?? kept?.activeScheduleId,
                liveSessionId: args.liveSessionId ?? kept?.liveSessionId,
                sessionRole: args.sessionRole ?? kept?.sessionRole,
                selectedSlideId: args.selectedSlideId ?? kept?.selectedSlideId,
            };
            const now = Date.now();
            // A repeat of the last ping, moments after it (older clients ping
            // every 15 seconds, and a window coming back into view pings on
            // top of the interval's): every write re-runs the church's
            // presence lists, and this one would change nothing anyone sees.
            const unchanged = (Object.keys(fields) as Array<keyof typeof fields>)
                .every((key) => fields[key] === existingPresence[key]);
            if (unchanged && now - existingPresence.lastSeen < MIN_PING_GAP_MS) {
                return existingPresence._id;
            }
            await ctx.db.patch(existingPresence._id, { ...fields, lastSeen: now });
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

        // Every row: older builds could leave more than one.
        const entries = await ctx.db
            .query("presence")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .take(20);
        for (const entry of entries) await ctx.db.delete(entry._id);

        return true;
    },
});
