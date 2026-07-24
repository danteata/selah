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

// Helper to check if user is admin of a church
async function isChurchAdmin(ctx: any, churchId: string, userId: string): Promise<boolean> {
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user) return false;

    // Superadmins can manage any church
    if (user.role === "superadmin") return true;

    // Admins can only manage their own church
    if (user.role === "admin" && user.churchId === churchId) return true;

    return false;
}

// Get all invitations for a church (admin only)
export const getInvitations = query({
    args: { churchId: v.string() },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user) {
            return [];
        }

        // Check if user is admin of this church
        const isAdmin = await isChurchAdmin(ctx, args.churchId, user._id!);
        if (!isAdmin) {
            return [];
        }

        const invitations = await ctx.db
            .query("invitations")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .order("desc")
            .collect();

        return invitations;
    },
});

// Get invitation by code (public, no auth required - for join page)
export const getInvitationByCode = query({
    args: { code: v.string() },
    handler: async (ctx, args) => {
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_code", (q) => q.eq("code", args.code))
            .unique();

        if (!invitation) {
            return null;
        }

        // Get church info
        const church = await ctx.db
            .query("churches")
            .filter((q) => q.eq(q.field("_id"), invitation.churchId))
            .unique();

        if (!church) {
            return null;
        }

        // Check if expired
        const now = new Date();
        const isExpired = invitation.expiresAt && new Date(invitation.expiresAt) < now;

        return {
            invitation: {
                ...invitation,
                status: isExpired ? "expired" : invitation.status,
            },
            church: {
                _id: church._id,
                name: church.name,
                type: church.type,
            },
            isValid: invitation.status === "pending" && !isExpired,
        };
    },
});

// Get pending invitations for current user (by email)
export const getMyInvitations = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const invitations = await ctx.db
            .query("invitations")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .filter((q) => q.eq(q.field("status"), "pending"))
            .collect();

        // Filter out expired invitations
        const now = new Date();
        const validInvitations = invitations.filter(inv => {
            if (inv.expiresAt && new Date(inv.expiresAt) < now) {
                return false;
            }
            return true;
        });

        // Get church info for each invitation
        const invitationsWithChurch = await Promise.all(
            validInvitations.map(async (inv) => {
                const church = await ctx.db
                    .query("churches")
                    .filter((q) => q.eq(q.field("_id"), inv.churchId))
                    .unique();
                return {
                    ...inv,
                    churchName: church?.name || "Unknown Church",
                };
            })
        );

        return invitationsWithChurch;
    },
});

// Create a new invite link
export const createInviteLink = mutation({
    args: {
        churchId: v.string(),
        expiresInDays: v.optional(v.number()),
        message: v.optional(v.string()),
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

        // Check if user is admin of this church
        const isAdmin = await isChurchAdmin(ctx, args.churchId, user._id!);
        if (!isAdmin) {
            throw new Error("Only admins can create invite links");
        }

        const now = new Date();
        const expiresAt = args.expiresInDays
            ? new Date(now.getTime() + args.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
            : undefined;

        // Generate unique code
        let code = generateInviteCode();
        let attempts = 0;
        while (attempts < 10) {
            const existing = await ctx.db
                .query("invitations")
                .withIndex("by_code", (q) => q.eq("code", code))
                .unique();
            if (!existing) break;
            code = generateInviteCode();
            attempts++;
        }

        const invitationId = await ctx.db.insert("invitations", {
            code,
            churchId: args.churchId,
            type: "link",
            createdBy: user._id!,
            status: "pending",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            expiresAt,
            message: args.message,
        });

        return {
            id: invitationId,
            code,
            inviteUrl: `${process.env.SITE_URL || 'https://selah.app'}/join/${code}`,
        };
    },
});

// Send email invitation (creates invitation record and triggers email)
export const sendEmailInvitation = mutation({
    args: {
        churchId: v.string(),
        email: v.string(),
        message: v.optional(v.string()),
        expiresInDays: v.optional(v.number()),
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

        // Check if user is admin of this church
        const isAdmin = await isChurchAdmin(ctx, args.churchId, user._id!);
        if (!isAdmin) {
            throw new Error("Only admins can send invitations");
        }

        // Normalize email
        const normalizedEmail = args.email.toLowerCase().trim();

        // Check if there's already a pending invitation for this email
        const existingInvite = await ctx.db
            .query("invitations")
            .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
            .filter((q) => q.eq(q.field("status"), "pending"))
            .unique();

        if (existingInvite) {
            // Check if it's for the same church
            if (existingInvite.churchId === args.churchId) {
                throw new Error("This email already has a pending invitation to your church");
            }
            // Different church - still allow, user can choose which to accept
        }

        // Check if user is already a member of this church
        const existingUser = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
            .unique();

        if (existingUser && existingUser.churchId === args.churchId) {
            throw new Error("This user is already a member of your church");
        }

        const now = new Date();
        const expiresAt = args.expiresInDays
            ? new Date(now.getTime() + args.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
            : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Default 7 days

        // Generate unique code
        let code = generateInviteCode();
        let attempts = 0;
        while (attempts < 10) {
            const existing = await ctx.db
                .query("invitations")
                .withIndex("by_code", (q) => q.eq("code", code))
                .unique();
            if (!existing) break;
            code = generateInviteCode();
            attempts++;
        }

        // Get church info for email
        const church = await ctx.db
            .query("churches")
            .filter((q) => q.eq(q.field("_id"), args.churchId))
            .unique();

        const invitationId = await ctx.db.insert("invitations", {
            code,
            churchId: args.churchId,
            type: "email",
            email: normalizedEmail,
            createdBy: user._id!,
            status: "pending",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            expiresAt,
            message: args.message,
        });

        // Return invitation details - email sending will be handled by an HTTP action
        return {
            id: invitationId,
            code,
            inviteUrl: `${process.env.SITE_URL || 'https://selah.app'}/join/${code}`,
            email: normalizedEmail,
            churchName: church?.name || "Unknown Church",
            inviterName: user.fullname,
            expiresAt,
        };
    },
});

// Accept an invitation and join the church
export const acceptInvitation = mutation({
    args: {
        code: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        // Find the invitation
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_code", (q) => q.eq("code", args.code))
            .unique();

        if (!invitation) {
            throw new Error("Invalid invitation code");
        }

        // Check if invitation is still valid
        if (invitation.status !== "pending") {
            if (invitation.status === "accepted") {
                throw new Error("This invitation has already been accepted");
            }
            if (invitation.status === "revoked") {
                throw new Error("This invitation has been revoked");
            }
            if (invitation.status === "expired") {
                throw new Error("This invitation has expired");
            }
        }

        // Check expiration
        const now = new Date();
        if (invitation.expiresAt && new Date(invitation.expiresAt) < now) {
            // Update status to expired
            await ctx.db.patch(invitation._id!, { status: "expired", updatedAt: now.toISOString() });
            throw new Error("This invitation has expired");
        }

        // For email invitations, verify the email matches
        if (invitation.type === "email" && invitation.email) {
            if (identity.email?.toLowerCase() !== invitation.email.toLowerCase()) {
                throw new Error("This invitation was sent to a different email address");
            }
        }

        // Get or create user
        let user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        // Enforce the church's plan team-size cap before adding a NEW member.
        // (Re-accepting as an existing member of this church is handled below
        // with a clearer "already a member" message, so skip the cap there.)
        if (user?.churchId !== invitation.churchId) {
            await assertTeamMemberLimit(ctx, invitation.churchId);
        }

        if (!user) {
            // Create user
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
                // User is in a different church - they need to leave first or be removed
                throw new Error("You are already a member of another church. Please leave your current church before accepting this invitation.");
            }
            if (user.churchId === invitation.churchId) {
                throw new Error("You are already a member of this church");
            }
        }

        if (!user) {
            throw new Error("Failed to create or retrieve user");
        }

        // Update user's churchId
        await ctx.db.patch(user._id!, {
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

        return {
            success: true,
            churchId: invitation.churchId,
            churchName: church?.name || "Unknown Church",
        };
    },
});

// Revoke a pending invitation
export const revokeInvitation = mutation({
    args: {
        invitationId: v.string(),
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

        const invitation = await ctx.db.get(args.invitationId as Id<"invitations">);
        if (!invitation) {
            throw new Error("Invitation not found");
        }

        // Check if user is admin of this church
        const isAdmin = await isChurchAdmin(ctx, invitation.churchId, user._id!);
        if (!isAdmin) {
            throw new Error("Only admins can revoke invitations");
        }

        // Only pending invitations can be revoked
        if (invitation.status !== "pending") {
            throw new Error("Only pending invitations can be revoked");
        }

        await ctx.db.patch(invitation._id!, {
            status: "revoked",
            updatedAt: new Date().toISOString(),
        });

        return { success: true };
    },
});

// Regenerate invite code for an existing invitation
export const regenerateInviteCode = mutation({
    args: {
        invitationId: v.string(),
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

        const invitation = await ctx.db.get(args.invitationId as Id<"invitations">);
        if (!invitation) {
            throw new Error("Invitation not found");
        }

        // Check if user is admin of this church
        const isAdmin = await isChurchAdmin(ctx, invitation.churchId, user._id!);
        if (!isAdmin) {
            throw new Error("Only admins can regenerate invite codes");
        }

        // Generate new unique code
        let code = generateInviteCode();
        let attempts = 0;
        while (attempts < 10) {
            const existing = await ctx.db
                .query("invitations")
                .withIndex("by_code", (q) => q.eq("code", code))
                .unique();
            if (!existing) break;
            code = generateInviteCode();
            attempts++;
        }

        const now = new Date();
        await ctx.db.patch(invitation._id!, {
            code,
            status: "pending", // Reset to pending if it was expired
            updatedAt: now.toISOString(),
        });

        return {
            code,
            inviteUrl: `${process.env.SITE_URL || 'https://selah.app'}/join/${code}`,
        };
    },
});

// Get or create default invite link for a church
export const getOrCreateDefaultInviteLink = mutation({
    args: {
        churchId: v.string(),
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

        // Check if user is admin of this church
        const isAdmin = await isChurchAdmin(ctx, args.churchId, user._id!);
        if (!isAdmin) {
            throw new Error("Only admins can manage invite links");
        }

        // Check if church already has a default invite code
        const church = await ctx.db
            .query("churches")
            .filter((q) => q.eq(q.field("_id"), args.churchId))
            .unique();

        if (church?.defaultInviteCode) {
            // Check if the invitation still exists and is valid
            const existingInvite = await ctx.db
                .query("invitations")
                .withIndex("by_code", (q) => q.eq("code", church.defaultInviteCode!))
                .unique();

            if (existingInvite && existingInvite.status === "pending") {
                return {
                    code: existingInvite.code,
                    inviteUrl: `${process.env.SITE_URL || 'https://selah.app'}/join/${existingInvite.code}`,
                    isNew: false,
                };
            }
        }

        // Create a new default invite link
        const now = new Date();
        let code = generateInviteCode();
        let attempts = 0;
        while (attempts < 10) {
            const existing = await ctx.db
                .query("invitations")
                .withIndex("by_code", (q) => q.eq("code", code))
                .unique();
            if (!existing) break;
            code = generateInviteCode();
            attempts++;
        }

        const invitationId = await ctx.db.insert("invitations", {
            code,
            churchId: args.churchId,
            type: "link",
            createdBy: user._id!,
            status: "pending",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            // Default links don't expire
        });

        // Update church with default invite code
        if (church) {
            await ctx.db.patch(church._id!, {
                defaultInviteCode: code,
                updatedAt: now.toISOString(),
            });
        }

        return {
            code,
            inviteUrl: `${process.env.SITE_URL || 'https://selah.app'}/join/${code}`,
            isNew: true,
        };
    },
});

// Get team members for a church
export const getTeamMembers = query({
    args: { churchId: v.string() },
    handler: async (ctx, args) => {
        const users = await ctx.db
            .query("users")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .collect();

        return users.map(user => ({
            _id: user._id,
            fullname: user.fullname,
            email: user.email,
            role: user.role,
            avatar: user.avatar,
            createdAt: user.createdAt,
        }));
    },
});