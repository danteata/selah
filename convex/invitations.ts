import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getById, getCurrentUser, isChurchAdmin, isMemberOf, isSuperadmin, requireChurchAdmin } from "./lib/auth";
import { generateUniqueInviteCode, inviteUrl, redeemInvitation } from "./lib/invites";

const DAY_MS = 24 * 60 * 60 * 1000;

function expiryFromDays(now: Date, days: number | undefined): string | undefined {
    if (!days || days <= 0) return undefined;
    return new Date(now.getTime() + days * DAY_MS).toISOString();
}

// Get all invitations for a church (admin only)
export const getInvitations = query({
    args: { churchId: v.string() },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user || !isChurchAdmin(user, args.churchId)) return [];

        return await ctx.db
            .query("invitations")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .order("desc")
            .take(500);
    },
});

// Look up an invitation by its code, for the join page. Deliberately open to
// anonymous callers — knowing the code is what grants access — but it returns
// only what the join screen shows, not who sent it or who else accepted it.
export const getInvitationByCode = query({
    args: { code: v.string() },
    handler: async (ctx, args) => {
        const invitation = await ctx.db
            .query("invitations")
            .withIndex("by_code", (q) => q.eq("code", args.code.trim().toUpperCase()))
            .first();
        if (!invitation) return null;

        const church = await getById(ctx, "churches", invitation.churchId);
        if (!church) return null;

        const isExpired = !!invitation.expiresAt && new Date(invitation.expiresAt) < new Date();
        const status = isExpired ? "expired" : invitation.status;

        return {
            invitation: {
                _id: invitation._id,
                code: invitation.code,
                type: invitation.type,
                email: invitation.email,
                message: invitation.message,
                expiresAt: invitation.expiresAt,
                status,
            },
            church: {
                _id: church._id,
                name: church.name,
                type: church.type,
            },
            isValid: status === "pending",
        };
    },
});

// Get pending invitations for current user (by email)
export const getMyInvitations = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity?.email) return [];

        const invitations = await ctx.db
            .query("invitations")
            .withIndex("by_email", (q) => q.eq("email", identity.email!.toLowerCase()))
            .filter((q) => q.eq(q.field("status"), "pending"))
            .take(50);

        const now = new Date();
        const valid = invitations.filter((inv) => !inv.expiresAt || new Date(inv.expiresAt) >= now);

        return await Promise.all(
            valid.map(async (inv) => {
                const church = await getById(ctx, "churches", inv.churchId);
                return { ...inv, churchName: church?.name || "Unknown Church" };
            })
        );
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
        const user = await requireChurchAdmin(ctx, args.churchId);

        const now = new Date();
        const code = await generateUniqueInviteCode(ctx);

        const invitationId = await ctx.db.insert("invitations", {
            code,
            churchId: args.churchId,
            type: "link",
            createdBy: user._id,
            status: "pending",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            expiresAt: expiryFromDays(now, args.expiresInDays),
            message: args.message,
        });

        return { id: invitationId, code, inviteUrl: inviteUrl(code) };
    },
});

// Create an email invitation and send the email.
export const sendEmailInvitation = mutation({
    args: {
        churchId: v.string(),
        email: v.string(),
        message: v.optional(v.string()),
        expiresInDays: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const user = await requireChurchAdmin(ctx, args.churchId);

        const normalizedEmail = args.email.toLowerCase().trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            throw new Error("Please enter a valid email address");
        }

        // An address may hold pending invitations from several churches, so
        // this is a scan of that address's rows, not a `.unique()` — which
        // threw for everyone once a second church invited the same person.
        const pendingForEmail = await ctx.db
            .query("invitations")
            .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
            .filter((q) => q.eq(q.field("status"), "pending"))
            .take(50);
        if (pendingForEmail.some((inv) => inv.churchId === args.churchId)) {
            throw new Error("This email already has a pending invitation to your church");
        }

        const alreadyMember = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
            .take(10);
        if (alreadyMember.some((member) => member.churchId === args.churchId)) {
            throw new Error("This user is already a member of your church");
        }

        const now = new Date();
        const expiresAt = expiryFromDays(now, args.expiresInDays ?? 7);
        const code = await generateUniqueInviteCode(ctx);
        const church = await getById(ctx, "churches", args.churchId);
        const churchName = church?.name || "your church";
        const url = inviteUrl(code);

        const invitationId = await ctx.db.insert("invitations", {
            code,
            churchId: args.churchId,
            type: "email",
            email: normalizedEmail,
            createdBy: user._id,
            status: "pending",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            expiresAt,
            message: args.message,
        });

        // Sent from the server with values it derived itself; see emails.ts.
        await ctx.scheduler.runAfter(0, internal.emails.sendInviteEmail, {
            to: normalizedEmail,
            churchName,
            inviterName: user.fullname,
            inviteUrl: url,
            message: args.message,
            expiresAt,
        });

        return {
            id: invitationId,
            code,
            inviteUrl: url,
            email: normalizedEmail,
            churchName,
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
        const { invitation, church } = await redeemInvitation(ctx, args.code);
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
        const invitation = await getById(ctx, "invitations", args.invitationId);
        if (!invitation) throw new Error("Invitation not found");
        await requireChurchAdmin(ctx, invitation.churchId);

        if (invitation.status !== "pending") {
            throw new Error("Only pending invitations can be revoked");
        }

        await ctx.db.patch(invitation._id, {
            status: "revoked",
            updatedAt: new Date().toISOString(),
        });

        return { success: true };
    },
});

// Give an invitation a fresh code, invalidating the old one (e.g. a link that
// was shared too widely).
export const regenerateInviteCode = mutation({
    args: {
        invitationId: v.string(),
    },
    handler: async (ctx, args) => {
        const invitation = await getById(ctx, "invitations", args.invitationId);
        if (!invitation) throw new Error("Invitation not found");
        await requireChurchAdmin(ctx, invitation.churchId);

        // Reviving an expired invitation is the point; reviving a used or
        // revoked one would reopen a door someone deliberately closed.
        if (invitation.status === "accepted" || invitation.status === "revoked") {
            throw new Error("This invitation can no longer be renewed; create a new one instead");
        }

        const code = await generateUniqueInviteCode(ctx);
        await ctx.db.patch(invitation._id, {
            code,
            status: "pending",
            updatedAt: new Date().toISOString(),
        });

        const church = await getById(ctx, "churches", invitation.churchId);
        if (church && church.defaultInviteCode === invitation.code) {
            await ctx.db.patch(church._id, { defaultInviteCode: code });
        }

        return { code, inviteUrl: inviteUrl(code) };
    },
});

// Get or create default invite link for a church
export const getOrCreateDefaultInviteLink = mutation({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireChurchAdmin(ctx, args.churchId);
        const church = await getById(ctx, "churches", args.churchId);
        if (!church) throw new Error("Church not found");

        if (church.defaultInviteCode) {
            const existingInvite = await ctx.db
                .query("invitations")
                .withIndex("by_code", (q) => q.eq("code", church.defaultInviteCode!))
                .first();
            if (existingInvite && existingInvite.status === "pending") {
                return { code: existingInvite.code, inviteUrl: inviteUrl(existingInvite.code), isNew: false };
            }
        }

        const now = new Date().toISOString();
        const code = await generateUniqueInviteCode(ctx);
        await ctx.db.insert("invitations", {
            code,
            churchId: args.churchId,
            type: "link",
            createdBy: user._id,
            status: "pending",
            createdAt: now,
            updatedAt: now,
            // Default links don't expire
        });
        await ctx.db.patch(church._id, { defaultInviteCode: code, updatedAt: now });

        return { code, inviteUrl: inviteUrl(code), isNew: true };
    },
});

// Get team members for a church (members of that church only)
export const getTeamMembers = query({
    args: { churchId: v.string() },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user || (!isMemberOf(user, args.churchId) && !isSuperadmin(user))) return [];

        const users = await ctx.db
            .query("users")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .take(500);

        return users.map((member) => ({
            _id: member._id,
            fullname: member.fullname,
            email: member.email,
            role: member.role,
            avatar: member.avatar,
            createdAt: member.createdAt,
        }));
    },
});
