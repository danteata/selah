import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser, isMemberOf, requireUser } from "./lib/auth";

// Transcripts carry every segment of a sermon, so a church's full history can
// outgrow a query's read budget. The newest are the ones anyone reopens.
const MAX_LISTED = 200;

/** A transcript in the caller's church, or a thrown error. */
export async function requireOwnTranscript(ctx: QueryCtx, id: Id<"transcripts">) {
    const user = await requireUser(ctx);
    const transcript = await ctx.db.get(id);
    if (!transcript) throw new Error("Transcript not found");
    if (!isMemberOf(user, transcript.churchId)) throw new Error("Unauthorized");
    return { user, transcript };
}

// Get all transcripts for a church
export const getByChurch = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user || !isMemberOf(user, args.churchId)) return [];

        return await ctx.db
            .query("transcripts")
            .withIndex("by_church", (q) => q.eq("churchId", args.churchId))
            .order("desc")
            .take(MAX_LISTED);
    },
});

// Get all transcripts for a schedule
export const getBySchedule = query({
    args: {
        scheduleId: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user?.churchId) return [];

        const transcripts = await ctx.db
            .query("transcripts")
            .withIndex("by_schedule", (q) => q.eq("scheduleId", args.scheduleId))
            .order("desc")
            .take(MAX_LISTED);
        return transcripts.filter((t) => t.churchId === user.churchId);
    },
});

// Get a single transcript by ID
export const getById = query({
    args: {
        id: v.id("transcripts"),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) return null;
        const transcript = await ctx.db.get(args.id);
        return transcript && isMemberOf(user, transcript.churchId) ? transcript : null;
    },
});

// Get transcripts by creator
export const getByCreator = query({
    args: {
        createdBy: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user?.churchId) return [];

        const transcripts = await ctx.db
            .query("transcripts")
            .withIndex("by_creator", (q) => q.eq("createdBy", args.createdBy))
            .order("desc")
            .take(MAX_LISTED);
        return transcripts.filter((t) => t.churchId === user.churchId);
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
        segments: v.optional(v.array(v.object({
            id: v.string(),
            text: v.string(),
            startMs: v.number(),
            endMs: v.number(),
            source: v.union(v.literal('web-speech'), v.literal('whisper'), v.literal('elevenlabs')),
            confidence: v.optional(v.number()),
            speaker: v.optional(v.number()),
        }))),
        provider: v.string(),
        language: v.optional(v.string()),
        scheduleId: v.optional(v.string()),
        // Both still accepted from older clients, but the transcript is always
        // filed under the caller and their own church.
        churchId: v.optional(v.string()),
        createdBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);
        if (!user.churchId) throw new Error("Join a church before saving transcripts");
        if (args.churchId && args.churchId !== user.churchId) throw new Error("Unauthorized");

        const now = new Date().toISOString();

        const transcriptId = await ctx.db.insert("transcripts", {
            title: args.title,
            transcript: args.transcript,
            speakerName: args.speakerName,
            rawUtterances: args.rawUtterances,
            detectedVerses: args.detectedVerses,
            segments: args.segments,
            provider: args.provider,
            language: args.language,
            scheduleId: args.scheduleId,
            churchId: user.churchId,
            createdBy: user._id,
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
        segments: v.optional(v.array(v.object({
            id: v.string(),
            text: v.string(),
            startMs: v.number(),
            endMs: v.number(),
            source: v.union(v.literal('web-speech'), v.literal('whisper'), v.literal('elevenlabs')),
            confidence: v.optional(v.number()),
            speaker: v.optional(v.number()),
        }))),
        scheduleId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        await requireOwnTranscript(ctx, id);

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
        await requireOwnTranscript(ctx, args.id);

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
        await requireOwnTranscript(ctx, args.id);

        await ctx.db.patch(args.id, {
            scheduleId: args.scheduleId,
            updatedAt: new Date().toISOString(),
        });

        return args.id;
    },
});