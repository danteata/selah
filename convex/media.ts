import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getById, getCurrentUser, isMemberOf, requireUser } from "./lib/auth";

// A media item is created straight after its file is uploaded. Refusing older
// files stops a caller wrapping someone else's storage id — which travel in
// slides and templates — in an item of their own and then deleting it.
const MAX_UPLOAD_AGE_MS = 6 * 60 * 60 * 1000;

// Generate upload URL for media file storage
export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        await requireUser(ctx);
        return await ctx.storage.generateUploadUrl();
    },
});

// Get the media library for the current user's church (plus anything they
// personally created before belonging to a church).
export const getMediaLibrary = query({
    args: {},
    handler: async (ctx) => {
        const user = await getCurrentUser(ctx);
        if (!user) return [];

        const userItems = await ctx.db
            .query("mediaLibrary")
            .withIndex("by_creator", (q) => q.eq("createdBy", user._id))
            .take(1000);

        // Only a real church: "" would pool every churchless user's media.
        const churchItems = user.churchId
            ? await ctx.db
                .query("mediaLibrary")
                .withIndex("by_church", (q) => q.eq("churchId", user.churchId))
                .take(1000)
            : [];

        const seen = new Set<string>();
        return [...userItems, ...churchItems]
            .filter((item) => {
                if (seen.has(item._id)) return false;
                seen.add(item._id);
                return true;
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
        const user = await requireUser(ctx);

        if (args.storageId) {
            const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
            const file = storageId ? await ctx.db.system.get(storageId) : null;
            if (!file) throw new Error("Uploaded file not found");
            if (Date.now() - file._creationTime > MAX_UPLOAD_AGE_MS) {
                throw new Error("That upload has expired; please upload the file again");
            }

            const claimed = await ctx.db
                .query("mediaLibrary")
                .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
                .take(20);
            if (claimed.some((item) => item.createdBy !== user._id && !isMemberOf(user, item.churchId))) {
                throw new Error("That file belongs to another library");
            }
        }

        const now = new Date().toISOString();
        return await ctx.db.insert("mediaLibrary", {
            name: args.name,
            type: args.type,
            storageId: args.storageId,
            isExternal: args.isExternal,
            externalType: args.externalType,
            url: args.url,
            createdBy: user._id,
            churchId: user.churchId,
            createdAt: now,
            updatedAt: now,
        });
    },
});

// Delete a media library item
export const deleteMediaLibraryItem = mutation({
    args: {
        mediaId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);
        const item = await getById(ctx, "mediaLibrary", args.mediaId);
        if (!item) throw new Error("Media item not found");
        if (item.createdBy !== user._id && !isMemberOf(user, item.churchId)) {
            throw new Error("Unauthorized");
        }

        await ctx.db.delete(item._id);

        // Remove the file only once nothing else in any library points at it.
        if (item.storageId) {
            const stillUsed = await ctx.db
                .query("mediaLibrary")
                .withIndex("by_storage", (q) => q.eq("storageId", item.storageId))
                .first();
            const storageId = ctx.db.system.normalizeId("_storage", item.storageId);
            if (!stillUsed && storageId) {
                await ctx.storage.delete(storageId);
            }
        }

        return true;
    },
});
