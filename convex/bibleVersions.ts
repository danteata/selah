import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get a Bible version by ID
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

// List all available Bible versions (metadata only, without full data)
export const listBibleVersions = query({
    args: {},
    handler: async (ctx) => {
        const versions = await ctx.db.query("bibleVersions").collect();

        // Return metadata only (without the full data array to reduce payload)
        return versions.map((v) => ({
            _id: v._id,
            id: v.id,
            name: v.name,
            copyrightContent: v.copyrightContent,
            isPublicDomain: v.isPublicDomain,
            uploadedAt: v.uploadedAt,
            uploadedBy: v.uploadedBy,
            verseCount: v.data.length,
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

// Upload a new Bible version (admin only)
export const uploadBibleVersion = mutation({
    args: {
        id: v.string(),
        name: v.string(),
        data: v.array(v.object({
            book: v.string(),
            chapter: v.string(),
            verse: v.string(),
            scripture: v.string(),
        })),
        copyrightContent: v.string(),
        isPublicDomain: v.boolean(),
        uploadedBy: v.string(),
    },
    handler: async (ctx, args) => {
        // Check if version already exists
        const existing = await ctx.db
            .query("bibleVersions")
            .withIndex("by_version_id", (q) => q.eq("id", args.id))
            .first();

        if (existing) {
            // Update existing version
            await ctx.db.patch(existing._id, {
                name: args.name,
                data: args.data,
                copyrightContent: args.copyrightContent,
                isPublicDomain: args.isPublicDomain,
                uploadedAt: new Date().toISOString(),
                uploadedBy: args.uploadedBy,
            });

            return { success: true, action: "updated", id: args.id };
        }

        // Create new version
        await ctx.db.insert("bibleVersions", {
            id: args.id,
            name: args.name,
            data: args.data,
            copyrightContent: args.copyrightContent,
            isPublicDomain: args.isPublicDomain,
            uploadedAt: new Date().toISOString(),
            uploadedBy: args.uploadedBy,
        });

        return { success: true, action: "created", id: args.id };
    },
});

// Delete a Bible version (admin only)
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

        await ctx.db.delete(existing._id);
        return { success: true, action: "deleted", id: args.id };
    },
});

// Get Bible verse data for scripture lookup
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

        const verseEnd = args.verseEnd ?? args.verseStart;
        const verses: Array<{ verse: string; scripture: string }> = [];

        // Find all verses in the range
        for (let v = args.verseStart; v <= verseEnd; v++) {
            const verse = bibleVersion.data.find(
                (item) =>
                    Number(item.book) === args.book &&
                    Number(item.chapter) === args.chapter &&
                    Number(item.verse) === v
            );

            if (verse) {
                verses.push({ verse: verse.verse, scripture: verse.scripture });
            }
        }

        return {
            version: args.versionId,
            versionName: bibleVersion.name,
            copyrightContent: bibleVersion.copyrightContent,
            verses,
        };
    },
});
