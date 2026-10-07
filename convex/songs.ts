import { query, mutation, type QueryCtx } from "./_generated/server";
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

        const now = new Date().toISOString();
        const songId = await ctx.db.insert("songs", {
            id: `song_${Date.now()}`,
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

        await ctx.db.patch(song._id, {
            ...args.updates,
            updatedAt: new Date().toISOString(),
        });

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

        const now = new Date().toISOString();
        const results: Array<{ clientId: string; serverId: string }> = [];
        for (const { clientId, serverId, ...fields } of args.songs) {
            const existing = serverId ? await getById(ctx, "songs", serverId) : null;
            if (existing && canAccessSong(user, existing)) {
                await ctx.db.patch(existing._id, { ...fields, updatedAt: now });
                results.push({ clientId, serverId: existing._id });
                continue;
            }
            const id = await ctx.db.insert("songs", {
                id: `song_${Date.now()}`,
                ...fields,
                isPublic: false,
                createdBy: user._id!,
                churchId: user.churchId,
                createdAt: now,
                updatedAt: now,
            });
            results.push({ clientId, serverId: id });
        }
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
