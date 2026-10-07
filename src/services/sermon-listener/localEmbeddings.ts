/**
 * Local Embeddings Service
 *
 * Text embeddings for semantic verse search, off the UI thread. Which model
 * runs depends on the platform (see `embeddingModel.ts`):
 * - Desktop: EmbeddingGemma 300M (768 dimensions) in the Rust backend, via
 *   the `embed_texts` command, from the model bundled with the app.
 * - Web: all-MiniLM-L6-v2 (384 dimensions) in a Web Worker through
 *   Transformers.js, cached in browser storage after the first download.
 *
 * Callers say whether each text is a query, a document (a verse) or a
 * clustering input; EmbeddingGemma prefixes each kind differently, and the
 * prefix is added here so neither backend has to know about it.
 */

import { activeEmbeddingModel, EMBEDDING_GEMMA, withTaskPrefix, type EmbeddingKind } from './embeddingModel'

export type { EmbeddingKind }

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

/** Desktop embeds natively; see `embedNative`. */
function usesNativeEmbedder(): boolean {
    return activeEmbeddingModel().id === EMBEDDING_GEMMA.id
}

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
let setupPromise: Promise<void> | null = null
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
        // Discard the broken worker (and its setup) so the next request builds
        // a fresh one. Kept, one crash disabled semantic detection for the
        // rest of the service: every later embed went to a dead worker.
        disposeEmbedder()
    }

    return workerInstance
}

/**
 * Send the one-time setup message to the worker. The worker only runs on the
 * web (desktop embeds natively), where it fetches MiniLM from the Hugging Face
 * Hub and caches it in browser storage. The promise is cached so concurrent
 * embed calls don't race the configuration.
 */
function ensureWorkerSetup(): Promise<void> {
    if (setupPromise) return setupPromise
    setupPromise = (async () => {
        const worker = getWorker()
        // No bundled model path: the worker falls back to the Hub.
        const localModelPath = null
        const id = ++nextRequestId
        await withTimeout(new Promise<void>((resolve, reject) => {
            pending.set(id, {
                resolve: () => resolve(),
                reject,
            })
            worker.postMessage({ id, setup: { localModelPath } })
        }), id)
    })()
    // A failed setup must not stay cached: that rejected every later embed.
    setupPromise.catch(() => { setupPromise = null })
    return setupPromise
}

// Generous: the first request waits for the model to download and load.
const WORKER_REQUEST_TIMEOUT_MS = 120_000

/**
 * Give up on a request the worker never answers, and replace the worker —
 * it is presumed hung. Without this, a search whose reply never came left
 * the semantic detector waiting for it forever.
 */
function withTimeout<T>(request: Promise<T>, id: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            if (!pending.has(id)) return
            pending.delete(id)
            console.warn('[Embeddings] Worker did not answer; restarting it')
            disposeEmbedder()
            reject(new Error('Embedding worker timed out'))
        }, WORKER_REQUEST_TIMEOUT_MS)
    })
    return Promise.race([request, timeout]).finally(() => clearTimeout(timer))
}

function postToWorker(texts: string[]): Promise<WorkerSuccessResponse> {
    return ensureWorkerSetup().then(() => {
        const worker = getWorker()
        const id = ++nextRequestId
        return withTimeout(new Promise<WorkerSuccessResponse>((resolve, reject) => {
            pending.set(id, { resolve, reject })
            worker.postMessage({ id, texts })
        }), id)
    })
}

// ---------------------------------------------------------------------------
// Native embedder (desktop)
// ---------------------------------------------------------------------------

let nativeLoaded = false

/**
 * Embed with EmbeddingGemma in the Rust backend. The vectors come back as raw
 * little-endian f32 bytes (an ArrayBuffer), `texts.length × 768` of them. An
 * empty list just loads the model.
 */
async function embedNative(texts: string[]): Promise<number[][]> {
    const { invoke } = await import('@tauri-apps/api/core')
    const bytes = await invoke<ArrayBuffer>('embed_texts', { texts })
    nativeLoaded = true
    const dim = EMBEDDING_GEMMA.dimensions
    const flat = new Float32Array(bytes)
    if (flat.length !== texts.length * dim) {
        throw new Error(`Native embedder returned ${flat.length} floats for ${texts.length} texts`)
    }
    const rows: number[][] = []
    for (let i = 0; i < texts.length; i++) rows.push(Array.from(flat.subarray(i * dim, (i + 1) * dim)))
    return rows
}

/** Embed already-prefixed texts with whichever backend this platform uses. */
async function embedPrefixed(texts: string[]): Promise<{ embeddings: number[][]; dimensions: number }> {
    if (usesNativeEmbedder()) {
        return { embeddings: await embedNative(texts), dimensions: EMBEDDING_GEMMA.dimensions }
    }
    return postToWorker(texts)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if the embedding worker is alive.
 */
export function isEmbedderReady(): boolean {
    return usesNativeEmbedder() ? nativeLoaded : workerInstance !== null
}

/**
 * Tear down the embedding worker and free the in-memory model. Safe to call
 * when idle; the next embed call transparently re-creates the worker and
 * reloads the (browser/Tauri-cached) model. Used by the sync manager's idle
 * unload timer to reclaim memory between syncs (item #3).
 */
export function disposeEmbedder(): void {
    if (usesNativeEmbedder()) {
        if (!nativeLoaded) return
        nativeLoaded = false
        void import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('embeddings_unload'))
            .catch(() => { /* unloading is best-effort */ })
        return
    }
    if (!workerInstance) return
    try {
        workerInstance.terminate()
    } catch {
        /* terminate is best-effort */
    }
    workerInstance = null
    setupPromise = null
    // Fail any in-flight requests rather than leaving them to hang forever.
    for (const [, h] of pending) {
        h.reject(new Error('Embedding worker disposed'))
    }
    pending.clear()
}

/**
 * Load the model (on web, the first call downloads it).
 */
export async function initializeEmbedder(): Promise<{
    ready: boolean
    dimensions: number
    modelName: string
}> {
    const model = activeEmbeddingModel()
    try {
        await embedPrefixed([]) // an empty batch just loads the model
        return { ready: true, dimensions: model.dimensions, modelName: model.id }
    } catch (error) {
        console.error('[Embeddings] Failed to load the embedding model:', error)
        return { ready: false, dimensions: 0, modelName: model.id }
    }
}

/**
 * Generate an embedding for a single text. `kind` is required: with
 * EmbeddingGemma a query and a verse embedded the same way land measurably
 * further apart.
 */
export async function embedText(text: string, kind: EmbeddingKind): Promise<EmbeddingResult> {
    const res = await embedPrefixed([withTaskPrefix(text, kind)])
    const embedding = res.embeddings[0]
    if (!embedding) throw new Error('Embedder returned no embedding')
    return { embedding, dimensions: res.dimensions }
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function embedBatch(texts: string[], kind: EmbeddingKind): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return []
    const res = await embedPrefixed(texts.map((t) => withTaskPrefix(t, kind)))
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
 * @deprecated Use `searchVerseEmbeddings()` from `verseEmbeddingStore` instead —
 * the similarity worker runs off-thread and uses packed Float32Array for performance.
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

/**
 * Verse embeddings generated on this device. One database per model, so
 * vectors from different embedding spaces never meet: MiniLM's (web, and
 * desktop before 0.1.29) keep the original name, EmbeddingGemma's (desktop)
 * have their own.
 */
const MINILM_VERSE_CACHE_DB_NAME = 'selah-verse-embeddings'
const GEMMA_VERSE_CACHE_DB_NAME = 'selah-verse-embeddings-embeddinggemma'

function verseCacheDbName(): string {
    return usesNativeEmbedder() ? GEMMA_VERSE_CACHE_DB_NAME : MINILM_VERSE_CACHE_DB_NAME
}
const VERSE_CACHE_STORE_NAME = 'embeddings'
const SYNC_PROGRESS_STORE_NAME = 'sync-progress'
/**
 * For the MiniLM database. 4: release 0.1.26 embedded with EmbeddingGemma and moved it to
 * version 3; 0.1.27 went back to MiniLM, because EmbeddingGemma grew the
 * webview past macOS's 8 GB limit within minutes. A database can't be reopened
 * at a lower version, so this moves forward to 4 — and clears the rows only a
 * version-3 database can hold: EmbeddingGemma vectors, which MiniLM queries
 * can't be compared with. Rows from before 0.1.26 (version 2) are kept.
 */
const VERSE_CACHE_VERSION = 4

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

export interface SyncProgressRecord {
    versionId: string
    lastVerseIndex: number
    totalVerses: number
    withFragments: boolean
    startedAt: number
    updatedAt: number
}

/**
 * On desktop, the MiniLM database holds vectors today's queries can't be
 * compared with. Removed once, the first time the EmbeddingGemma one opens.
 */
function dropMiniLmCacheOnDesktop(): void {
    try {
        indexedDB.deleteDatabase(MINILM_VERSE_CACHE_DB_NAME)
    } catch {
        // Best-effort: it is unused on desktop either way.
    }
}

async function openVerseCache(): Promise<IDBDatabase> {
    const name = verseCacheDbName()
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, name === GEMMA_VERSE_CACHE_DB_NAME ? 1 : VERSE_CACHE_VERSION)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (name === GEMMA_VERSE_CACHE_DB_NAME && event.oldVersion === 0) {
                dropMiniLmCacheOnDesktop()
            }
            if (name === MINILM_VERSE_CACHE_DB_NAME && event.oldVersion === 3) {
                for (const name of [VERSE_CACHE_STORE_NAME, SYNC_PROGRESS_STORE_NAME]) {
                    if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
                }
            }
            if (!db.objectStoreNames.contains(VERSE_CACHE_STORE_NAME)) {
                const store = db.createObjectStore(VERSE_CACHE_STORE_NAME, { keyPath: 'reference' })
                store.createIndex('by_book', 'book')
                store.createIndex('by_version', 'version')
            }
            if (!db.objectStoreNames.contains(SYNC_PROGRESS_STORE_NAME)) {
                db.createObjectStore(SYNC_PROGRESS_STORE_NAME, { keyPath: 'versionId' })
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

export async function countCachedEmbeddings(version: string): Promise<number> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readonly')
        const index = tx.objectStore(VERSE_CACHE_STORE_NAME).index('by_version')
        return new Promise((resolve, reject) => {
            const request = index.count(IDBKeyRange.only(version))
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    } catch (error) {
        console.error('[Embeddings] Failed to count cached embeddings:', error)
        return 0
    }
}

/**
 * Memoized `hasCachedEmbeddings`. The live-transcription path asks this once
 * per candidate window — dozens of times per utterance — and each miss was a
 * fresh IndexedDB open plus an index cursor in the hot path. Generated rows
 * only appear/disappear via the sync manager, which calls
 * `invalidateCachedEmbeddingsLookup` when they do.
 */
const cachedEmbeddingsLookup = new Map<string, boolean>()

export function invalidateCachedEmbeddingsLookup(version?: string): void {
    if (version) {
        cachedEmbeddingsLookup.delete(version)
        return
    }
    cachedEmbeddingsLookup.clear()
}

export async function hasCachedEmbeddingsMemo(version: string): Promise<boolean> {
    const known = cachedEmbeddingsLookup.get(version)
    if (known !== undefined) return known
    const result = await hasCachedEmbeddings(version)
    cachedEmbeddingsLookup.set(version, result)
    return result
}

export async function hasCachedEmbeddings(version: string): Promise<boolean> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(VERSE_CACHE_STORE_NAME, 'readonly')
        const index = tx.objectStore(VERSE_CACHE_STORE_NAME).index('by_version')
        return new Promise((resolve, reject) => {
            const request = index.openKeyCursor(IDBKeyRange.only(version))
            request.onsuccess = () => resolve(request.result !== null)
            request.onerror = () => reject(request.error)
        })
    } catch (error) {
        console.error('[Embeddings] Failed to check cached embeddings:', error)
        return false
    }
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
// Sync progress persistence
// ---------------------------------------------------------------------------

export async function getSyncProgress(versionId: string): Promise<SyncProgressRecord | null> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(SYNC_PROGRESS_STORE_NAME, 'readonly')
        const store = tx.objectStore(SYNC_PROGRESS_STORE_NAME)
        const request = store.get(versionId)
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result ?? null)
            request.onerror = () => reject(request.error)
        })
    } catch {
        return null
    }
}

export async function saveSyncProgress(record: SyncProgressRecord): Promise<void> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(SYNC_PROGRESS_STORE_NAME, 'readwrite')
        const store = tx.objectStore(SYNC_PROGRESS_STORE_NAME)
        store.put({ ...record, updatedAt: Date.now() })
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch {
        // Best-effort persistence
    }
}

export async function clearSyncProgress(versionId: string): Promise<void> {
    try {
        const db = await openVerseCache()
        const tx = db.transaction(SYNC_PROGRESS_STORE_NAME, 'readwrite')
        const store = tx.objectStore(SYNC_PROGRESS_STORE_NAME)
        store.delete(versionId)
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch {
        // Best-effort
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
            // Kick off model load + cached-version probe in parallel.
            const [, versions] = await Promise.all([initializeEmbedder(), getLocalCachedVersions()])

            // Try the universal prebuilt pack first — on desktop this is an
            // O(load-time) memory-map of a Float32Array, which is much faster
            // than walking IndexedDB row-by-row and rebuilding number[]
            // buffers. `semanticPack` picks which pack (WEB, else KJV); it
            // serves every version, so there's nothing to preload per-version.
            // Failure to load the pack is silent; we always have the IDB path.
            try {
                const { loadSemanticPack } = await import('./semanticPack')
                const result = await loadSemanticPack()
                if (result.ok) {
                    console.log(`[Embeddings] Loaded prebuilt ${result.version} pack for semantic search`)
                    return // Pack is now in the worker; no need to read IDB.
                }
            } catch {
                // Pack loader is best-effort.
            }

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
    getSyncProgress,
    saveSyncProgress,
    clearSyncProgress,
    prewarmSemanticSearch,
    getPrewarmedEmbeddings,
}