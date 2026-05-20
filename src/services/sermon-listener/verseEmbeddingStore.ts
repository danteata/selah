/**
 * Verse Embedding Store
 *
 * Main-thread bridge to the similarity search worker. Owns:
 *   - The currently-loaded version's packed Float32Array (after handoff
 *     to the worker the main thread releases its reference).
 *   - Pending search promises keyed by request id.
 *
 * The store is a singleton; downstream callers (`useSemanticVerseSearch`,
 * `SemanticVerseDetector`) don't manage workers directly.
 *
 * Why bother with a separate Float32Array packed layout?
 *
 *   - 31 000 verses × 384 dims × 8 bytes (number[]) ≈ 95 MB JS heap. With
 *     fragment mode (~120 000 rows) this hits 370 MB and the GC starts
 *     thrashing on every search.
 *   - The same data as a flat `Float32Array` is 47 MB / 184 MB respectively
 *     and lives in a contiguous backing buffer — branch-predictor friendly,
 *     pre-fetcher friendly, and the JS engine can vectorize the dot product.
 *   - Transferred (zero-copy) to the worker, so neither thread keeps a
 *     duplicate.
 */

import type { CachedVerseEmbedding } from './localEmbeddings'

// ---------------------------------------------------------------------------
// Types mirroring the worker's wire protocol
// ---------------------------------------------------------------------------

export interface VerseMeta {
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
    text: string
}

export interface VerseMatch extends VerseMeta {
    score: number
}

interface SearchResponse {
    id: number
    results: VerseMatch[]
}

interface PingResponse {
    id: number
    ready: boolean
    count: number
    version: string | null
    dim: number
}

// ---------------------------------------------------------------------------
// Worker singleton
// ---------------------------------------------------------------------------

let workerInstance: Worker | null = null
let nextRequestId = 0
const pending = new Map<number, (data: unknown) => void>()

function getWorker(): Worker {
    if (workerInstance) return workerInstance

    workerInstance = new Worker(new URL('./similarity.worker.ts', import.meta.url), { type: 'module' })

    workerInstance.onmessage = (event: MessageEvent<SearchResponse | PingResponse>) => {
        const data = event.data
        const handler = pending.get(data.id)
        if (!handler) return
        pending.delete(data.id)
        handler(data)
    }

    workerInstance.onerror = (err) => {
        console.error('[VerseEmbeddingStore] Worker error:', err)
        for (const [, h] of pending) {
            h({ id: -1, results: [] })
        }
        pending.clear()
    }

    return workerInstance
}

// ---------------------------------------------------------------------------
// State (main-thread side)
// ---------------------------------------------------------------------------

interface LoadedIndex {
    version: string
    count: number
    dim: number
    /** Strip "__fragmentIdx" suffix into base reference for fragment dedupe. */
    hasFragments: boolean
}

let loaded: LoadedIndex | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return what's currently loaded, or null if the store is empty. */
export function getLoadedIndex(): LoadedIndex | null {
    return loaded
}

/** Drop the in-memory index and tell the worker to release its buffer. */
export function clearIndex(): void {
    if (!loaded) return
    const worker = getWorker()
    worker.postMessage({ kind: 'clear' })
    loaded = null
}

/**
 * Pack an array of `CachedVerseEmbedding` rows into a single Float32Array
 * and hand it to the worker. The original `number[]` embeddings are no
 * longer referenced after this call so V8 can reclaim the (~95 MB) heap.
 *
 * Returns true if the load succeeded (i.e. at least one verse had a valid
 * embedding of the expected dimension).
 */
export function loadFromCached(
    version: string,
    rows: CachedVerseEmbedding[],
): boolean {
    if (rows.length === 0) return false

    // Sniff dimensions from the first row with a non-empty embedding.
    let dim = 0
    for (const r of rows) {
        if (r.embedding && r.embedding.length > 0) {
            dim = r.embedding.length
            break
        }
    }
    if (dim === 0) {
        console.warn('[VerseEmbeddingStore] No usable embedding found in input rows')
        return false
    }

    const N = rows.length
    const packed = new Float32Array(N * dim)
    const metadata: VerseMeta[] = new Array(N)
    let hasFragments = false

    for (let i = 0; i < N; i++) {
        const r = rows[i]
        const emb = r.embedding
        if (!emb || emb.length !== dim) {
            // Skip malformed rows but keep the slot zeroed (will score ~0).
            metadata[i] = {
                reference: r.reference,
                book: r.book,
                bookNumber: r.bookNumber,
                chapter: r.chapter,
                verse: r.verse,
                text: r.text,
            }
            continue
        }
        // Copy into the packed buffer. `set` is the fastest path the JS
        // engine can take here — it boils down to a memcpy on number arrays.
        packed.set(emb, i * dim)
        metadata[i] = {
            reference: r.reference,
            book: r.book,
            bookNumber: r.bookNumber,
            chapter: r.chapter,
            verse: r.verse,
            text: r.text,
        }
        if (!hasFragments && (r.fragmentType || r.reference.includes('__'))) {
            hasFragments = true
        }
    }

    const worker = getWorker()
    // Transfer the underlying ArrayBuffer — zero-copy, the main thread
    // immediately loses access to `packed` after this line.
    worker.postMessage(
        { kind: 'setEmbeddings', version, dim, packed, metadata },
        [packed.buffer],
    )

    loaded = { version, count: N, dim, hasFragments }
    return true
}

/**
 * Bind a pre-built embedding pack directly. Used by the bundled KJV pack
 * loader which reads a binary `.bin` file from disk. The buffer is
 * transferred and consumed by the worker.
 */
export function loadFromPackedBuffer(opts: {
    version: string
    dim: number
    packed: Float32Array
    metadata: VerseMeta[]
}): boolean {
    if (opts.metadata.length === 0 || opts.packed.length !== opts.metadata.length * opts.dim) {
        console.warn('[VerseEmbeddingStore] Pack dimensions do not match metadata count')
        return false
    }
    const worker = getWorker()
    worker.postMessage(
        {
            kind: 'setEmbeddings',
            version: opts.version,
            dim: opts.dim,
            packed: opts.packed,
            metadata: opts.metadata,
        },
        [opts.packed.buffer],
    )
    const hasFragments = opts.metadata.some(
        (m) => m.reference.includes('__'),
    )
    loaded = { version: opts.version, count: opts.metadata.length, dim: opts.dim, hasFragments }
    return true
}

/**
 * Top-K cosine similarity search against the currently-loaded index.
 *
 * Falls back to an empty result set (with a warning) if nothing is loaded.
 * The query vector is converted to Float32Array on the way in so the worker
 * can run the tight inner loop on aligned floats.
 */
export async function searchVerseEmbeddings(
    queryEmbedding: number[] | Float32Array,
    threshold = 0.38,
    limit = 5,
): Promise<VerseMatch[]> {
    if (!loaded) {
        return []
    }
    const worker = getWorker()
    const query = queryEmbedding instanceof Float32Array
        ? queryEmbedding
        : Float32Array.from(queryEmbedding)

    if (query.length !== loaded.dim) {
        console.warn(
            `[VerseEmbeddingStore] Query dim ${query.length} != index dim ${loaded.dim}`,
        )
        return []
    }

    const id = ++nextRequestId
    return new Promise<VerseMatch[]>((resolve) => {
        pending.set(id, (data) => {
            const res = data as SearchResponse
            resolve(res.results || [])
        })
        worker.postMessage({ id, kind: 'search', queryEmbedding: query, threshold, limit })
    })
}

/**
 * Lightweight diagnostic — confirm the worker is alive and report what it
 * thinks it has loaded. Useful for the Studio Status pill (Phase 5).
 */
export async function pingWorker(): Promise<PingResponse> {
    const worker = getWorker()
    const id = ++nextRequestId
    return new Promise<PingResponse>((resolve) => {
        pending.set(id, (data) => resolve(data as PingResponse))
        worker.postMessage({ id, kind: 'ping' })
    })
}
