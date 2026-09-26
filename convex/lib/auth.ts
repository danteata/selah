/**
 * Who is calling, and what they may touch.
 *
 * Every public function resolves its caller through here rather than trusting
 * an id passed in its args. Before this module each file carried its own copy
 * of the lookup, and many functions had none at all — they took `userId`,
 * `requesterId`, `churchId` or `createdBy` from the client and believed it, so
 * any signed-in (or anonymous) caller could read or rewrite another church's
 * data just by naming it.
 *
 * Plain helpers, not registered functions: they run inside the caller's
 * transaction.
 */

import type { QueryCtx } from "../_generated/server";
import type { Doc, Id, TableNames } from "../_generated/dataModel";

export type User = Doc<"users">;

/**
 * One row per person is not enforced anywhere, and an old clerkId bug left real
 * deployments with duplicates. Prefer the row carrying a church (the one other
 * tables reference), else the oldest — the same rule `upsertUser` uses when it
 * heals them, so both always land on the same row.
 */
export function pickCanonicalUser(rows: User[]): User | null {
    if (rows.length === 0) return null;
    return (
        rows.find((row) => row.churchId) ??
        [...rows].sort((a, b) => a._creationTime - b._creationTime)[0]
    );
}

/**
 * Users by email, tolerating both spellings. `upsertUser` lowercases, but the
 * just-in-time inserts in `createChurch`/`joinChurch` historically stored the
 * raw Clerk address, so a mixed-case row can exist.
 */
export async function findUsersByEmail(ctx: QueryCtx, email: string): Promise<User[]> {
    const lower = email.toLowerCase();
    const rows = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", lower))
        .take(10);
    if (lower === email) return rows;
    const raw = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .take(10);
    return [...rows, ...raw];
}

/**
 * The signed-in caller's user row, or null when there is no identity or no row
 * yet. Matches on the Clerk user id first — it survives an email change — and
 * falls back to email for rows written before clerkId was reliable.
 */
export async function getCurrentUser(ctx: QueryCtx): Promise<User | null> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const byClerkId = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
        .first();
    if (byClerkId) return byClerkId;

    if (!identity.email) return null;
    return pickCanonicalUser(await findUsersByEmail(ctx, identity.email));
}

export async function requireUser(ctx: QueryCtx): Promise<User> {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("User not found");
    return user;
}

/**
 * Whether the user belongs to this church. An empty churchId is "no church",
 * never a church of its own — otherwise every churchless user would share one
 * tenant and see each other's songs, slides and media.
 */
export function isMemberOf(user: User, churchId: string | null | undefined): boolean {
    return !!churchId && !!user.churchId && user.churchId === churchId;
}

export function isSuperadmin(user: User): boolean {
    return user.role === "superadmin";
}

/**
 * An admin of *this* church. The role is global, so checking `role === "admin"`
 * alone let the admin of any church — and anyone can become one by creating a
 * church — act on every other church.
 */
export function isChurchAdmin(user: User, churchId: string | null | undefined): boolean {
    if (isSuperadmin(user)) return true;
    return user.role === "admin" && isMemberOf(user, churchId);
}

export async function requireChurchMember(ctx: QueryCtx, churchId: string): Promise<User> {
    const user = await requireUser(ctx);
    if (!isMemberOf(user, churchId)) {
        throw new Error("Unauthorized: not a member of this church");
    }
    return user;
}

export async function requireChurchAdmin(ctx: QueryCtx, churchId: string): Promise<User> {
    const user = await requireUser(ctx);
    if (!isChurchAdmin(user, churchId)) {
        throw new Error("Only an admin of this church can do that");
    }
    return user;
}

export async function requireSuperadmin(ctx: QueryCtx): Promise<User> {
    const user = await requireUser(ctx);
    if (!isSuperadmin(user)) throw new Error("Superadmin only");
    return user;
}

/**
 * Load a document from a string id that came from the client. Many ids travel
 * as plain strings, and the old lookups matched them with
 * `.filter(q => q.eq(q.field("_id"), id))` — a full table scan per call. This
 * validates the id belongs to `table` (so a slide id can't address a user row)
 * and reads it directly.
 */
export async function getById<T extends TableNames>(
    ctx: QueryCtx,
    table: T,
    id: string | null | undefined,
): Promise<Doc<T> | null> {
    if (!id) return null;
    const normalized = ctx.db.normalizeId(table, id);
    if (!normalized) return null;
    return (await ctx.db.get(normalized as Id<T>)) as Doc<T> | null;
}
