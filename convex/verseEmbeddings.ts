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
        // Pre-computed embedding from the client (384 dimensions)
        queryEmbedding: v.array(v.float64()),
        // Minimum similarity score (0-1, default 0.75)
        threshold: v.optional(v.number()),
        // Maximum results to return (default 5)
        limit: v.optional(v.number()),
        // Optional: filter by specific Bible version
        version: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<VerseSearchResult[]> => {
        const threshold = args.threshold ?? 0.75;
        const limit = args.limit ?? 5;

        // Perform vector search using Convex's built-in vector index
        // This is FREE and runs efficiently on the server
        // Note: vectorSearch returns { _id, _score } objects, not full documents
        const vectorResults = await ctx.vectorSearch(
            "verseEmbeddings",
            "by_embedding",
            {
                vector: args.queryEmbedding,
                limit: limit * 2, // Fetch extra to allow for threshold filtering
                filter: args.version ? (q) => q.eq("version", args.version as string) : undefined,
            }
        );

        // Filter by threshold first
        const filteredResults = vectorResults
            .filter((r) => r._score >= threshold)
            .slice(0, limit);

        // Fetch the actual documents for each matching ID
        const matches: VerseSearchResult[] = [];
        for (const result of filteredResults) {
            const doc = await ctx.runQuery(api.verseEmbeddings.getVerseById, {
                id: result._id
            });
            if (doc) {
                matches.push({
                    _id: doc._id,
                    reference: doc.reference,
                    book: doc.book,
                    bookNumber: doc.bookNumber,
                    chapter: doc.chapter,
                    verse: doc.verse,
                    text: doc.text,
                    score: result._score,
                });
            }
        }

        return matches;
    },
});

/**
 * Get a verse by its ID (internal helper for vector search results).
 */
export const getVerseById = query({
    args: {
        id: v.id("verseEmbeddings"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});

/**
 * Get a specific verse by reference.
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

        return await query.first();
    },
});

/**
 * Get all verses for a specific book and chapter.
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

        return await query.collect();
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
 * Get count of embedded verses.
 */
export const getEmbeddingStats = query({
    args: {
        version: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let verses;

        if (args.version) {
            verses = await ctx.db
                .query("verseEmbeddings")
                .withIndex("by_version", (q) => q.eq("version", args.version as string))
                .collect();
        } else {
            verses = await ctx.db.query("verseEmbeddings").collect();
        }

        return {
            count: verses.length,
            version: args.version ?? 'all',
            hasEmbeddings: verses.length > 0,
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
    },
    handler: async (ctx, args) => {
        // Check if this verse already exists
        const existing = await ctx.db
            .query("verseEmbeddings")
            .withIndex("by_reference", (q) => q.eq("reference", args.reference))
            .filter((q) => q.eq(q.field("version"), args.version))
            .first();

        if (existing) {
            // Update existing embedding
            await ctx.db.patch(existing._id, {
                text: args.text,
                embedding: args.embedding,
            });
            return { updated: true, id: existing._id };
        }

        // Insert new embedding
        const id = await ctx.db.insert("verseEmbeddings", {
            reference: args.reference,
            book: args.book,
            bookNumber: args.bookNumber,
            chapter: args.chapter,
            verse: args.verse,
            text: args.text,
            version: args.version,
            embedding: args.embedding,
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
 * Seed embeddings for a Bible version.
 * 
 * This action:
 * 1. Fetches Bible data from bibleVersions table
 * 2. Generates embeddings using OpenAI API (or can be modified for other providers)
 * 3. Stores embeddings in verseEmbeddings table
 * 
 * NOTE: This requires OPENAI_API_KEY environment variable in Convex dashboard.
 * For free alternative, use the frontend seed function with Transformers.js.
 */
export const seedEmbeddingsFromVersion = action({
    args: {
        versionId: v.string(), // e.g., "KJV"
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{ success: boolean; count: number; error?: string }> => {
        const batchSize = args.batchSize ?? 100;

        // Get Bible version file URL
        const fileInfo = await ctx.runQuery(api.bibleVersions.getBibleFileUrl, { versionId: args.versionId });
        if (!fileInfo || !fileInfo.url) {
            return { success: false, count: 0, error: `Bible version "${args.versionId}" not found or has no file` };
        }

        // Get OpenAI API key from environment
        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
            return {
                success: false,
                count: 0,
                error: "OPENAI_API_KEY not set. Set it in Convex dashboard or use frontend seeding."
            };
        }

        // Fetch the Bible data from file storage
        const response = await fetch(fileInfo.url);
        if (!response.ok) {
            return { success: false, count: 0, error: `Failed to fetch Bible file: ${response.status}` };
        }

        const verses = await response.json() as Array<{ book: string; chapter: string; verse: string; scripture: string }>;

        let count = 0;

        // Process in batches
        for (let i = 0; i < verses.length; i += batchSize) {
            const batch = verses.slice(i, i + batchSize);
            const texts = batch.map((v) => v.scripture);

            // Generate embeddings via OpenAI
            // Using text-embedding-3-small for cost efficiency
            const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${openaiApiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "text-embedding-3-small",
                    input: texts,
                    dimensions: 384, // Request smaller dimension for efficiency
                }),
            });

            if (!embeddingResponse.ok) {
                const error = await embeddingResponse.text();
                return { success: false, count, error: `OpenAI API error: ${error}` };
            }

            const embeddingData = await embeddingResponse.json();
            const embeddings = embeddingData.data as Array<{ embedding: number[]; index: number }>;

            // Sort by index to maintain order
            embeddings.sort((a, b) => a.index - b.index);

            // Insert embeddings using the internal mutation
            for (let j = 0; j < batch.length; j++) {
                const verse = batch[j];
                const embedding = embeddings[j]?.embedding;

                if (!embedding || embedding.length !== 384) {
                    console.warn(`Skipping verse ${verse.book} ${verse.chapter}:${verse.verse} - invalid embedding`);
                    continue;
                }

                const bookNumber = BOOK_TO_NUMBER[verse.book] ?? 0;
                const reference = `${verse.book} ${verse.chapter}:${verse.verse}`;

                await ctx.runMutation(internal.verseEmbeddings.insertEmbedding, {
                    reference,
                    book: verse.book,
                    bookNumber,
                    chapter: parseInt(verse.chapter, 10),
                    verse: parseInt(verse.verse, 10),
                    text: verse.scripture,
                    version: args.versionId,
                    embedding,
                });

                count++;
            }

            // Log progress
            console.log(`Seeded ${count}/${verses.length} verses for ${args.versionId}`);
        }

        return { success: true, count };
    },
});

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