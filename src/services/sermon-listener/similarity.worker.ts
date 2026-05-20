/**
 * Similarity Search Worker
 *
 * Holds a *packed* `Float32Array` of shape (N × D) for all loaded verse
 * embeddings, plus a parallel metadata array. Cosine similarity is computed
 * in a single tight loop with zero per-iteration allocation, completely off
 * the main thread.
 *
 * This replaces the previous flow where every search materialised an
 * intermediate `{ ...v, score }` object per verse on the main thread —
 * 31k+ allocations per keystroke, plus an O(n log n) sort, plus a Map
 * deduplication. For KJV with verse fragments enabled (~120k rows), the
 * main thread was spending 80-150 ms per query just on GC.
 *
 * Wire protocol
 * -------------
 *  Setup (one-time per version):
 *    { kind: 'setEmbeddings', version, dim, packed: Float32Array, metadata: VerseMeta[] }
 *      where `packed` is transferred (zero-copy) and consumed in-place.
 *
 *  Search:
 *    { id, kind: 'search', queryEmbedding: Float32Array, threshold, limit }
 *      → { id, results: VerseMatch[] }
 *
 *  Clear:
 *    { kind: 'clear' }
 *
 * Assumes embeddings are L2-normalised (transformers.js does this by default
 * for feature-extraction with `normalize: true`, which is what we pass), so
 * cosine similarity reduces to a dot product.
 */

interface VerseMeta {
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
    text: string
}

interface VerseMatch extends VerseMeta {
    score: number
}

interface SetEmbeddingsMessage {
    kind: 'setEmbeddings'
    version: string
    dim: number
    packed: Float32Array
    metadata: VerseMeta[]
}

interface SearchMessage {
    id: number
    kind: 'search'
    queryEmbedding: Float32Array
    threshold: number
    limit: number
}

interface ClearMessage {
    kind: 'clear'
}

interface PingMessage {
    id: number
    kind: 'ping'
}

type IncomingMessage = SetEmbeddingsMessage | SearchMessage | ClearMessage | PingMessage

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let packed: Float32Array | null = null
let metadata: VerseMeta[] = []
let dim = 0
let loadedVersion: string | null = null

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
    const msg = event.data

    if (msg.kind === 'setEmbeddings') {
        packed = msg.packed
        metadata = msg.metadata
        dim = msg.dim
        loadedVersion = msg.version
        return
    }

    if (msg.kind === 'clear') {
        packed = null
        metadata = []
        dim = 0
        loadedVersion = null
        return
    }

    if (msg.kind === 'ping') {
        self.postMessage({
            id: msg.id,
            ready: packed !== null,
            count: metadata.length,
            version: loadedVersion,
            dim,
        })
        return
    }

    if (msg.kind === 'search') {
        const out = runSearch(msg.queryEmbedding, msg.threshold, msg.limit)
        self.postMessage({ id: msg.id, results: out })
        return
    }
}

// ---------------------------------------------------------------------------
// Top-K cosine similarity over the packed Float32Array
// ---------------------------------------------------------------------------

function runSearch(query: Float32Array, threshold: number, limit: number): VerseMatch[] {
    if (!packed || metadata.length === 0 || query.length !== dim) {
        return []
    }

    // We over-fetch (limit × 4) before deduplicating fragments back to a
    // single best score per base reference. This mirrors the previous
    // behavior in `findSimilarLocally`.
    const overFetch = Math.max(limit * 4, 32)

    // Min-heap-like array, but for K ≤ 64 a linear scan is faster than a
    // proper heap. We keep an array of {score, idx} sorted by score asc and
    // bump the smallest out when a better candidate arrives.
    const topScores: number[] = []
    const topIdxs: number[] = []

    const total = metadata.length
    for (let i = 0; i < total; i++) {
        const offset = i * dim
        // Inline dot product. Both vectors are L2-normalised so this == cosine.
        let dot = 0
        for (let d = 0; d < dim; d++) {
            dot += query[d] * packed[offset + d]
        }

        if (dot < threshold) continue

        if (topScores.length < overFetch) {
            topScores.push(dot)
            topIdxs.push(i)
            continue
        }

        // Find the worst current top-K entry.
        let worstAt = 0
        let worstVal = topScores[0]
        for (let k = 1; k < topScores.length; k++) {
            if (topScores[k] < worstVal) {
                worstVal = topScores[k]
                worstAt = k
            }
        }
        if (dot > worstVal) {
            topScores[worstAt] = dot
            topIdxs[worstAt] = i
        }
    }

    // Materialise and dedupe by base reference (strip "__fragmentIdx" suffix).
    const bestPerRef = new Map<string, VerseMatch>()
    for (let k = 0; k < topIdxs.length; k++) {
        const meta = metadata[topIdxs[k]]
        const score = topScores[k]
        const baseRef = meta.reference.includes('__') ? meta.reference.split('__')[0] : meta.reference
        const existing = bestPerRef.get(baseRef)
        if (!existing || score > existing.score) {
            bestPerRef.set(baseRef, {
                reference: baseRef,
                book: meta.book,
                bookNumber: meta.bookNumber,
                chapter: meta.chapter,
                verse: meta.verse,
                text: meta.text,
                score,
            })
        }
    }

    const out = [...bestPerRef.values()]
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, limit)
}

// Export to satisfy the bundler that this is a module.
export {}
