/**
 * Local Embeddings Service
 *
 * Provides client-side text embeddings using Transformers.js via a Web Worker.
 * This keeps ONNX inference off the main thread so the UI stays responsive.
 *
 * Architecture:
 * - Worker loads Xenova/all-MiniLM-L6-v2 model (22MB, quantized)
 * - Generates 384-dimensional embeddings
 * - Works offline after initial model download
 * - Model is cached in browser storage
 */

export interface EmbeddingResult {
    embedding: number[]
    dimensions: number
}

export interface VerseMatch {
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
    text: string
    score: number
}

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
const EMBEDDING_DIMENSIONS = 384

// ---------------------------------------------------------------------------
// Web Worker singleton
// ---------------------------------------------------------------------------

interface WorkerSuccessResponse {
    id: number
    embeddings: number[][]
    dimensions: number
}

interface WorkerErrorResponse {
    id: number
    error: string
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse

function isErrorResponse(r: WorkerResponse): r is WorkerErrorResponse {
    return 'error' in r
}

let workerInstance: Worker | null = null
let nextRequestId = 0
const pending = new Map<number, { resolve: (v: WorkerSuccessResponse) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
    if (workerInstance) return workerInstance

    // Vite handles module workers automatically with this URL pattern
    workerInstance = new Worker(new URL('./embedding.worker.ts', import.meta.url), { type: 'module' })

    workerInstance.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const res = event.data
        const handler = pending.get(res.id)
        if (!handler) return
        pending.delete(res.id)
        if (isErrorResponse(res)) {
            handler.reject(new Error(res.error))
        } else {
            handler.resolve(res)
        }
    }

    workerInstance.onerror = (err) => {
        console.error('[Embeddings] Worker error:', err)
        // Reject all pending
        for (const [, h] of pending) {
            h.reject(new Error('Worker failed'))
        }
        pending.clear()
    }

    return workerInstance
}

function postToWorker(texts: string[]): Promise<WorkerSuccessResponse> {
    const worker = getWorker()
    const id = ++nextRequestId
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, texts })
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if the embedding worker is alive.
 */
export function isEmbedderReady(): boolean {
    return workerInstance !== null
}

/**
 * Initialise the worker (triggers model download in the worker).
 */
export async function initializeEmbedder(): Promise<{
    ready: boolean
    dimensions: number
    modelName: string
}> {
    try {
        await postToWorker([]) // empty batch just warms up the model
        return { ready: true, dimensions: EMBEDDING_DIMENSIONS, modelName: MODEL_NAME }
    } catch (error) {
        console.error('[Embeddings] Failed to initialize worker:', error)
        return { ready: false, dimensions: 0, modelName: MODEL_NAME }
    }
}

/**
 * Generate an embedding for a single text.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
    const res = await postToWorker([text])
    const embedding = res.embeddings[0]
    if (!embedding) throw new Error('Worker returned empty embedding')
    return { embedding, dimensions: res.dimensions }
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return []
    const res = await postToWorker(texts)
    return res.embeddings.map((emb) => ({ embedding: emb, dimensions: res.dimensions }))
}

/**
 * Calculate cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Vector dimensions don't match: ${a.length} vs ${b.length}`)
    }

    let dotProduct = 0
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i]
    }
    return dotProduct
}

/**
 * Find the most similar verses from a pre-computed set.
 */
export function findSimilarLocally(
    queryEmbedding: number[],
    verseEmbeddings: Array<{
        reference: string
        book: string
        bookNumber: number
        chapter: number
        verse: number
        text: string
        embedding: number[]
    }>,
    threshold = 0.75,
    limit = 5,
): VerseMatch[] {
    const scores = verseEmbeddings.map((v) => {
        const baseRef = v.reference.includes('__') ? v.reference.split('__')[0] : v.reference
        return {
            ...v,
            reference: baseRef,
            score: cosineSimilarity(queryEmbedding, v.embedding),
        }
    })

    scores.sort((a, b) => b.score - a.score)

    const bestPerRef = new Map<string, VerseMatch>()
    for (const s of scores) {
        if (s.score < threshold) continue
        const existing = bestPerRef.get(s.reference)
        if (!existing || s.score > existing.score) {
            bestPerRef.set(s.reference, {
                reference: s.reference,
                book: s.book,
                bookNumber: s.bookNumber,
                chapter: s.chapter,
                verse: s.verse,
                text: s.text,
                score: s.score,
            })
        }
    }

    return [...bestPerRef.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
}

// ============================================================================
// Verse Embedding Cache (IndexedDB)
// ============================================================================

const VERSE_CACHE_DB_NAME = 'selah-verse-embeddings'
const VERSE_CACHE_STORE_NAME = 'embeddings'
const VERSE_CACHE_VERSION = 1

export interface CachedVerseEmbedding {
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
    text: string
    embedding: number[]
    version: string
    cachedAt: number
    fragmentType?: string
    fragmentIndex?: number
    embeddingVersion?: string
}

async function openVerseCache(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(VERSE_CACHE_DB_NAME, VERSE_CACHE_VERSION)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains(VERSE_CACHE_STORE_NAME)) {
                const store = db.createObjectStore(VERSE_CACHE_STORE_NAME, { keyPath: 'reference' })
                store.createIndex('by_book', 'book')
                store.createIndex('by_version', 'version')
            }
        }
    })
}

export async function getCachedVerseEmbeddings(version?: string): Promise<CachedVerseEmbedding[]> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readonly')
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME)
        const request = version ? store.index('by_version').getAll(version) : store.getAll()
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    } catch (error) {
        console.error('[Embeddings] Failed to get cached embeddings:', error)
        return []
    }
}

export async function cacheVerseEmbeddings(embeddings: CachedVerseEmbedding[], chunkSize = 500): Promise<void> {
    if (embeddings.length === 0) return
    for (let i = 0; i < embeddings.length; i += chunkSize) {
        const chunk = embeddings.slice(i, i + chunkSize)
        const db = await openVerseCache()
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readwrite')
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME)
        for (const embedding of chunk) {
            store.put({ ...embedding, cachedAt: Date.now() })
        }
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    }
}

export async function clearCachedVerseEmbeddings(): Promise<void> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readwrite')
        tx.objectStore(VERSE_CACHE_STORE_NAME).clear()
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        console.error('[Embeddings] Failed to clear cache:', error)
    }
}

export async function hasCachedEmbeddings(version: string): Promise<boolean> {
    const cached = await getCachedVerseEmbeddings(version)
    return cached.length > 0
}

export async function clearCachedEmbeddingsForVersion(version: string): Promise<number> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readwrite')
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME)
        const index = store.index('by_version')
        const request = index.openCursor(IDBKeyRange.only(version))
        let deleted = 0
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                    cursor.delete()
                    deleted++
                    cursor.continue()
                } else {
                    resolve(deleted)
                }
            }
            request.onerror = () => reject(request.error)
        })
    } catch (error) {
        console.error('[Embeddings] Failed to clear cached embeddings for version:', error)
        return 0
    }
}

export async function getLocalCachedVersions(): Promise<string[]> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readonly')
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME)
        const index = store.index('by_version')
        const versions = new Set<string>()
        return new Promise((resolve, reject) => {
            const request = index.openKeyCursor()
            request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                    versions.add(cursor.key as string)
                    cursor.continue()
                } else {
                    resolve(Array.from(versions))
                }
            }
            request.onerror = () => reject(request.error)
        })
    } catch (error) {
        console.error('[Embeddings] Failed to get cached versions:', error)
        return []
    }
}

export async function hasFragmentEmbeddings(version: string): Promise<boolean> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readonly')
        const store = tx.objectStore(VERSE_CACHE_STORE_NAME)
        const index = store.index('by_version')
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(version))
            let checked = 0
            request.onsuccess = () => {
                const cursor = request.result
                if (cursor) {
                    checked++
                    const row = cursor.value as CachedVerseEmbedding
                    if (row.fragmentType || row.reference.includes('__')) {
                        resolve(true)
                        return
                    }
                    if (checked < 20) {
                        cursor.continue()
                    } else {
                        resolve(false)
                    }
                } else {
                    resolve(false)
                }
            }
            request.onerror = () => reject(request.error)
        })
    } catch (error) {
        console.error('[Embeddings] Failed to check fragment embeddings:', error)
        return false
    }
}

// ---------------------------------------------------------------------------
// Pre-warm helpers
// ---------------------------------------------------------------------------

let prewarmPromise: Promise<void> | null = null
const prewarmedEmbeddings = new Map<string, CachedVerseEmbedding[]>()

export function prewarmSemanticSearch(): Promise<void> {
    if (prewarmPromise) return prewarmPromise
    prewarmPromise = (async () => {
        try {
            const [, versions] = await Promise.all([initializeEmbedder(), getLocalCachedVersions()])
            if (versions.length > 0) {
                const embeddings = await getCachedVerseEmbeddings(versions[0])
                prewarmedEmbeddings.set(versions[0], embeddings)
            }
        } catch {
            // Pre-warm is best-effort
        }
    })()
    return prewarmPromise
}

export function getPrewarmedEmbeddings(version: string): CachedVerseEmbedding[] | null {
    return prewarmedEmbeddings.get(version) || null
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
    hasFragmentEmbeddings,
    getLocalCachedVersions,
    prewarmSemanticSearch,
    getPrewarmedEmbeddings,
}