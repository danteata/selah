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
 * 
 * NOTE: Loads @xenova/transformers from CDN as an ES module to avoid Vite 
 * bundling issues with onnxruntime-web. The onnxruntime-web package has issues
 * when pre-bundled by Vite, causing "Cannot read properties of undefined
 * (reading 'registerBackend')" errors.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadingPromise: Promise<any> | null = null;

// Model configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSIONS = 384;

// CDN URL for Transformers.js
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';

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
 * Load Transformers.js from CDN as ES module to avoid Vite bundling issues.
 * This prevents the onnxruntime-web "registerBackend" error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTransformersFromCDN(): Promise<any> {
    // Use ES module import from CDN
    // This bypasses Vite's bundling entirely
    const moduleUrl = `${TRANSFORMERS_CDN}/dist/transformers.min.js`;

    // Dynamic import from absolute URL - Vite won't intercept this
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const module = await import(/* @vite-ignore */ moduleUrl) as any;
    return module;
}

/**
 * Get or initialize the embedding pipeline.
 * Uses singleton pattern to avoid re-loading the model.
 * Loads Transformers.js from CDN to avoid Vite bundling issues.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getEmbedder(): Promise<any> {
    if (embedder) {
        return embedder;
    }

    // If already loading, wait for it
    if (loadingPromise) {
        return loadingPromise;
    }

    // Start loading - use CDN to avoid bundling issues
    loadingPromise = (async () => {
        // Load Transformers.js from CDN
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transformers = await loadTransformersFromCDN() as any;

        // Configure Transformers.js for browser usage
        transformers.env.allowLocalModels = false;
        transformers.env.useBrowserCache = true;

        const model = await transformers.pipeline('feature-extraction', MODEL_NAME, {
            quantized: true, // Use quantized model for smaller size
            progress_callback: (progress: { status: string; progress?: number }) => {
                if (progress.status === 'progress' && progress.progress) {
                    console.log(`[Embeddings] Loading model: ${Math.round(progress.progress)}%`);
                }
            },
        });

        return model;
    })();

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
    // Since vectors are already normalized by the embedder, 
    // cosine similarity is just the dot product.
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
    }

    return dotProduct;
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

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Log top scores for debugging
    const topScores = scores.slice(0, 3);
    // Only log occasionally to reduce noise
    if (Math.random() < 0.05) {
        console.log('[findSimilarLocally] Top scores:', topScores.map(s => ({ reference: s.reference, score: s.score.toFixed(3) })));
    }

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

export interface CachedVerseEmbedding {
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

/**
 * Clear cached embeddings for a specific version.
 */
export async function clearCachedEmbeddingsForVersion(version: string): Promise<number> {
    try {
        const db = await openVerseCache();
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME);
        const index = store.index('by_version');

        // Get all embeddings for this version
        const request = index.openCursor(IDBKeyRange.only(version));
        let deleted = 0;

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                } else {
                    resolve(deleted);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[Embeddings] Failed to clear cached embeddings for version:', error);
        return 0;
    }
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
    clearCachedEmbeddingsForVersion,
    hasCachedEmbeddings,
};