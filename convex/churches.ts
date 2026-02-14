import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Create a new church
export const createChurch = mutation({
    args: {
        name: v.string(),
        type: v.optional(v.string()),
        address: v.optional(v.string()),
        pastor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        let user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        // Create user if they don't exist (just-in-time user creation)
        if (!user) {
            const now = new Date().toISOString();
            const userId = await ctx.db.insert("users", {
                email: identity.email!,
                fullname: identity.givenName && identity.familyName
                    ? `${identity.givenName} ${identity.familyName}`
                    : identity.email!.split('@')[0],
                avatar: identity.pictureUrl || "",
                theme: "light",
                role: "member",
                churchId: "",
                clerkId: identity.subject,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
            });

            user = await ctx.db.get(userId);
        }

        if (!user) {
            throw new Error("Failed to create or retrieve user");
        }

        const now = new Date().toISOString();
        const churchId = await ctx.db.insert("churches", {
            name: args.name,
            type: args.type || "church",
            address: args.address || "",
            pastor: args.pastor || user.fullname,
            userIds: [user._id!],
            storageUsed: 0,
            subscriptionPlan: "free",
            createdAt: now,
            updatedAt: now,
        });

        // Update user with churchId
        await ctx.db.patch(user._id as Id<"users">, {
            churchId: churchId,
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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        let user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        // Create user if they don't exist (just-in-time user creation)
        if (!user) {
            const now = new Date().toISOString();
            const userId = await ctx.db.insert("users", {
                email: identity.email!,
                fullname: identity.givenName && identity.familyName
                    ? `${identity.givenName} ${identity.familyName}`
                    : identity.email!.split('@')[0],
                avatar: identity.pictureUrl || "",
                theme: "light",
                role: "member",
                churchId: "",
                clerkId: identity.subject,
                emailVerified: true,
                createdAt: now,
                updatedAt: now,
            });

            user = await ctx.db.get(userId);
        }

        if (!user) {
            throw new Error("Failed to create or retrieve user");
        }

        // For now, we don't have invite codes implemented
        // This could be extended to validate codes
        // For now, just return the user's current church if any
        if (user.churchId) {
            const church = await ctx.db
                .query("churches")
                .filter((q) => q.eq(q.field("_id"), user.churchId))
                .unique();
            return church;
        }

        throw new Error("Invalid invite code or no church to join");
    },
});

// Get church by ID
export const getChurch = query({
    args: {
        churchId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return null;
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user) {
            return null;
        }

        // Use provided churchId or fall back to user's churchId
        const churchId = args.churchId || user.churchId;

        if (!churchId) {
            return null;
        }

        const church = await ctx.db
            .query("churches")
            .filter((q) => q.eq(q.field("_id"), churchId))
            .unique();

        return church;
    },
});

// Get current user's church
export const getMyChurch = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return null;
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || !user.churchId) {
            return null;
        }

        const church = await ctx.db
            .query("churches")
            .filter((q) => q.eq(q.field("_id"), user.churchId))
            .unique();

        return church;
    },
});

// Check if user has a church
export const hasChurch = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return false;
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        return !!user?.churchId;
    },
});
