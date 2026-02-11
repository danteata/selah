import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Get current user by clerk ID
export const getCurrentUser = query({
    args: { clerkId: v.optional(v.string()) },
    handler: async (ctx, args) => {
        if (!args.clerkId) {
            return null;
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
            .first();

        return user;
    },
});

// Get user by ID
export const getUserById = query({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        const user = await ctx.db.get(args.userId);
        return user;
    },
});

// Get users by church
export const getUsersByChurch = query({
    args: { churchId: v.string() },
    handler: async (ctx, args) => {
        const users = await ctx.db
            .query("users")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .collect();
        return users;
    },
});

// Create or update user
export const upsertUser = mutation({
    args: {
        clerkId: v.string(),
        fullname: v.string(),
        email: v.string(),
        avatar: v.optional(v.string()),
        churchId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existingUser = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
            .first();

        const now = new Date().toISOString();

        if (existingUser) {
            // Update existing user
            await ctx.db.patch(existingUser._id, {
                fullname: args.fullname,
                email: args.email,
                avatar: args.avatar || existingUser.avatar,
                churchId: args.churchId || existingUser.churchId,
                updatedAt: now,
            });
            return existingUser._id;
        } else {
            // Create new user
            const userId = await ctx.db.insert("users", {
                clerkId: args.clerkId,
                fullname: args.fullname,
                email: args.email,
                role: "member",
                avatar: args.avatar || "",
                theme: "light",
                churchId: args.churchId || "",
                createdAt: now,
                updatedAt: now,
            });
            return userId;
        }
    },
});

// Update user profile
export const updateUserProfile = mutation({
    args: {
        userId: v.id("users"),
        fullname: v.optional(v.string()),
        avatar: v.optional(v.string()),
        theme: v.optional(v.string()),
        preferences: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await ctx.db.get(args.userId);
        if (!user) {
            throw new Error("User not found");
        }

        const updates: Record<string, unknown> = {
            updatedAt: new Date().toISOString(),
        };

        if (args.fullname !== undefined) updates.fullname = args.fullname;
        if (args.avatar !== undefined) updates.avatar = args.avatar;
        if (args.theme !== undefined) updates.theme = args.theme;
        if (args.preferences !== undefined) updates.preferences = args.preferences;

        await ctx.db.patch(args.userId, updates);
        return args.userId;
    },
});

// Update user church
export const updateUserChurch = mutation({
    args: {
        userId: v.id("users"),
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.userId, {
            churchId: args.churchId,
            updatedAt: new Date().toISOString(),
        });
        return args.userId;
    },
});

// Delete user
export const deleteUser = mutation({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.userId);
        return args.userId;
    },
});
