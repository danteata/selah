import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { assertTeamMemberLimit } from "./entitlements";

// Generate a random invite code (URL-safe, 12 characters)
function generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like I, O, 0, 1
    let code = '';
    for (let i = 0; i < 12; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Format as XXX-XXX-XXX for readability
    return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

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

        // Generate default invite code
        let defaultInviteCode = generateInviteCode();
        let attempts = 0;
        while (attempts < 10) {
            const existing = await ctx.db
                .query("invitations")
                .withIndex("by_code", (q) => q.eq("code", defaultInviteCode))
                .unique();
            if (!existing) break;
            defaultInviteCode = generateInviteCode();
            attempts++;
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
            defaultInviteCode,
            createdAt: now,
            updatedAt: now,
        });

        // Create the default invitation record
        await ctx.db.insert("invitations", {
            code: defaultInviteCode,
            churchId: churchId,
            type: "link",
            createdBy: user._id!,
            status: "pending",
            createdAt: now,
            updatedAt: now,
        });

        // Update user with churchId and make them admin
        await ctx.db.patch(user._id as Id<"users">, {
            churchId: churchId,
            role: "admin", // Church creator becomes admin
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

        // Find the invitation
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_code", (q) => q.eq("code", args.inviteCode))
            .unique();

        if (!invitation) {
            throw new Error("Invalid invite code");
        }

        // Check if invitation is still valid
        if (invitation.status !== "pending") {
            if (invitation.status === "accepted") {
                throw new Error("This invite code has already been used");
            }
            if (invitation.status === "revoked") {
                throw new Error("This invite code has been revoked");
            }
            if (invitation.status === "expired") {
                throw new Error("This invite code has expired");
            }
        }

        // Check expiration
        const now = new Date();
        if (invitation.expiresAt && new Date(invitation.expiresAt) < now) {
            await ctx.db.patch(invitation._id!, { status: "expired", updatedAt: now.toISOString() });
            throw new Error("This invite code has expired");
        }

        // For email invitations, verify the email matches
        if (invitation.type === "email" && invitation.email) {
            if (identity.email?.toLowerCase() !== invitation.email.toLowerCase()) {
                throw new Error("This invitation was sent to a different email address");
            }
        }

        let user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        // Enforce the church's plan team-size cap before adding a NEW member.
        if (user?.churchId !== invitation.churchId) {
            await assertTeamMemberLimit(ctx, invitation.churchId);
        }

        // Create user if they don't exist (just-in-time user creation)
        if (!user) {
            const userId = await ctx.db.insert("users", {
                email: identity.email!,
                fullname: identity.givenName && identity.familyName
                    ? `${identity.givenName} ${identity.familyName}`
                    : identity.email!.split('@')[0],
                avatar: identity.pictureUrl || "",
                theme: "light",
                role: "member",
                churchId: invitation.churchId,
                clerkId: identity.subject,
                emailVerified: true,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });

            user = await ctx.db.get(userId);
        } else {
            // Check if user is already in a church
            if (user.churchId && user.churchId !== invitation.churchId) {
                throw new Error("You are already a member of another church. Please leave your current church before joining a new one.");
            }
            if (user.churchId === invitation.churchId) {
                throw new Error("You are already a member of this church");
            }
        }

        if (!user) {
            throw new Error("Failed to create or retrieve user");
        }

        // Update user's churchId
        await ctx.db.patch(user._id as Id<"users">, {
            churchId: invitation.churchId,
            updatedAt: now.toISOString(),
        });

        // Add user to church's userIds array
        const church = await ctx.db
            .query("churches")
            .filter((q) => q.eq(q.field("_id"), invitation.churchId))
            .unique();

        if (church) {
            const userIds = church.userIds || [];
            if (!userIds.includes(user._id!)) {
                await ctx.db.patch(church._id!, {
                    userIds: [...userIds, user._id!],
                    updatedAt: now.toISOString(),
                });
            }
        }

        // Mark invitation as accepted
        await ctx.db.patch(invitation._id!, {
            status: "accepted",
            acceptedBy: user._id!,
            acceptedAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });

        return church;
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

// Get church by ID (simple query without auth)
export const getChurchById = query({
    args: { id: v.string() },
    handler: async (ctx, args) => {
        const church = await ctx.db
            .query("churches")
            .filter((q) => q.eq(q.field("_id"), args.id))
            .unique();
        return church;
    },
});

// List all churches (for superadmin)
export const listChurches = query({
    args: {},
    handler: async (ctx) => {
        const churches = await ctx.db.query("churches").collect();
        return churches;
    },
});
