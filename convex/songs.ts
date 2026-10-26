import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { songSectionValidator } from "./schema";
import { getById, getCurrentUser, isMemberOf, requireUser, type User } from "./lib/auth";
import type { Doc } from "./_generated/dataModel";

/** Songs a user may read and change: their own, and their church's. */
function canAccessSong(user: User, song: Doc<"songs">): boolean {
    return song.createdBy === user._id || isMemberOf(user, song.churchId);
}

async function requireOwnSong(ctx: QueryCtx, songId: string) {
    const user = await requireUser(ctx);
    const song = await getById(ctx, "songs", songId);
    if (!song) throw new Error("Song not found");
    if (!canAccessSong(user, song)) throw new Error("Unauthorized");
    return { user, song };
}

/**
 * The caller's own songs plus their church's, deduplicated. An empty churchId
 * means "no church", not a church of its own: querying `by_church` for "" used
 * to hand every churchless user every other churchless user's songs.
 */
async function songsVisibleTo(ctx: QueryCtx, user: User, limit: number) {
    const own = await ctx.db
        .query("songs")
        .withIndex("by_creator", (q) => q.eq("createdBy", user._id))
        .take(limit);
    const church = user.churchId
        ? await ctx.db
            .query("songs")
            .withIndex("by_church", (q) => q.eq("churchId", user.churchId))
            .take(limit)
        : [];
    const seen = new Set<string>();
    return [...church, ...own].filter((song) => {
        if (seen.has(song._id)) return false;
        seen.add(song._id);
        return true;
    });
}

/**
 * The caller's songs changed since `since` (an ISO time): through the
 * `updatedAt` indexes, so a library that hasn't changed costs no song reads.
 */
async function songsChangedSince(ctx: QueryCtx, user: User, since: string, limit: number) {
    const own = await ctx.db
        .query("songs")
        .withIndex("by_creator_and_updatedAt", (q) => q.eq("createdBy", user._id).gt("updatedAt", since))
        .take(limit);
    const church = user.churchId
        ? await ctx.db
            .query("songs")
            .withIndex("by_church_and_updatedAt", (q) => q.eq("churchId", user.churchId).gt("updatedAt", since))
            .take(limit)
        : [];
    const seen = new Set<string>();
    return [...church, ...own].filter((song) => {
        if (seen.has(song._id)) return false;
        seen.add(song._id);
        return true;
    });
}

async function libraryVersion(ctx: QueryCtx, scope: string) {
    return await ctx.db
        .query("songLibraryVersions")
        .withIndex("by_scope", (q) => q.eq("scope", scope))
        .unique();
}

/**
 * Note a write to these songs on their libraries' counters: their church's,
 * and their creator's (see `songLibraryVersions` in the schema). Every
 * mutation that writes a song calls this, in the same transaction.
 */
async function bumpLibraryVersions(
    ctx: MutationCtx,
    songs: Array<{ churchId?: string; createdBy?: string }>,
    change: { now: number; deleted?: boolean },
) {
    const scopes = new Set<string>();
    for (const song of songs) {
        if (song.churchId) scopes.add(song.churchId);
        if (song.createdBy) scopes.add(song.createdBy);
    }
    for (const scope of scopes) {
        const row = await libraryVersion(ctx, scope);
        const version = (row?.version ?? 0) + 1;
        const fields = {
            version,
            changedAt: Math.max(row?.changedAt ?? 0, change.now),
            ...(change.deleted ? { lastDeleteVersion: version } : {}),
        };
        if (row) await ctx.db.patch(row._id, fields);
        else await ctx.db.insert("songLibraryVersions", { scope, ...fields });
    }
}

/** Most songs `syncLibrary` returns, as `searchSongs` allows. */
const LIBRARY_LIMIT = 5000;

/**
 * How far before the last change a device asks for changes from. A song's
 * `updatedAt` is when its mutation started, which can be a moment before a
 * mutation that committed first; the overlap catches it, at the cost of
 * sending a few songs the device already has.
 */
const CHANGE_OVERLAP_MS = 5 * 60 * 1000;

/** Where a device's copy of the library stands; `syncLibrary` hands back a new one each time. */
const libraryCursorValidator = v.object({
    /** Whose library it is: the user and their church. Either changing means a different set of songs. */
    scope: v.string(),
    /** The church's and the user's counters when the device last synced. */
    church: v.number(),
    own: v.number(),
    /** The later of their `changedAt`s. */
    changedAt: v.number(),
});

/**
 * Bring a device's copy of the caller's song library up to date. Given the
 * cursor from its last sync, answers with as little as will do:
 *
 *  - `unchanged`: nothing was written since; no songs are read at all.
 *  - `changes`: only the songs created or edited since.
 *  - `full`: every song, when the device has no copy yet, the caller's church
 *    changed, or a song was deleted since (what's gone can't be told from the
 *    songs that are left).
 *
 * This replaces fetching the whole library (`searchSongs`) on every refresh,
 * which read every song with its lyrics each time a device opened, came back
 * online or regained focus — most of the deployment's database reads.
 * `searchSongs` stays for older clients.
 */
export const syncLibrary = query({
    args: { cursor: v.optional(libraryCursorValidator) },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) return null;

        const church = user.churchId ? await libraryVersion(ctx, user.churchId) : null;
        const own = await libraryVersion(ctx, user._id);
        const cursor = {
            scope: `${user._id}:${user.churchId}`,
            church: church?.version ?? 0,
            own: own?.version ?? 0,
            changedAt: Math.max(church?.changedAt ?? 0, own?.changedAt ?? 0),
        };

        const last = args.cursor;
        if (last && last.scope === cursor.scope && last.church === cursor.church && last.own === cursor.own) {
            return { kind: "unchanged" as const, cursor };
        }

        const canCatchUp = !!last
            && last.scope === cursor.scope
            // Zero: the device synced before any counter existed, so there's
            // no time to ask for changes from.
            && last.changedAt > 0
            && last.church <= cursor.church
            && last.own <= cursor.own
            && (church?.lastDeleteVersion ?? 0) <= last.church
            && (own?.lastDeleteVersion ?? 0) <= last.own;
        if (!canCatchUp) {
            return { kind: "full" as const, songs: await songsVisibleTo(ctx, user, LIBRARY_LIMIT), cursor };
        }

        const since = new Date(last.changedAt - CHANGE_OVERLAP_MS).toISOString();
        return { kind: "changes" as const, songs: await songsChangedSince(ctx, user, since, LIBRARY_LIMIT), cursor };
    },
});

// Get all songs for current user (fallback when no churchId)
export const getAllSongsForUser = query({
    args: {},
    handler: async (ctx) => {
        const user = await getCurrentUser(ctx);
        if (!user) return [];
        return await songsVisibleTo(ctx, user, 1000);
    },
});

// Search songs
export const searchSongs = query({
    args: {
        // Accepted for older clients; the caller's own church is always used.
        churchId: v.optional(v.string()),
        query: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) return [];

        const songs = await songsVisibleTo(ctx, user, Math.min(args.limit || 1000, 5000));

        const searchQuery = (args.query || '').trim().toLowerCase();
        if (!searchQuery) return songs;

        return songs.filter((song) =>
            song.title.toLowerCase().includes(searchQuery) ||
            song.artist.toLowerCase().includes(searchQuery)
        );
    },
});

// Get song by ID
export const getSong = query({
    args: {
        songId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) return null;
        const song = await getById(ctx, "songs", args.songId);
        return song && canAccessSong(user, song) ? song : null;
    },
});

// Create song
export const createSong = mutation({
    args: {
        title: v.string(),
        artist: v.string(),
        lyrics: v.string(),
        album: v.optional(v.string()),
        cover: v.optional(v.string()),
        author: v.optional(v.string()),
        verses: v.optional(v.array(v.string())),
        sections: v.optional(v.array(songSectionValidator)),
        defaultArrangement: v.optional(v.array(v.string())),
        isPublic: v.optional(v.boolean()),
        // Accepted for older clients; a song always lands in the caller's own
        // church. Honouring it let anyone write songs into any church.
        churchId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        const songId = await ctx.db.insert("songs", {
            id: `song_${nowMs}`,
            lyrics: args.lyrics,
            title: args.title,
            artist: args.artist,
            album: args.album,
            cover: args.cover,
            author: args.author,
            verses: args.verses,
            sections: args.sections,
            defaultArrangement: args.defaultArrangement,
            isPublic: args.isPublic || false,
            createdBy: user._id!,
            churchId: user.churchId,
            createdAt: now,
            updatedAt: now,
        });
        await bumpLibraryVersions(ctx, [{ churchId: user.churchId, createdBy: user._id }], { now: nowMs });

        return songId;
    },
});

// Update song
export const updateSong = mutation({
    args: {
        songId: v.string(),
        updates: v.object({
            title: v.optional(v.string()),
            artist: v.optional(v.string()),
            lyrics: v.optional(v.string()),
            album: v.optional(v.string()),
            cover: v.optional(v.string()),
            author: v.optional(v.string()),
            verses: v.optional(v.array(v.string())),
            sections: v.optional(v.array(songSectionValidator)),
            defaultArrangement: v.optional(v.array(v.string())),
            isPublic: v.optional(v.boolean()),
        }),
    },
    handler: async (ctx, args) => {
        const { song } = await requireOwnSong(ctx, args.songId);

        const now = Date.now();
        await ctx.db.patch(song._id, {
            ...args.updates,
            updatedAt: new Date(now).toISOString(),
        });
        await bumpLibraryVersions(ctx, [song], { now });

        return args.songId;
    },
});

/** Most songs one `syncSongs` call takes. */
export const SYNC_BATCH_LIMIT = 50;

const syncedSongValidator = v.object({
    /** The id the song has on the device, echoed back to pair the result. */
    clientId: v.string(),
    /** The server song this one is (or was matched by title to), if any. */
    serverId: v.optional(v.string()),
    title: v.string(),
    artist: v.string(),
    lyrics: v.string(),
    author: v.optional(v.string()),
    verses: v.optional(v.array(v.string())),
    sections: v.optional(v.array(songSectionValidator)),
    defaultArrangement: v.optional(v.array(v.string())),
    copyright: v.optional(v.string()),
    ccli: v.optional(v.string()),
});

/**
 * Upload songs saved on a device (an import, or offline edits) in one
 * transaction. A song with a `serverId` the caller can access is updated in
 * place; any other is created in the caller's church. Returns each song's
 * server id, so the device can link its copy to it.
 *
 * Batched because the per-song path cost a write and, worse, a re-run of every
 * subscriber to the song list per song: one import of a few hundred songs
 * re-sent the whole library hundreds of times.
 */
export const syncSongs = mutation({
    args: { songs: v.array(syncedSongValidator) },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);
        if (args.songs.length > SYNC_BATCH_LIMIT) {
            throw new Error(`At most ${SYNC_BATCH_LIMIT} songs per sync`);
        }

        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        const results: Array<{ clientId: string; serverId: string }> = [];
        const written: Array<{ churchId?: string; createdBy?: string }> = [];
        for (const { clientId, serverId, ...fields } of args.songs) {
            const existing = serverId ? await getById(ctx, "songs", serverId) : null;
            if (existing && canAccessSong(user, existing)) {
                await ctx.db.patch(existing._id, { ...fields, updatedAt: now });
                results.push({ clientId, serverId: existing._id });
                written.push(existing);
                continue;
            }
            const id = await ctx.db.insert("songs", {
                id: `song_${nowMs}`,
                ...fields,
                isPublic: false,
                createdBy: user._id!,
                churchId: user.churchId,
                createdAt: now,
                updatedAt: now,
            });
            results.push({ clientId, serverId: id });
            written.push({ churchId: user.churchId, createdBy: user._id });
        }
        await bumpLibraryVersions(ctx, written, { now: nowMs });
        return results;
    },
});

// Delete song
export const deleteSong = mutation({
    args: {
        songId: v.string(),
    },
    handler: async (ctx, args) => {
        const { song } = await requireOwnSong(ctx, args.songId);

        await ctx.db.delete(song._id);
        await bumpLibraryVersions(ctx, [song], { now: Date.now(), deleted: true });
        return true;
    },
});

// Get saved slides (library)
export const getSavedSlides = query({
    args: {
        churchId: v.string(),
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user || !isMemberOf(user, args.churchId)) return [];

        return await ctx.db
            .query("slides")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .filter((q) => q.eq(q.field("saved"), true))
            .take(1000);
    },
});
