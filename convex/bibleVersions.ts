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

// Get the file URL for a Bible version (for downloading the full text)
export const getBibleFileUrl = query({
    args: { versionId: v.string() },
    handler: async (ctx, args) => {
        const bibleVersion = await ctx.db
            .query("bibleVersions")
            .withIndex("by_version_id", (q) => q.eq("id", args.versionId))
            .first();

        if (!bibleVersion?.fileId) {
            return null;
        }

        // Get the file URL from Convex storage
        const url = await ctx.storage.getUrl(bibleVersion.fileId);

        return {
            url,
            fileId: bibleVersion.fileId,
            fileSize: bibleVersion.fileSize,
            versionId: bibleVersion.id,
            versionName: bibleVersion.name,
        };
    },
});

// List all available Bible versions (metadata only)
export const listBibleVersions = query({
    args: {},
    handler: async (ctx) => {
        const versions = await ctx.db.query("bibleVersions").collect();

        // Return metadata only
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

// Generate upload URL for Bible file (call this before uploading)
export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        // Generate a URL that the client can use to upload a file
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
        fileId: v.id("_storage"), // The ID returned from storage.upload()
        fileSize: v.number(),
    },
    handler: async (ctx, args) => {
        // Check if version already exists
        const existing = await ctx.db
            .query("bibleVersions")
            .withIndex("by_version_id", (q) => q.eq("id", args.id))
            .first();

        if (existing) {
            // Delete old file if it exists
            if (existing.fileId) {
                await ctx.storage.delete(existing.fileId);
            }

            // Update existing version
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

        // Create new version
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

// Delete a Bible version and its file (admin only)
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

        // Delete the file from storage
        if (existing.fileId) {
            await ctx.storage.delete(existing.fileId);
        }

        // Delete the metadata record
        await ctx.db.delete(existing._id);

        return { success: true, action: "deleted", id: args.id };
    },
});

// Get Bible verse data for scripture lookup
// Note: This requires the client to have the Bible data cached locally
// The actual verse filtering happens client-side after fetching the file
export const getScripture = query({
    args: {
        versionId: v.string(),
        book: v.number(),
        chapter: v.number(),
        verseStart: v.number(),
        verseEnd: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const bibleVersion = await ctx.db
            .query("bibleVersions")
            .withIndex("by_version_id", (q) => q.eq("id", args.versionId))
            .first();

        if (!bibleVersion) {
            return null;
        }

        // Return the file URL so client can fetch and filter
        // The client should cache this data locally
        const fileUrl = bibleVersion.fileId
            ? await ctx.storage.getUrl(bibleVersion.fileId)
            : null;

        return {
            version: args.versionId,
            versionName: bibleVersion.name,
            copyrightContent: bibleVersion.copyrightContent,
            fileUrl,
            // Include lookup parameters for client-side filtering
            lookup: {
                book: args.book,
                chapter: args.chapter,
                verseStart: args.verseStart,
                verseEnd: args.verseEnd ?? args.verseStart,
            },
        };
    },
});
