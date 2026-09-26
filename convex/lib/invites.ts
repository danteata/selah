/**
 * Invite codes and joining a church through one.
 *
 * `churches.joinChurch` and `invitations.acceptInvitation` are the same act
 * reached from two screens; they used to be two copies of this logic that had
 * already begun to drift.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { assertTeamMemberLimit } from "../entitlements";
import { findUsersByEmail, getById, getCurrentUser, pickCanonicalUser, type User } from "./auth";

// No I, O, 0 or 1 — they get misread when a code is typed from a projector.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A random invite code formatted XXXX-XXXX-XXXX. Uses the platform CSPRNG: a
 * code is a bearer credential for joining a church, and `Math.random()` is
 * predictable.
 */
function randomInviteCode(): string {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    // 256 is a multiple of 32, so the modulo carries no bias.
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

export async function generateUniqueInviteCode(ctx: QueryCtx): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomInviteCode();
        const taken = await ctx.db
            .query("invitations")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first();
        if (!taken) return code;
    }
    throw new Error("Could not generate a unique invite code; please try again");
}

export function inviteUrl(code: string): string {
    // Hash route: the web app runs on HashRouter, so a bare `/join/...` path
    // lands on the home page instead of the join screen.
    return `${process.env.SITE_URL || "https://selah.fly.dev"}/#/join/${code}`;
}

/**
 * The caller's user row, creating it from the verified identity if this is
 * their first call. Joining or founding a church can be the first thing a new
 * account does, before `upsertUser` has landed.
 */
export async function getOrCreateUserFromIdentity(ctx: MutationCtx): Promise<User> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const existing = await getCurrentUser(ctx);
    if (existing) return existing;
    if (!identity.email) throw new Error("Your account has no email address");

    const email = identity.email.toLowerCase();
    // getCurrentUser already fell back to email, but be explicit: never insert
    // a second row for an address that has one.
    const byEmail = pickCanonicalUser(await findUsersByEmail(ctx, email));
    if (byEmail) return byEmail;

    const now = new Date().toISOString();
    const userId = await ctx.db.insert("users", {
        email,
        fullname:
            identity.givenName && identity.familyName
                ? `${identity.givenName} ${identity.familyName}`
                : email.split("@")[0],
        avatar: identity.pictureUrl || "",
        theme: "light",
        role: "member",
        churchId: "",
        clerkId: identity.subject,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
    });
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Failed to create user");
    return user;
}

/**
 * Validate an invitation and add the caller to its church.
 *
 * Email invitations are single-use and addressed to one person. Link
 * invitations — including the church's persistent default link — are shared
 * with the whole team, so they stay valid until revoked or expired. They used
 * to be marked `accepted` by the first joiner, which silently killed the
 * default link after one person used it.
 */
export async function redeemInvitation(
    ctx: MutationCtx,
    code: string,
): Promise<{ user: User; church: Doc<"churches"> | null; invitation: Doc<"invitations"> }> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const invitation = await ctx.db
        .query("invitations")
        .withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase()))
        .first();
    if (!invitation) throw new Error("Invalid invite code");

    if (invitation.status === "accepted") throw new Error("This invitation has already been used");
    if (invitation.status === "revoked") throw new Error("This invitation has been revoked");
    if (invitation.status === "expired") throw new Error("This invitation has expired");

    const now = new Date();
    const nowIso = now.toISOString();
    if (invitation.expiresAt && new Date(invitation.expiresAt) < now) {
        await ctx.db.patch(invitation._id, { status: "expired", updatedAt: nowIso });
        throw new Error("This invitation has expired");
    }

    if (invitation.type === "email" && invitation.email) {
        if (identity.email?.toLowerCase() !== invitation.email.toLowerCase()) {
            throw new Error("This invitation was sent to a different email address");
        }
    }

    const church = await getById(ctx, "churches", invitation.churchId);
    if (!church) throw new Error("The church for this invitation no longer exists");

    const user = await getOrCreateUserFromIdentity(ctx);
    if (user.churchId === invitation.churchId) {
        throw new Error("You are already a member of this church");
    }
    if (user.churchId) {
        throw new Error(
            "You are already a member of another church. Please leave your current church before joining a new one."
        );
    }

    // Enforce the church's plan team-size cap before adding a NEW member.
    await assertTeamMemberLimit(ctx, invitation.churchId);

    await ctx.db.patch(user._id, { churchId: invitation.churchId, updatedAt: nowIso });

    const userIds = church.userIds || [];
    if (!userIds.includes(user._id)) {
        await ctx.db.patch(church._id, { userIds: [...userIds, user._id], updatedAt: nowIso });
    }

    if (invitation.type === "email") {
        await ctx.db.patch(invitation._id, {
            status: "accepted",
            acceptedBy: user._id,
            acceptedAt: nowIso,
            updatedAt: nowIso,
        });
    }

    return { user: { ...user, churchId: invitation.churchId }, church, invitation };
}
