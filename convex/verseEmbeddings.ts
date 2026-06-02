/**
 * Verse Embeddings Module
 * 
 * Provides semantic search for Bible verses using vector embeddings.
 * This enables the AI sermon listener to detect paraphrased verses.
 * 
 * Architecture:
 * - Pre-computed embeddings stored in verseEmbeddings table
 * - Vector search via Convex's built-in vector index (in actions only)
 * - Client generates embedding locally using Transformers.js
 * - This module receives the embedding and performs similarity search
 */

import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

// Book name to number mapping (standard Protestant canon)
const BOOK_TO_NUMBER: Record<string, number> = {
    'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
    'Joshua': 6, 'Judges': 7, 'Ruth': 8, '1 Samuel': 9, '2 Samuel': 10,
    '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14, 'Ezra': 15,
    'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19, 'Proverbs': 20,
    'Ecclesiastes': 21, 'Song of Solomon': 22, 'Isaiah': 23, 'Jeremiah': 24, 'Lamentations': 25,
    'Ezekiel': 26, 'Daniel': 27, 'Hosea': 28, 'Joel': 29, 'Amos': 30,
    'Obadiah': 31, 'Jonah': 32, 'Micah': 33, 'Nahum': 34, 'Habakkuk': 35,
    'Zephaniah': 36, 'Haggai': 37, 'Zechariah': 38, 'Malachi': 39,
    'Matthew': 40, 'Mark': 41, 'Luke': 42, 'John': 43, 'Acts': 44,
    'Romans': 45, '1 Corinthians': 46, '2 Corinthians': 47, 'Galatians': 48, 'Ephesians': 49,
    'Philippians': 50, 'Colossians': 51, '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54,
    '2 Timothy': 55, 'Titus': 56, 'Philemon': 57, 'Hebrews': 58, 'James': 59,
    '1 Peter': 60, '2 Peter': 61, '1 John': 62, '2 John': 63, '3 John': 64,
    'Jude': 65, 'Revelation': 66,
};

// Result type for verse search
export interface VerseSearchResult {
    _id: string;
    reference: string;
    book: string;
    bookNumber: number;
    chapter: number;
    verse: number;
    text: string;
    score: number;
}

/**
 * Perform semantic search for verses similar to the query embedding.
 * 
 * NOTE: Vector search in Convex is only available in actions, not queries.
 * This action receives a pre-computed embedding from the client and performs
 * the vector search server-side.
 */
export const findSimilarVerses = action({
    args: {
        queryEmbedding: v.array(v.float64()),
        threshold: v.optional(v.number()),
        limit: v.optional(v.number()),
        version: v.optional(v.string()),
        embeddingVersion: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<VerseSearchResult[]> => {
        const threshold = args.threshold ?? 0.75;
        const limit = args.limit ?? 5;

        const vectorResults = await ctx.vectorSearch(
            "verseEmbeddings",
            "by_embedding",
            {
                vector: args.queryEmbedding,
                limit: limit * 4,
                filter: args.version ? (q) => q.eq("version", args.version as string) : undefined,
            }
        );

        const filteredResults = vectorResults
            .filter((r) => r._score >= threshold);

        const rawMatches: Array<VerseSearchResult & { _score: number }> = [];
        for (const result of filteredResults) {
            const doc = await ctx.runQuery(api.verseEmbeddings.getVerseById, {
                id: result._id
            });
            if (doc) {
                rawMatches.push({
                    _id: doc._id,
                    reference: doc.reference,
                    book: doc.book,
                    bookNumber: doc.bookNumber,
                    chapter: doc.chapter,
                    verse: doc.verse,
                    text: doc.text,
                    score: result._score,
                    _score: result._score,
                });
            }
        }

        const bestPerReference = new Map<string, VerseSearchResult>();
        for (const match of rawMatches) {
            const existing = bestPerReference.get(match.reference);
            if (!existing || match._score > existing.score) {
                bestPerReference.set(match.reference, {
                    _id: match._id,
                    reference: match.reference,
                    book: match.book,
                    bookNumber: match.bookNumber,
                    chapter: match.chapter,
                    verse: match.verse,
                    text: match.text,
                    score: match.score,
                });
            }
        }

        return Array.from(bestPerReference.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    },
});

/**
 * Get a verse by its ID (returns metadata only, no embedding vector).
 */
export const getVerseById = query({
    args: {
        id: v.id("verseEmbeddings"),
    },
    handler: async (ctx, args) => {
        const doc = await ctx.db.get(args.id);
        if (!doc) return null;
        const { embedding, ...rest } = doc;
        return rest;
    },
});

/**
 * Get a specific verse by reference (returns metadata only, no embedding vector).
 */
export const getVerseByReference = query({
    args: {
        reference: v.string(),
        version: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let query = ctx.db
            .query("verseEmbeddings")
            .withIndex("by_reference", (q) => q.eq("reference", args.reference));

        if (args.version) {
            query = query.filter((q) => q.eq(q.field("version"), args.version));
        }

        const doc = await query.first();
        if (!doc) return null;
        const { embedding, ...rest } = doc;
        return rest;
    },
});

/**
 * Get all verses for a specific book and chapter.
 * Returns verse metadata only (no embedding vectors) to reduce bandwidth.
 */
export const getVersesByChapter = query({
    args: {
        book: v.string(),
        chapter: v.number(),
        version: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let query = ctx.db
            .query("verseEmbeddings")
            .withIndex("by_book_chapter", (q) =>
                q.eq("book", args.book).eq("chapter", args.chapter)
            );

        if (args.version) {
            query = query.filter((q) => q.eq(q.field("version"), args.version));
        }

        const verses = await query.collect();

        return verses.map(({ embedding, ...rest }) => rest);
    },
});

/**
 * Check if embeddings have been seeded for a given version.
 */
export const hasEmbeddings = query({
    args: {
        version: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (args.version) {
            const first = await ctx.db
                .query("verseEmbeddings")
                .withIndex("by_version", (q) => q.eq("version", args.version as string))
                .first();
            return first !== null;
        }

        const first = await ctx.db.query("verseEmbeddings").first();
        return first !== null;
    },
});

/**
 * Get embedding stats without downloading embedding vectors.
 * Uses pagination to count only, discarding document data.
 */
export const getEmbeddingStats = query({
    args: {
        version: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (args.version) {
            const first = await ctx.db
                .query("verseEmbeddings")
                .withIndex("by_version", (q) => q.eq("version", args.version as string))
                .first();

            return {
                count: first ? -1 : 0,
                version: args.version,
                hasEmbeddings: first !== null,
            };
        }

        const first = await ctx.db.query("verseEmbeddings").first();

        return {
            count: first ? -1 : 0,
            version: 'all',
            hasEmbeddings: first !== null,
        };
    },
});

// ============================================================================
// Internal Mutations (for seeding)
// ============================================================================

/**
 * Internal mutation to insert a single verse embedding.
 * Called by the seed action.
 */
export const insertEmbedding = internalMutation({
    args: {
        reference: v.string(),
        book: v.string(),
        bookNumber: v.number(),
        chapter: v.number(),
        verse: v.number(),
        text: v.string(),
        version: v.string(),
        embedding: v.array(v.float64()),
        fragmentType: v.optional(v.string()),
        fragmentIndex: v.optional(v.number()),
        embeddingVersion: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // For fragment embeddings, use a unique reference to avoid collisions
        const lookupRef = args.fragmentType && args.fragmentType !== 'full'
            ? `${args.reference}__${args.fragmentType}_${args.fragmentIndex}`
            : args.reference;

        // Check if this entry already exists
        const existing = await ctx.db
            .query("verseEmbeddings")
            .withIndex("by_reference", (q) => q.eq("reference", lookupRef))
            .filter((q) => q.eq(q.field("version"), args.version))
            .first();

        if (existing) {
            // Update existing embedding
            await ctx.db.patch(existing._id, {
                text: args.text,
                embedding: args.embedding,
                fragmentType: args.fragmentType,
                fragmentIndex: args.fragmentIndex,
                embeddingVersion: args.embeddingVersion,
            });
            return { updated: true, id: existing._id };
        }

        // Insert new embedding
        const id = await ctx.db.insert("verseEmbeddings", {
            reference: lookupRef,
            book: args.book,
            bookNumber: args.bookNumber,
            chapter: args.chapter,
            verse: args.verse,
            text: args.text,
            version: args.version,
            embedding: args.embedding,
            fragmentType: args.fragmentType,
            fragmentIndex: args.fragmentIndex,
            embeddingVersion: args.embeddingVersion,
        });

        return { updated: false, id };
    },
});

/**
 * Internal mutation to clear all embeddings for a version.
 */
export const clearEmbeddings = internalMutation({
    args: {
        version: v.string(),
    },
    handler: async (ctx, args) => {
        const embeddings = await ctx.db
            .query("verseEmbeddings")
            .withIndex("by_version", (q) => q.eq("version", args.version))
            .collect();

        for (const embedding of embeddings) {
            await ctx.db.delete(embedding._id);
        }

        return { deleted: embeddings.length };
    },
});

// ============================================================================
// Seeding Actions (called from admin or setup scripts)
// ============================================================================

/**
 * Seed embeddings from client-generated embeddings.
 * This is the FREE option - client generates embeddings locally with Transformers.js
 * and sends them to this action for storage.
 */
export const seedEmbeddingsFromClient = action({
    args: {
        versionId: v.string(),
        embeddings: v.array(v.object({
            reference: v.string(),
            book: v.string(),
            chapter: v.number(),
            verse: v.number(),
            text: v.string(),
            embedding: v.array(v.float64()),
            fragmentType: v.optional(v.string()),
            fragmentIndex: v.optional(v.number()),
            embeddingVersion: v.optional(v.string()),
        })),
    },
    handler: async (ctx, args): Promise<{ success: boolean; count: number }> => {
        let count = 0;

        for (const item of args.embeddings) {
            const bookNumber = BOOK_TO_NUMBER[item.book] ?? 0;

            await ctx.runMutation(internal.verseEmbeddings.insertEmbedding, {
                reference: item.reference,
                book: item.book,
                bookNumber,
                chapter: item.chapter,
                verse: item.verse,
                text: item.text,
                version: args.versionId,
                embedding: item.embedding,
                fragmentType: item.fragmentType,
                fragmentIndex: item.fragmentIndex,
                embeddingVersion: item.embeddingVersion,
            });

            count++;
        }

        return { success: true, count };
    },
});

/**
 * Clear all embeddings for a version (admin action).
 */
export const clearVersionEmbeddings = action({
    args: {
        version: v.string(),
    },
    handler: async (ctx, args): Promise<{ deleted: number }> => {
        const result = await ctx.runMutation(internal.verseEmbeddings.clearEmbeddings, {
            version: args.version,
        });
        return result;
    },
});