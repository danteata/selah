import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getById, getCurrentUser, isMemberOf, isSuperadmin } from "./lib/auth";
import {
    generateUniqueInviteCode,
    getOrCreateUserFromIdentity,
    redeemInvitation,
} from "./lib/invites";

// Create a new church, with the caller as its admin
export const createChurch = mutation({
    args: {
        name: v.string(),
        type: v.optional(v.string()),
        address: v.optional(v.string()),
        pastor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await getOrCreateUserFromIdentity(ctx);

        // Creating a church moves you into it. For a member of an existing
        // church that silently abandoned the old one (leaving them in its
        // `userIds`), so require leaving first. A superadmin can found churches
        // freely — they switch between them anyway.
        if (user.churchId && !isSuperadmin(user)) {
            throw new Error("You already belong to a church. Leave it before creating a new one.");
        }

        const name = args.name.trim();
        if (!name) throw new Error("Church name is required");

        const defaultInviteCode = await generateUniqueInviteCode(ctx);

        const now = new Date().toISOString();
        const churchId = await ctx.db.insert("churches", {
            name,
            type: args.type || "church",
            address: args.address || "",
            pastor: args.pastor || user.fullname,
            userIds: [user._id],
            storageUsed: 0,
            subscriptionPlan: "free",
            defaultInviteCode,
            createdAt: now,
            updatedAt: now,
        });

        // The church's persistent join link.
        await ctx.db.insert("invitations", {
            code: defaultInviteCode,
            churchId,
            type: "link",
            createdBy: user._id,
            status: "pending",
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(user._id, {
            churchId,
            // The founder administers the church — but never demote a
            // superadmin to plain admin by founding one.
            role: isSuperadmin(user) ? "superadmin" : "admin",
            updatedAt: now,
        });

        return churchId;
    },
});

// Join an existing church by invite code
export const joinChurch = mutation({
    args: {
        inviteCode: v.string(),
    },
    handler: async (ctx, args) => {
        const { church } = await redeemInvitation(ctx, args.inviteCode);
        return church;
    },
});

// The caller's church, or — for a superadmin — any church by id.
export const getChurch = query({
    args: {
        churchId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) return null;

        const churchId = args.churchId || user.churchId;
        if (!isMemberOf(user, churchId) && !isSuperadmin(user)) return null;

        return await getById(ctx, "churches", churchId);
    },
});

// Get current user's church
export const getMyChurch = query({
    args: {},
    handler: async (ctx) => {
        const user = await getCurrentUser(ctx);
        if (!user?.churchId) return null;
        return await getById(ctx, "churches", user.churchId);
    },
});

// Check if user has a church
export const hasChurch = query({
    args: {},
    handler: async (ctx) => {
        const user = await getCurrentUser(ctx);
        return !!user?.churchId;
    },
});

// A church by id, for its members (and superadmins). Returned null to anyone
// else — it used to answer every caller, signed in or not.
export const getChurchById = query({
    args: { id: v.string() },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) return null;
        if (!isMemberOf(user, args.id) && !isSuperadmin(user)) return null;
        return await getById(ctx, "churches", args.id);
    },
});

// Every church, for the superadmin church switcher.
export const listChurches = query({
    args: {},
    handler: async (ctx) => {
        const user = await getCurrentUser(ctx);
        if (!user || !isSuperadmin(user)) return [];
        return await ctx.db.query("churches").take(1000);
    },
});
