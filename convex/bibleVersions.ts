import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get a Bible version by ID (metadata only)
export const getBibleVersion = query({
    args: { id: v.string() },
    handler: async (ctx, args) => {
        const bibleVersion = await ctx.db
            .query("bibleVersions")
            .withIndex("by_version_id", (q) => q.eq("id", args.id))
            .first();

        return bibleVersion;
    },
});

// List all available Bible versions (metadata only).
// The Bible text itself is bundled as a static asset with the app and read
// from `/bibles/{version}.json` — the client never reads it from Convex.
export const listBibleVersions = query({
    args: {},
    handler: async (ctx) => {
        const versions = await ctx.db.query("bibleVersions").collect();

        return versions.map((v) => ({
            _id: v._id,
            id: v.id,
            name: v.name,
            copyrightContent: v.copyrightContent,
            isPublicDomain: v.isPublicDomain,
            uploadedAt: v.uploadedAt,
            uploadedBy: v.uploadedBy,
            verseCount: v.verseCount,
            hasFile: !!v.fileId,
            fileSize: v.fileSize,
        }));
    },
});

// Check if a Bible version exists
export const hasBibleVersion = query({
    args: { id: v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("bibleVersions")
            .withIndex("by_version_id", (q) => q.eq("id", args.id))
            .first();

        return !!existing;
    },
});

// Generate upload URL for Bible file. Called by the admin tool only — the
// resulting upload is cold backup in Convex storage and is not read by the
// client. Useful for restoring a bundled asset from a separate environment.
export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        return await ctx.storage.generateUploadUrl();
    },
});

// Create or update Bible version metadata after file upload
export const saveBibleVersion = mutation({
    args: {
        id: v.string(),
        name: v.string(),
        verseCount: v.number(),
        copyrightContent: v.string(),
        isPublicDomain: v.boolean(),
        uploadedBy: v.string(),
        fileId: v.id("_storage"),
        fileSize: v.number(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("bibleVersions")
            .withIndex("by_version_id", (q) => q.eq("id", args.id))
            .first();

        if (existing) {
            if (existing.fileId) {
                await ctx.storage.delete(existing.fileId);
            }

            await ctx.db.patch(existing._id, {
                name: args.name,
                verseCount: args.verseCount,
                copyrightContent: args.copyrightContent,
                isPublicDomain: args.isPublicDomain,
                fileId: args.fileId,
                fileSize: args.fileSize,
                uploadedAt: new Date().toISOString(),
                uploadedBy: args.uploadedBy,
            });

            return { success: true, action: "updated", id: args.id };
        }

        await ctx.db.insert("bibleVersions", {
            id: args.id,
            name: args.name,
            verseCount: args.verseCount,
            copyrightContent: args.copyrightContent,
            isPublicDomain: args.isPublicDomain,
            fileId: args.fileId,
            fileSize: args.fileSize,
            uploadedAt: new Date().toISOString(),
            uploadedBy: args.uploadedBy,
        });

        return { success: true, action: "created", id: args.id };
    },
});

// Delete a Bible version and its backup file (admin only)
export const deleteBibleVersion = mutation({
    args: { id: v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("bibleVersions")
            .withIndex("by_version_id", (q) => q.eq("id", args.id))
            .first();

        if (!existing) {
            return { success: false, error: "Version not found" };
        }

        if (existing.fileId) {
            await ctx.storage.delete(existing.fileId);
        }

        await ctx.db.delete(existing._id);

        return { success: true, action: "deleted", id: args.id };
    },
});
