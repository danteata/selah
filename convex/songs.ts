import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Get all songs for current user (fallback when no churchId)
export const getAllSongsForUser = query({
    args: {},
    handler: async (ctx) => {
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

        // Get songs created by user or in user's church
        const userSongs = await ctx.db
            .query("songs")
            .withIndex("by_creator", (q) => q.eq("createdBy", user._id))
            .take(1000);

        const churchSongs = await ctx.db
            .query("songs")
            .withIndex("by_church", (q) => q.eq("churchId", user.churchId || ''))
            .take(1000);

        // Combine and dedupe
        const allSongs = [...userSongs, ...churchSongs];
        const uniqueSongs = allSongs.filter((song, index, self) =>
            index === self.findIndex((s) => s._id === song._id)
        );

        return uniqueSongs;
    },
});

// Search songs
export const searchSongs = query({
    args: {
        churchId: v.optional(v.string()),
        query: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
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

        // Use provided churchId or fall back to user's churchId
        const churchId = args.churchId || user.churchId || '';

        // Get all songs for the church
        const allSongs = await ctx.db
            .query("songs")
            .withIndex("by_church", (q) => q.eq("churchId", churchId))
            .take(args.limit || 1000);

        // Also get songs created by the user directly
        const userSongs = await ctx.db
            .query("songs")
            .withIndex("by_creator", (q) => q.eq("createdBy", user._id))
            .take(args.limit || 1000);

        // Combine and dedupe
        const combined = [...allSongs, ...userSongs];
        const uniqueSongs = combined.filter((song, index, self) =>
            index === self.findIndex((s) => s._id === song._id)
        );

        // If no query, return all unique songs
        const searchQuery = args.query || '';
        if (searchQuery.trim() === '') {
            return uniqueSongs;
        }

        // Filter by query
        const queryLower = searchQuery.toLowerCase();
        return uniqueSongs.filter((song) =>
            song.title.toLowerCase().includes(queryLower) ||
            song.artist.toLowerCase().includes(queryLower)
        );
    },
});

// Get song by ID
export const getSong = query({
    args: {
        songId: v.string(),
    },
    handler: async (ctx, args) => {
        const song = await ctx.db
            .query("songs")
            .filter((q) => q.eq(q.field("_id"), args.songId))
            .unique();

        return song;
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
        isPublic: v.optional(v.boolean()),
        churchId: v.optional(v.string()),
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
            isPublic: args.isPublic || false,
            createdBy: user._id!,
            churchId: args.churchId || user.churchId,
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
            isPublic: v.optional(v.boolean()),
        }),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const song = await ctx.db
            .query("songs")
            .filter((q) => q.eq(q.field("_id"), args.songId))
            .unique();

        if (!song) {
            throw new Error("Song not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || (song.createdBy !== user._id && user.churchId !== song.churchId)) {
            throw new Error("Unauthorized");
        }

        await ctx.db.patch(args.songId as Id<"songs">, {
            ...args.updates,
            updatedAt: new Date().toISOString(),
        });

        return args.songId;
    },
});

// Delete song
export const deleteSong = mutation({
    args: {
        songId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const song = await ctx.db
            .query("songs")
            .filter((q) => q.eq(q.field("_id"), args.songId))
            .unique();

        if (!song) {
            throw new Error("Song not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || (song.createdBy !== user._id && user.churchId !== song.churchId)) {
            throw new Error("Unauthorized");
        }

        await ctx.db.delete(args.songId as Id<"songs">);
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
        const slides = await ctx.db
            .query("slides")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .filter((q) => q.eq(q.field("saved"), true))
            .collect();

        return slides;
    },
});
