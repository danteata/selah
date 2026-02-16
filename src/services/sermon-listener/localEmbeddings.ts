/**
 * Local Embeddings Service
 * 
 * Provides client-side text embeddings using Transformers.js.
 * This enables FREE semantic verse detection without API calls.
 * 
 * Architecture:
 * - Uses Xenova/all-MiniLM-L6-v2 model (22MB, quantized)
 * - Generates 384-dimensional embeddings
 * - Works offline after initial model download
 * - Model is cached in browser storage
 */

import { pipeline, env } from '@xenova/transformers';

// Configure Transformers.js for browser usage
env.allowLocalModels = false;
env.useBrowserCache = true;

// Singleton for the embedding pipeline
let embedder: Awaited<ReturnType<typeof pipeline>> | null = null;
let loadingPromise: Promise<Awaited<ReturnType<typeof pipeline>>> | null = null;

// Model configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSIONS = 384;

export interface EmbeddingResult {
    embedding: number[];
    dimensions: number;
}

export interface VerseMatch {
    reference: string;
    book: string;
    bookNumber: number;
    chapter: number;
    verse: number;
    text: string;
    score: number;
}

/**
 * Get or initialize the embedding pipeline.
 * Uses singleton pattern to avoid re-loading the model.
 */
async function getEmbedder(): Promise<Awaited<ReturnType<typeof pipeline>>> {
    if (embedder) {
        return embedder;
    }

    // If already loading, wait for it
    if (loadingPromise) {
        return loadingPromise;
    }

    // Start loading
    loadingPromise = pipeline('feature-extraction', MODEL_NAME, {
        quantized: true, // Use quantized model for smaller size
        progress_callback: (progress: { status: string; progress?: number }) => {
            if (progress.status === 'progress' && progress.progress) {
                console.log(`[Embeddings] Loading model: ${Math.round(progress.progress)}%`);
            }
        },
    });

    embedder = await loadingPromise;
    loadingPromise = null;

    return embedder;
}

/**
 * Check if the embedding model is loaded and ready.
 */
export function isEmbedderReady(): boolean {
    return embedder !== null;
}

/**
 * Get the embedding model loading status.
 */
export async function initializeEmbedder(): Promise<{
    ready: boolean;
    dimensions: number;
    modelName: string;
}> {
    try {
        await getEmbedder();
        return {
            ready: true,
            dimensions: EMBEDDING_DIMENSIONS,
            modelName: MODEL_NAME,
        };
    } catch (error) {
        console.error('[Embeddings] Failed to initialize embedder:', error);
        return {
            ready: false,
            dimensions: 0,
            modelName: MODEL_NAME,
        };
    }
}

/**
 * Generate an embedding for a single text.
 * 
 * @param text - The text to embed
 * @returns The embedding vector (384 dimensions)
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
    const model = await getEmbedder();

    // Generate embedding - use type assertion for Transformers.js options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await model(text, {
        pooling: 'mean',
        normalize: true,
    } as any);

    // Convert to regular array - result is a Tensor
    const tensor = result as unknown as { data: Float32Array; dims: number[] };
    const embedding = Array.from(tensor.data) as number[];

    return {
        embedding,
        dimensions: embedding.length,
    };
}

/**
 * Generate embeddings for multiple texts in batch.
 * More efficient than calling embedText multiple times.
 * 
 * @param texts - Array of texts to embed
 * @returns Array of embedding vectors
 */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const model = await getEmbedder();

    const results: EmbeddingResult[] = [];

    // Process in batches to avoid memory issues
    const BATCH_SIZE = 8;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.all(
            batch.map(async (text) => {
                // Use type assertion for Transformers.js options
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = await model(text, {
                    pooling: 'mean',
                    normalize: true,
                } as any);
                const tensor = result as unknown as { data: Float32Array; dims: number[] };
                return Array.from(tensor.data) as number[];
            })
        );

        results.push(...batchResults.map((embedding) => ({
            embedding,
            dimensions: embedding.length,
        })));

        // Log progress for large batches
        if (texts.length > 100) {
            console.log(`[Embeddings] Processed ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length} texts`);
        }
    }

    return results;
}

/**
 * Calculate cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Vector dimensions don't match: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find the most similar verses from a pre-computed set.
 * This is a fallback for when Convex vector search is not available.
 * 
 * @param queryEmbedding - The embedding to search for
 * @param verseEmbeddings - Pre-computed verse embeddings to search through
 * @param threshold - Minimum similarity score (default 0.75)
 * @param limit - Maximum results to return (default 5)
 */
export function findSimilarLocally(
    queryEmbedding: number[],
    verseEmbeddings: Array<{
        reference: string;
        book: string;
        bookNumber: number;
        chapter: number;
        verse: number;
        text: string;
        embedding: number[];
    }>,
    threshold = 0.75,
    limit = 5
): VerseMatch[] {
    const scores = verseEmbeddings.map((v) => ({
        ...v,
        score: cosineSimilarity(queryEmbedding, v.embedding),
    }));

    return scores
        .filter((s) => s.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

// ============================================================================
// Verse Embedding Cache (IndexedDB)
// ============================================================================

const VERSE_CACHE_DB_NAME = 'selah-verse-embeddings';
const VERSE_CACHE_STORE_NAME = 'embeddings';
const VERSE_CACHE_VERSION = 1;

interface CachedVerseEmbedding {
    reference: string;
    book: string;
    bookNumber: number;
    chapter: number;
    verse: number;
    text: string;
    embedding: number[];
    version: string;
    cachedAt: number;
}

/**
 * Open the IndexedDB for verse embedding cache.
 */
async function openVerseCache(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(VERSE_CACHE_DB_NAME, VERSE_CACHE_VERSION);

        request.onerror = () => reject(request.error);

        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains(VERSE_CACHE_STORE_NAME)) {
                const store = db.createObjectStore(VERSE_CACHE_STORE_NAME, {
                    keyPath: 'reference',
                });
                store.createIndex('by_book', 'book');
                store.createIndex('by_version', 'version');
            }
        };
    });
}

/**
 * Get cached verse embeddings from IndexedDB.
 */
export async function getCachedVerseEmbeddings(
    version?: string
): Promise<CachedVerseEmbedding[]> {
    try {
        const db = await openVerseCache();
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readonly');
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME);

        const request = version
            ? store.index('by_version').getAll(version)
            : store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[Embeddings] Failed to get cached embeddings:', error);
        return [];
    }
}

/**
 * Cache verse embeddings in IndexedDB.
 */
export async function cacheVerseEmbeddings(
    embeddings: CachedVerseEmbedding[]
): Promise<void> {
    try {
        const db = await openVerseCache();
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME);

        for (const embedding of embeddings) {
            store.put({
                ...embedding,
                cachedAt: Date.now(),
            });
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (error) {
        console.error('[Embeddings] Failed to cache embeddings:', error);
    }
}

/**
 * Clear cached verse embeddings.
 */
export async function clearCachedVerseEmbeddings(): Promise<void> {
    try {
        const db = await openVerseCache();
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME);

        store.clear();

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (error) {
        console.error('[Embeddings] Failed to clear cache:', error);
    }
}

/**
 * Check if we have cached embeddings for a version.
 */
export async function hasCachedEmbeddings(version: string): Promise<boolean> {
    const cached = await getCachedVerseEmbeddings(version);
    return cached.length > 0;
}

export default {
    initializeEmbedder,
    isEmbedderReady,
    embedText,
    embedBatch,
    cosineSimilarity,
    findSimilarLocally,
    getCachedVerseEmbeddings,
    cacheVerseEmbeddings,
    clearCachedVerseEmbeddings,
    hasCachedEmbeddings,
};