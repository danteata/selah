/**
 * Embedding Pack Loader
 *
 * Loads a *prebuilt* verse embedding pack and hands the packed `Float32Array`
 * to the similarity worker. This is what replaces on-device embedding
 * generation (which took the better part of an hour per version) and, in the
 * browser, per-query Convex vector-search cost.
 *
 * `semanticPack.ts` decides WHICH pack loads. One pack serves every Bible
 * version the user reads — see that file for why.
 *
 * A pack is only usable with the model that built it: queries are scored
 * against its vectors. Web and desktop run different models (see
 * `embeddingModel.ts`), so each finds its own pack, and a pack whose manifest
 * names another model is passed over. Places a pack can live, probed in this
 * order by `resolvePackBaseUrl`:
 *  - `/embedding-packs/<VERSION>/` — `public/embedding-packs`, part of the
 *    frontend bundle. The web's MiniLM pack: canonical verses only,
 *    int8-quantized (`embeddings.i8`, ~11 MB) so the browser can download it
 *    once, cache it in IndexedDB, and search offline. It also rides along in
 *    the desktop bundle, where it is passed over.
 *  - `src-tauri/semantic-packs/<VERSION>/`, bundled as Tauri resources and read
 *    via `asset://`. Desktop's EmbeddingGemma pack (int8, ~24 MB).
 *  - `src-tauri/assets/embedding-packs/<VERSION>/`, likewise. For a pack built
 *    locally with `scripts/build-embedding-pack.mjs` (float32, optionally with
 *    fragments). Absent from releases.
 *
 * manifest.json: { version, dim, count, quantization?: 'int8', scale?, ... }
 * Embeddings are L2-normalised so cosine == dot product. int8 packs store
 * round(x*scale); we dequantize with q/scale on load.
 */

import { isDesktop } from '../../platform'
import { activeEmbeddingModel, MINILM, type EmbeddingModelSpec } from './embeddingModel'
import { loadFromPackedBuffer, type VerseMeta } from './verseEmbeddingStore'

interface PackManifest {
    version: string
    dim: number
    count: number
    quantization?: 'int8'
    scale?: number
    modelName?: string
    builtAt?: string
}

interface LoadResult {
    ok: boolean
    version?: string
    count?: number
    error?: string
}

// ---------------------------------------------------------------------------
// IndexedDB cache — so the web pack downloads once, then loads offline.
// A tiny standalone store (no Dexie schema migration needed).
// ---------------------------------------------------------------------------

const IDB_NAME = 'selah-embedding-packs'
const IDB_STORE = 'packs'

/**
 * Whether a pack was built with `model`. Packs from before the model was
 * recorded can only be MiniLM's.
 */
function builtWith(pack: { modelName?: string; dim: number }, model: EmbeddingModelSpec): boolean {
    return (pack.modelName ?? MINILM.id) === model.id && pack.dim === model.dimensions
}

interface CachedPack {
    version: string
    /** Absent on packs cached before 0.1.26; EmbeddingGemma's on 0.1.26 itself. */
    modelName?: string
    dim: number
    quantization?: 'int8'
    scale?: number
    metadata: VerseMeta[]
    /** Raw embeddings bytes exactly as fetched (int8 or float32). */
    embeddings: ArrayBuffer
}

function idbOpen(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') return resolve(null)
        try {
            const req = indexedDB.open(IDB_NAME, 1)
            req.onupgradeneeded = () => {
                const db = req.result
                if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => resolve(null)
        } catch {
            resolve(null)
        }
    })
}

async function idbGetPack(version: string): Promise<CachedPack | null> {
    const db = await idbOpen()
    if (!db) return null
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(IDB_STORE, 'readonly')
            const req = tx.objectStore(IDB_STORE).get(version)
            req.onsuccess = () => {
                const pack = (req.result as CachedPack | undefined) ?? null
                // 0.1.26 cached an EmbeddingGemma pack under the same key on
                // the web. Only a pack built with this platform's model is
                // used; the next fetch overwrites anything else.
                resolve(pack && builtWith(pack, activeEmbeddingModel()) ? pack : null)
            }
            req.onerror = () => resolve(null)
        } catch {
            resolve(null)
        } finally {
            db.close()
        }
    })
}

async function idbPutPack(pack: CachedPack): Promise<void> {
    const db = await idbOpen()
    if (!db) return
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(IDB_STORE, 'readwrite')
            tx.objectStore(IDB_STORE).put(pack, pack.version)
            tx.oncomplete = () => resolve()
            tx.onerror = () => resolve()
        } catch {
            resolve()
        } finally {
            db.close()
        }
    })
}

// ---------------------------------------------------------------------------

/**
 * Every place this version's pack might live, in probe order; the first whose
 * manifest matches the version and this platform's model wins. Desktop once
 * probed only the resource dir, where nothing shipped, so it reported "no pack"
 * and every version offered "Enable Search" as if search were off; a pack in
 * the frontend bundle is therefore always probed too.
 */
async function packBaseUrlCandidates(version: string): Promise<string[]> {
    if (typeof window === 'undefined') return []

    const candidates = [`/embedding-packs/${version}/`]

    if (isDesktop()) {
        try {
            const [{ resourceDir }, { convertFileSrc }] = await Promise.all([
                import('@tauri-apps/api/path'),
                import('@tauri-apps/api/core'),
            ])
            const root = await resourceDir()
            const sep = root.endsWith('/') || root.endsWith('\\') ? '' : '/'
            candidates.push(
                convertFileSrc(`${root}${sep}semantic-packs/${version}/`),
                convertFileSrc(`${root}${sep}assets/embedding-packs/${version}/`),
            )
        } catch {
            // No resource dir (or the API is unavailable) — the bundled path stands.
        }
    }

    return candidates
}

/** Probed base URLs. Packs are static, so one probe per version per session. */
const baseUrlCache = new Map<string, string | null>()

/**
 * Base URL where this version's pack files live, or null if no candidate serves
 * a manifest for this version built with this platform's model. Only the
 * universal packs listed in
 * `semanticPack.SEMANTIC_PACK_PREFERENCE` ship; anything else 404s everywhere,
 * which is how `hasEmbeddingPack` reports absence.
 */
async function resolvePackBaseUrl(version: string): Promise<string | null> {
    const cached = baseUrlCache.get(version)
    if (cached !== undefined) return cached

    const model = activeEmbeddingModel()
    let resolved: string | null = null
    for (const base of await packBaseUrlCandidates(version)) {
        const manifest = await fetchJson<PackManifest>(`${base}manifest.json`)
        if (manifest && manifest.version === version && builtWith(manifest, model)) {
            resolved = base
            break
        }
    }

    baseUrlCache.set(version, resolved)
    return resolved
}

/** Forget probed base URLs. For tests, and after a pack is side-loaded. */
export function resetPackBaseUrlCache(): void {
    baseUrlCache.clear()
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url)
        if (!res.ok) return null
        return (await res.json()) as T
    } catch {
        return null
    }
}

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
    try {
        const res = await fetch(url)
        if (!res.ok) return null
        return await res.arrayBuffer()
    } catch {
        return null
    }
}

/** Dequantize raw pack bytes into the L2-normalised Float32Array the worker
 *  expects. int8 → q/scale; float32 → zero-copy view. */
function toPackedFloat32(manifest: PackManifest, raw: ArrayBuffer): Float32Array {
    if (manifest.quantization === 'int8') {
        const scale = manifest.scale ?? 127
        const i8 = new Int8Array(raw)
        const packed = new Float32Array(i8.length)
        for (let i = 0; i < i8.length; i++) packed[i] = i8[i] / scale
        return packed
    }
    return new Float32Array(raw)
}

function embeddingsFileName(manifest: PackManifest): string {
    return manifest.quantization === 'int8' ? 'embeddings.i8' : 'embeddings.f32'
}

/** Cheap availability check: is a local pack usable for this version without a
 *  full download? True if it's already cached in IndexedDB or the manifest is
 *  reachable. Used to decide "local vs Convex" before doing the heavy load. */
export async function hasEmbeddingPack(version: string): Promise<boolean> {
    if (await idbGetPack(version)) return true
    // Resolving already required a matching manifest from some candidate.
    return (await resolvePackBaseUrl(version)) !== null
}

/**
 * Load a prebuilt embedding pack into the similarity worker. Tries the
 * IndexedDB cache first (offline, instant), else fetches the pack over HTTP
 * and caches it. Idempotent: if the worker already holds this version it's a
 * no-op success. Returns `{ ok: false }` (with a reason) if no pack is
 * available, so the caller can fall back to Convex.
 */
export async function tryLoadEmbeddingPack(version: string): Promise<LoadResult> {
    // 1) IndexedDB cache (web, second+ visits) — no network.
    const cached = await idbGetPack(version)
    if (cached && cached.metadata.length > 0) {
        const packed = toPackedFloat32(
            { version: cached.version, dim: cached.dim, count: cached.metadata.length, quantization: cached.quantization, scale: cached.scale },
            cached.embeddings,
        )
        const ok = loadFromPackedBuffer({ version: cached.version, dim: cached.dim, packed, metadata: cached.metadata })
        if (ok) return { ok: true, version: cached.version, count: cached.metadata.length }
    }

    // 2) Fetch over HTTP (bundled static path, or a side-loaded asset:// pack).
    const baseUrl = await resolvePackBaseUrl(version)
    if (!baseUrl) return { ok: false, error: 'no pack base url' }

    const manifest = await fetchJson<PackManifest>(`${baseUrl}manifest.json`)
    if (!manifest) return { ok: false, error: 'manifest missing' }
    if (manifest.version !== version) {
        return { ok: false, error: `manifest version ${manifest.version} != requested ${version}` }
    }

    const [metadata, raw] = await Promise.all([
        fetchJson<VerseMeta[]>(`${baseUrl}metadata.json`),
        fetchBytes(`${baseUrl}${embeddingsFileName(manifest)}`),
    ])
    if (!metadata) return { ok: false, error: 'metadata missing' }
    if (!raw) return { ok: false, error: 'embeddings binary missing' }
    if (metadata.length !== manifest.count) {
        return { ok: false, error: `metadata count ${metadata.length} != manifest count ${manifest.count}` }
    }

    const packed = toPackedFloat32(manifest, raw)
    if (packed.length !== manifest.count * manifest.dim) {
        return { ok: false, error: `packed length ${packed.length} != count×dim ${manifest.count * manifest.dim}` }
    }

    const ok = loadFromPackedBuffer({ version: manifest.version, dim: manifest.dim, packed, metadata })
    if (!ok) return { ok: false, error: 'worker rejected pack' }

    // 3) Persist to IndexedDB (web) so subsequent sessions load offline. Only
    //    worth caching the compact int8 web pack, not the ~250 MB desktop one.
    if (!isDesktop() && manifest.quantization === 'int8') {
        void idbPutPack({
            version: manifest.version,
            modelName: manifest.modelName,
            dim: manifest.dim,
            quantization: manifest.quantization,
            scale: manifest.scale,
            metadata,
            embeddings: raw,
        })
    }

    return { ok: true, version: manifest.version, count: manifest.count }
}
