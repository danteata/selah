import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Get current user
export const getCurrentUser = query({
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

        return user;
    },
});

// Create or update user from auth provider
export const createUser = mutation({
    args: {
        email: v.string(),
        fullname: v.string(),
        avatar: v.optional(v.string()),
        churchId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        // Check if user already exists
        const existingUser = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (existingUser) {
            // Update existing user
            return await ctx.db.patch(existingUser._id!, {
                fullname: args.fullname,
                avatar: args.avatar || existingUser.avatar,
                updatedAt: new Date().toISOString(),
            });
        }

        // Create new user
        const now = new Date().toISOString();
        const userId = await ctx.db.insert("users", {
            email: args.email,
            fullname: args.fullname,
            avatar: args.avatar || "",
            theme: "light",
            role: "member",
            churchId: args.churchId || "",
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
        });

        return userId;
    },
});

// Update user profile
export const updateUser = mutation({
    args: {
        fullname: v.optional(v.string()),
        avatar: v.optional(v.string()),
        theme: v.optional(v.string()),
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

        if (!user) {
            throw new Error("User not found");
        }

        await ctx.db.patch(user._id!, {
            ...args,
            updatedAt: new Date().toISOString(),
        });

        return user._id!;
    },
});

// Delete user
export const deleteUser = mutation({
    args: {
        userId: v.string(),
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

        if (!user || user._id !== args.userId) {
            throw new Error("Unauthorized");
        }

        await ctx.db.delete(user._id!);
        return true;
    },
});

// Update user preferences
export const updateUserPreferences = mutation({
    args: {
        preferences: v.record(v.string(), v.any()),
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

        if (!user) {
            throw new Error("User not found");
        }

        // For now, we'll store preferences as a JSON string in a new field
        // In a real app, you might want a separate preferences table
        await ctx.db.patch(user._id!, {
            preferences: JSON.stringify(args.preferences),
            updatedAt: new Date().toISOString(),
        });

        return true;
    },
});

// Change password (for email/password auth - if needed)
export const changePassword = mutation({
    args: {
        currentPassword: v.string(),
        newPassword: v.string(),
    },
    handler: async (ctx, args) => {
        // This would only work with email/password auth
        // For OAuth providers like Google, password change is handled by the provider
        throw new Error("Password change not supported for OAuth users");
    },
});
