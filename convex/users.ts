import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { maybeStartTrial } from "./licensing";

// Role type
export type UserRole = "superadmin" | "admin" | "member";

// Check if user has required role or higher
export function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean {
    const roleHierarchy: Record<UserRole, number> = {
        superadmin: 3,
        admin: 2,
        member: 1,
    };
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

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

// Check if any superadmin exists
export const hasSuperadmin = query({
    args: {},
    handler: async (ctx) => {
        const superadmin = await ctx.db
            .query("users")
            .withIndex("by_role", (q) => q.eq("role", "superadmin"))
            .first();
        return !!superadmin;
    },
});

// Get user count
export const getUserCount = query({
    args: {},
    handler: async (ctx) => {
        const users = await ctx.db.query("users").collect();
        return users.length;
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
            // Start the free trial on first sign-in (no-op if they already have
            // a subscription row — trial, comp, or paid).
            await maybeStartTrial(ctx, { email: args.email, userId: existingUser._id });
            return existingUser._id;
        } else {
            // Check if this is the first user (make them superadmin)
            const userCount = await ctx.db.query("users").collect();
            const isFirstUser = userCount.length === 0;
            const role: UserRole = isFirstUser ? "superadmin" : "member";

            // Create new user
            const userId = await ctx.db.insert("users", {
                clerkId: args.clerkId,
                fullname: args.fullname,
                email: args.email,
                role,
                avatar: args.avatar || "",
                theme: "light",
                churchId: args.churchId || "",
                createdAt: now,
                updatedAt: now,
            });
            // Every brand-new account starts a 14-day Pro trial.
            await maybeStartTrial(ctx, { email: args.email, userId });
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

// Update user role (superadmin only)
export const updateUserRole = mutation({
    args: {
        userId: v.id("users"),
        newRole: v.union(
            v.literal("superadmin"),
            v.literal("admin"),
            v.literal("member")
        ),
        requesterId: v.id("users"),
    },
    handler: async (ctx, args) => {
        // Check if requester is superadmin
        const requester = await ctx.db.get(args.requesterId);
        if (!requester || requester.role !== "superadmin") {
            throw new Error("Only superadmins can update user roles");
        }

        await ctx.db.patch(args.userId, {
            role: args.newRole,
            updatedAt: new Date().toISOString(),
        });
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

// Delete user (superadmin only)
export const deleteUser = mutation({
    args: {
        userId: v.id("users"),
        requesterId: v.id("users"),
    },
    handler: async (ctx, args) => {
        // Check if requester is superadmin
        const requester = await ctx.db.get(args.requesterId);
        if (!requester || requester.role !== "superadmin") {
            throw new Error("Only superadmins can delete users");
        }

        await ctx.db.delete(args.userId);
        return args.userId;
    },
});

// Check if user can access admin features
export const canAccessAdmin = query({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        const user = await ctx.db.get(args.userId);
        if (!user) return false;
        return user.role === "superadmin" || user.role === "admin";
    },
});

// Check if user is superadmin
export const isSuperadmin = query({
    args: { userId: v.id("users") },
    handler: async (ctx, args) => {
        const user = await ctx.db.get(args.userId);
        if (!user) return false;
        return user.role === "superadmin";
    },
});
