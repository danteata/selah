/**
 * Migration Mutations for EasyWorship Import
 * 
 * Provides batch import functionality for songs from EasyWorship exports.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Batch size for imports (to avoid timeout)
const BATCH_SIZE = 50;

/**
 * Import a batch of songs
 */
export const importSongsBatch = mutation({
    args: {
        songs: v.array(v.object({
            title: v.string(),
            artist: v.string(),
            lyrics: v.string(),
            verses: v.array(v.string()),
            author: v.optional(v.string()),
            copyright: v.optional(v.string()),
            ccli: v.optional(v.string()),
        })),
        churchId: v.string(),
        createdBy: v.string(),
    },
    handler: async (ctx, args) => {
        const now = new Date().toISOString();
        const errors: string[] = [];
        const importedIds: string[] = [];
        let success = 0;
        let failed = 0;

        for (const song of args.songs) {
            try {
                // Validate required fields
                if (!song.title || !song.title.trim()) {
                    errors.push(`Song missing title: ${song.artist || 'Unknown'}`);
                    failed++;
                    continue;
                }

                // Create the song
                const songId = await ctx.db.insert("songs", {
                    id: `song_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    title: song.title.trim(),
                    artist: song.artist || 'Unknown',
                    lyrics: song.lyrics || '',
                    verses: song.verses || [],
                    author: song.author,
                    copyright: song.copyright,
                    ccli: song.ccli,
                    churchId: args.churchId,
                    createdBy: args.createdBy,
                    createdAt: now,
                    updatedAt: now,
                });

                importedIds.push(songId);
                success++;
            } catch (error) {
                errors.push(`Failed to import "${song.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
                failed++;
            }
        }

        return { success, failed, errors, importedIds };
    },
});

/**
 * Check for potential duplicate songs by title
 */
export const checkDuplicateSongs = query({
    args: {
        titles: v.array(v.string()),
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const duplicates: { importTitle: string; existingId: string; existingTitle: string }[] = [];

        // Get all existing songs for the church
        const existingSongs = await ctx.db
            .query("songs")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .collect();

        // Create a map for quick lookup (case-insensitive)
        const existingMap = new Map<string, { id: string; title: string }>();
        existingSongs.forEach(song => {
            const normalizedTitle = song.title.toLowerCase().trim();
            existingMap.set(normalizedTitle, { id: song._id, title: song.title });
        });

        // Check each import title
        for (const title of args.titles) {
            const normalizedTitle = title.toLowerCase().trim();
            const existing = existingMap.get(normalizedTitle);

            if (existing) {
                duplicates.push({
                    importTitle: title,
                    existingId: existing.id,
                    existingTitle: existing.title,
                });
            }
        }

        return duplicates;
    },
});

/**
 * Get all song titles for a church (for duplicate checking)
 */
export const getSongTitles = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const songs = await ctx.db
            .query("songs")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .collect();

        return songs.map(song => ({
            id: song._id,
            title: song.title,
            artist: song.artist,
        }));
    },
});

/**
 * Delete songs that were imported in a specific batch (for rollback)
 */
export const deleteImportedSongs = mutation({
    args: {
        songIds: v.array(v.string()),
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        let deleted = 0;

        for (const songId of args.songIds) {
            try {
                await ctx.db.delete(songId as any);
                deleted++;
            } catch (error) {
                console.error(`Failed to delete song ${songId}:`, error);
            }
        }

        return { deleted };
    },
});

/**
 * Get migration statistics for a church
 */
export const getMigrationStats = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const songs = await ctx.db
            .query("songs")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .collect();

        return {
            totalSongs: songs.length,
            songsWithLyrics: songs.filter(s => s.lyrics && s.lyrics.trim()).length,
            songsWithVerses: songs.filter(s => s.verses && s.verses.length > 0).length,
            songsWithAuthor: songs.filter(s => s.author).length,
            recentImports: songs
                .filter(s => {
                    const created = new Date(s.createdAt || '');
                    const weekAgo = new Date();
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    return created > weekAgo;
                })
                .length,
        };
    },
});

/**
 * Update an existing song (for fixing duplicates)
 */
export const updateImportedSong = mutation({
    args: {
        songId: v.string(),
        updates: v.object({
            title: v.optional(v.string()),
            artist: v.optional(v.string()),
            lyrics: v.optional(v.string()),
            verses: v.optional(v.array(v.string())),
            author: v.optional(v.string()),
            copyright: v.optional(v.string()),
            ccli: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        const song = await ctx.db.get(args.songId as any);

        if (!song) {
            throw new Error("Song not found");
        }

        await ctx.db.patch(args.songId as any, {
            ...args.updates,
            updatedAt: new Date().toISOString(),
        });

        return { success: true };
    },
});