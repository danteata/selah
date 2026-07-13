import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Generate upload URL for media file storage
export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }
        return await ctx.storage.generateUploadUrl();
    },
});

// Get the media library for the current user's church (plus anything they
// personally created before belonging to a church).
export const getMediaLibrary = query({
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

        const userItems = await ctx.db
            .query("mediaLibrary")
            .withIndex("by_creator", (q) => q.eq("createdBy", user._id))
            .collect();

        const churchItems = await ctx.db
            .query("mediaLibrary")
            .withIndex("by_church", (q) => q.eq("churchId", user.churchId || ''))
            .collect();

        const combined = [...userItems, ...churchItems];
        const unique = combined.filter((item, index, self) =>
            index === self.findIndex((i) => i._id === item._id)
        );

        return unique.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
});

// Create a media library item — either an uploaded file (storageId) or an
// external YouTube/Vimeo link (isExternal + url).
export const createMediaLibraryItem = mutation({
    args: {
        name: v.string(),
        type: v.union(v.literal("image"), v.literal("video")),
        storageId: v.optional(v.string()),
        isExternal: v.optional(v.boolean()),
        externalType: v.optional(v.union(v.literal("youtube"), v.literal("vimeo"))),
        url: v.optional(v.string()),
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
        const mediaId = await ctx.db.insert("mediaLibrary", {
            name: args.name,
            type: args.type,
            storageId: args.storageId,
            isExternal: args.isExternal,
            externalType: args.externalType,
            url: args.url,
            createdBy: user._id!,
            churchId: user.churchId,
            createdAt: now,
            updatedAt: now,
        });

        return mediaId;
    },
});

// Delete a media library item
export const deleteMediaLibraryItem = mutation({
    args: {
        mediaId: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const item = await ctx.db.get(args.mediaId as Id<"mediaLibrary">);
        if (!item) {
            throw new Error("Media item not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", identity.email!))
            .unique();

        if (!user || (item.createdBy !== user._id && item.churchId !== user.churchId)) {
            throw new Error("Unauthorized");
        }

        if (item.storageId) {
            await ctx.storage.delete(item.storageId as Id<"_storage">);
        }

        await ctx.db.delete(item._id);
        return true;
    },
});
