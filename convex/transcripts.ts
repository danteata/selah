import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Get all transcripts for a church
export const getByChurch = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("transcripts")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .order("desc")
            .collect();
    },
});

// Get all transcripts for a schedule
export const getBySchedule = query({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("transcripts")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .order("desc")
            .collect();
    },
});

// Get a single transcript by ID
export const getById = query({
    args: {
        id: v.id("transcripts"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});

// Get transcripts by creator
export const getByCreator = query({
    args: {
        createdBy: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("transcripts")
            .withIndex("by_creator", (q) => q.eq("createdBy", args.createdBy))
            .order("desc")
            .collect();
    },
});

// Create a new transcript
export const create = mutation({
    args: {
        title: v.string(),
        transcript: v.string(),
        speakerName: v.optional(v.string()),
        rawUtterances: v.optional(v.array(v.object({
            text: v.string(),
            timestamp: v.number(),
            confidence: v.optional(v.number()),
        }))),
        detectedVerses: v.optional(v.array(v.object({
            reference: v.string(),
            book: v.string(),
            chapter: v.number(),
            verseStart: v.number(),
            verseEnd: v.optional(v.number()),
            confidence: v.string(),
            detectionMethod: v.optional(v.string()),
            rawText: v.optional(v.string()),
        }))),
        provider: v.string(),
        language: v.optional(v.string()),
        scheduleId: v.optional(v.string()),
        churchId: v.string(),
        createdBy: v.string(),
    },
    handler: async (ctx, args) => {
        const now = new Date().toISOString();

        const transcriptId = await ctx.db.insert("transcripts", {
            title: args.title,
            transcript: args.transcript,
            speakerName: args.speakerName,
            rawUtterances: args.rawUtterances,
            detectedVerses: args.detectedVerses,
            provider: args.provider,
            language: args.language,
            scheduleId: args.scheduleId,
            churchId: args.churchId,
            createdBy: args.createdBy,
            createdAt: now,
            updatedAt: now,
        });

        return transcriptId;
    },
});

// Update an existing transcript
export const update = mutation({
    args: {
        id: v.id("transcripts"),
        title: v.optional(v.string()),
        transcript: v.optional(v.string()),
        detectedVerses: v.optional(v.array(v.object({
            reference: v.string(),
            book: v.string(),
            chapter: v.number(),
            verseStart: v.number(),
            verseEnd: v.optional(v.number()),
            confidence: v.string(),
        }))),
        scheduleId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        const existing = await ctx.db.get(id);

        if (!existing) {
            throw new Error("Transcript not found");
        }

        await ctx.db.patch(id, {
            ...updates,
            updatedAt: new Date().toISOString(),
        });

        return id;
    },
});

// Delete a transcript
export const remove = mutation({
    args: {
        id: v.id("transcripts"),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.id);

        if (!existing) {
            throw new Error("Transcript not found");
        }

        await ctx.db.delete(args.id);
        return args.id;
    },
});

// Update transcript's schedule association
export const updateSchedule = mutation({
    args: {
        id: v.id("transcripts"),
        scheduleId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.id);

        if (!existing) {
            throw new Error("Transcript not found");
        }

        await ctx.db.patch(args.id, {
            scheduleId: args.scheduleId,
            updatedAt: new Date().toISOString(),
        });

        return args.id;
    },
});