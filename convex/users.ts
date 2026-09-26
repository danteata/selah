import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { maybeStartTrial } from "./licensing";
import {
    findUsersByEmail,
    getById,
    getCurrentUser as getCurrentUserRow,
    pickCanonicalUser,
    requireSuperadmin,
} from "./lib/auth";

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

// The signed-in caller's own row.
//
// `clerkId` is still accepted so desktop builds already in the field keep
// validating, but it is ignored: the row is resolved from the verified
// identity. Taking it on trust returned anyone's row — email, role, church —
// to anyone who could name their Clerk id.
export const getCurrentUser = query({
    args: { clerkId: v.optional(v.string()) },
    handler: async (ctx) => {
        return await getCurrentUserRow(ctx);
    },
});

// Create or update the signed-in caller's row.
//
// Identity comes from the verified token, never from args. The args are kept
// (older desktop builds still send them) but only the display fields are used:
// taking `clerkId` and `email` on trust let an anonymous caller adopt any
// user's row by email and re-point it at their own Clerk id, and `churchId`
// moved any row into any church. Joining a church goes through an invitation.
export const upsertUser = mutation({
    args: {
        clerkId: v.optional(v.string()),
        fullname: v.string(),
        email: v.optional(v.string()),
        avatar: v.optional(v.string()),
        churchId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        // Sign-in flows call this the moment Clerk's session activates, which
        // can beat the Convex token by a tick. Not an error: `useSyncCurrentUser`
        // repeats the call once Convex is authenticated.
        if (!identity) return null;
        if (!identity.email) throw new Error("Your account has no email address");

        // Emails are matched lowercased everywhere downstream (see
        // `licensing.maybeStartTrial`), so normalise on the way in — a
        // mixed-case address from Clerk would otherwise miss `by_email`
        // entirely and read as a brand-new person.
        const email = identity.email.toLowerCase();
        const clerkId = identity.subject;

        let existingUser = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
            .first();

        // Fall back to email before concluding this is someone new.
        //
        // Matching on clerkId alone is what produced duplicate rows in the
        // first place: an early bug wrote Clerk *session* ids (`sess_…`) into
        // `clerkId`, and those rotate on every sign-in, so the next login
        // missed and inserted a second row for the same person. Adopting the
        // row by email and correcting its clerkId means such a row heals itself
        // on the next sign-in instead of forking.
        //
        // Safe because the email is the verified one from the token, and Clerk
        // enforces one account per email within an instance.
        if (!existingUser) {
            existingUser = pickCanonicalUser(await findUsersByEmail(ctx, email));
            if (existingUser) {
                console.warn(
                    `[users] adopting ${existingUser._id} for ${email}: ` +
                        `clerkId ${existingUser.clerkId ?? "(none)"} -> ${clerkId}`
                );
            }
        }

        const now = new Date().toISOString();

        if (existingUser) {
            // `clerkId` is written unconditionally so an adopted row converges
            // on the real Clerk user id.
            await ctx.db.patch(existingUser._id, {
                clerkId,
                fullname: args.fullname || existingUser.fullname,
                email,
                avatar: args.avatar || existingUser.avatar,
                updatedAt: now,
            });
            // Start the free trial on first sign-in (no-op if they already have
            // a subscription row — trial, comp, or paid).
            await maybeStartTrial(ctx, { email, userId: existingUser._id });
            return existingUser._id;
        }

        // The very first account on a deployment becomes its superadmin.
        const anyUser = await ctx.db.query("users").first();
        const role: UserRole = anyUser ? "member" : "superadmin";

        const userId = await ctx.db.insert("users", {
            clerkId,
            fullname: args.fullname || email.split("@")[0],
            email,
            role,
            avatar: args.avatar || "",
            theme: "light",
            churchId: "",
            createdAt: now,
            updatedAt: now,
        });
        // Every brand-new account starts a 14-day Pro trial.
        await maybeStartTrial(ctx, { email, userId });
        return userId;
    },
});

// Move the signed-in superadmin into another church (the church switcher).
//
// Only ever acts on the caller: `userId` is accepted for older clients but must
// be the caller's own id. This used to patch any user into any church with no
// auth at all — the one call that turned every `churchId` check in the backend
// into a formality.
export const updateUserChurch = mutation({
    args: {
        userId: v.optional(v.id("users")),
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireSuperadmin(ctx);
        if (args.userId && args.userId !== user._id) {
            throw new Error("You can only switch your own church");
        }

        const church = await getById(ctx, "churches", args.churchId);
        if (!church) throw new Error("Church not found");

        await ctx.db.patch(user._id, {
            churchId: church._id,
            updatedAt: new Date().toISOString(),
        });
        return user._id;
    },
});
