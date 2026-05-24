import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ─── Speaker Profile ────────────────────────────────────────────────────────

export const getSpeakerProfile = query({
    args: {
        speakerName: v.string(),
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("speakerProfiles")
            .withIndex("by_speaker_church", (q) =>
                q.eq("speakerName", args.speakerName).eq("churchId", args.churchId)
            )
            .unique();
    },
});

export const upsertSpeakerProfile = mutation({
    args: {
        speakerName: v.string(),
        churchId: v.string(),
        bookMishearings: v.optional(v.string()),
        keywordMishearings: v.optional(v.string()),
        bookStats: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("speakerProfiles")
            .withIndex("by_speaker_church", (q) =>
                q.eq("speakerName", args.speakerName).eq("churchId", args.churchId)
            )
            .unique();

        const now = new Date().toISOString();
        if (existing) {
            await ctx.db.patch(existing._id, {
                ...args,
                updatedAt: now,
            });
            return existing._id;
        }

        return await ctx.db.insert("speakerProfiles", {
            ...args,
            totalSermons: 0,
            totalCorrections: 0,
            createdAt: now,
            updatedAt: now,
        });
    },
});

// ─── Corrections ────────────────────────────────────────────────────────────

export const addCorrection = mutation({
    args: {
        transcriptId: v.id("transcripts"),
        correctedReference: v.string(),
        originalReference: v.optional(v.string()),
        correctionType: v.union(v.literal("missed"), v.literal("wrong-verse"), v.literal("wrong-book")),
        closestRawText: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const transcript = await ctx.db.get(args.transcriptId);
        if (!transcript) throw new Error("Transcript not found");

        const correction = {
            originalReference: args.originalReference,
            correctedReference: args.correctedReference,
            correctionType: args.correctionType,
            timestamp: Date.now(),
            closestRawText: args.closestRawText,
        };

        const existing = transcript.userCorrections || [];
        await ctx.db.patch(args.transcriptId, {
            userCorrections: [...existing, correction],
            updatedAt: new Date().toISOString(),
        });

        // Update speaker profile correction count
        if (transcript.speakerName) {
            const profile = await ctx.db
                .query("speakerProfiles")
                .withIndex("by_speaker_church", (q) =>
                    q.eq("speakerName", transcript.speakerName!).eq("churchId", transcript.churchId)
                )
                .unique();
            if (profile) {
                await ctx.db.patch(profile._id, {
                    totalCorrections: profile.totalCorrections + 1,
                    updatedAt: new Date().toISOString(),
                });
            }
        }

        return correction;
    },
});

// ─── Failed Candidates ─────────────────────────────────────────────────────

export const addFailedCandidate = mutation({
    args: {
        transcriptId: v.id("transcripts"),
        reference: v.string(),
        score: v.number(),
        threshold: v.number(),
        rawText: v.string(),
    },
    handler: async (ctx, args) => {
        const transcript = await ctx.db.get(args.transcriptId);
        if (!transcript) throw new Error("Transcript not found");

        const candidate = {
            reference: args.reference,
            score: args.score,
            threshold: args.threshold,
            rawText: args.rawText,
        };

        const existing = transcript.failedCandidates || [];
        // Cap at 50 to avoid huge docs
        const next = [...existing, candidate].slice(-50);
        await ctx.db.patch(args.transcriptId, {
            failedCandidates: next,
            updatedAt: new Date().toISOString(),
        });

        return candidate;
    },
});

// ─── Pattern Discovery ────────────────────────────────────────────────────────

export const proposePattern = mutation({
    args: {
        correctForm: v.string(),
        heardAs: v.string(),
        patternType: v.union(v.literal("book"), v.literal("chapter-keyword"), v.literal("verse-keyword"), v.literal("version"), v.literal("number")),
        speakerName: v.optional(v.string()),
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        // Check if identical pending pattern already exists
        const existing = await ctx.db
            .query("misheardPatterns")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .collect();

        const match = existing.find(
            (p) =>
                p.correctForm.toLowerCase() === args.correctForm.toLowerCase() &&
                p.heardAs.toLowerCase() === args.heardAs.toLowerCase() &&
                p.churchId === args.churchId
        );

        if (match) {
            await ctx.db.patch(match._id, {
                frequency: match.frequency + 1,
                updatedAt: new Date().toISOString(),
            });
            return match._id;
        }

        return await ctx.db.insert("misheardPatterns", {
            ...args,
            frequency: 1,
            confidence: "low",
            status: "pending",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    },
});

export const reviewPattern = mutation({
    args: {
        id: v.id("misheardPatterns"),
        status: v.union(v.literal("approved"), v.literal("rejected")),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.id, {
            status: args.status,
            updatedAt: new Date().toISOString(),
        });
        return args.id;
    },
});

export const getPendingPatterns = query({
    args: {
        churchId: v.string(),
        speakerName: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let patterns = await ctx.db
            .query("misheardPatterns")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .order("desc")
            .collect();

        patterns = patterns.filter((p) => p.churchId === args.churchId);
        if (args.speakerName) {
            patterns = patterns.filter((p) => p.speakerName === args.speakerName);
        }
        return patterns;
    },
});

export const getApprovedPatterns = query({
    args: {
        churchId: v.string(),
    },
    handler: async (ctx, args) => {
        const patterns = await ctx.db
            .query("misheardPatterns")
            .withIndex("by_status", (q) => q.eq("status", "approved"))
            .collect();
        return patterns.filter((p) => p.churchId === args.churchId);
    },
});

// ─── Post-Sermon Analysis ───────────────────────────────────────────────────

export const getMissedVersesReport = query({
    args: {
        transcriptId: v.id("transcripts"),
    },
    handler: async (ctx, args) => {
        const transcript = await ctx.db.get(args.transcriptId);
        if (!transcript) return null;

        const corrections = transcript.userCorrections || [];
        const detected = transcript.detectedVerses || [];
        const failed = transcript.failedCandidates || [];

        // For each missed correction, find if we had a close semantic match
        const enriched = corrections.map((c) => {
            const closeMatch = failed.find(
                (f) =>
                    f.reference.toLowerCase() === c.correctedReference.toLowerCase() ||
                    f.reference.includes(c.correctedReference.split(":")[0])
            );
            return { ...c, closeSemanticMatch: closeMatch || null };
        });

        return {
            detectedCount: detected.length,
            correctionCount: corrections.length,
            failedCandidateCount: failed.length,
            corrections: enriched,
        };
    },
});
