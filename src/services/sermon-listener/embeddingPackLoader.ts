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
 * Two places a pack can live, probed in this order by `resolvePackBaseUrl`:
 *  - `/embedding-packs/<VERSION>/` — `public/embedding-packs`, so it is part of
 *    the frontend bundle and reachable both on the web and inside the Tauri
 *    webview (exactly like `/bibles` and `/dictionaries`). Canonical verses
 *    only, int8-quantized (`embeddings.i8`, ~11 MB) so the browser can download
 *    it once, cache it in IndexedDB, and search offline. This is the pack that
 *    ships in releases — built by `scripts/build-web-embedding-pack.mjs`.
 *  - `src-tauri/assets/embedding-packs/<VERSION>/` bundled as Tauri resources
 *    and read via `asset://`. Optional and desktop-only: a bigger float32
 *    verses+fragments pack for whoever places one there (fragments help
 *    short-phrase / paraphrase hits during live transcription). Absent from
 *    releases, so the bundled path above must work on its own.
 *
 * manifest.json: { version, dim, count, quantization?: 'int8', scale?, ... }
 * Embeddings are L2-normalised so cosine == dot product. int8 packs store
 * round(x*scale); we dequantize with q/scale on load.
 */

import { isDesktop } from '../../platform'
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

interface CachedPack {
    version: string
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
            req.onsuccess = () => resolve((req.result as CachedPack) ?? null)
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
 * Every place this version's pack might live, best-supported first. The
 * frontend-bundled path comes first because it is the one that actually ships:
 * `public/embedding-packs` lands in the build output, which both the web app and
 * the Tauri webview serve from the app origin. The Tauri resource dir is only a
 * fallback for a side-loaded pack — declaring it in `tauri.conf.json` does not
 * put a pack there, and for a long time nothing did, so desktop reported "no
 * pack" and every version offered "Enable Search" as if search were off.
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
            candidates.push(convertFileSrc(`${root}${sep}assets/embedding-packs/${version}/`))
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
 * a matching manifest. Only the universal packs listed in
 * `semanticPack.SEMANTIC_PACK_PREFERENCE` ship; anything else 404s everywhere,
 * which is how `hasEmbeddingPack` reports absence.
 */
async function resolvePackBaseUrl(version: string): Promise<string | null> {
    const cached = baseUrlCache.get(version)
    if (cached !== undefined) return cached

    let resolved: string | null = null
    for (const base of await packBaseUrlCandidates(version)) {
        const manifest = await fetchJson<PackManifest>(`${base}manifest.json`)
        if (manifest && manifest.version === version) {
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
            dim: manifest.dim,
            quantization: manifest.quantization,
            scale: manifest.scale,
            metadata,
            embeddings: raw,
        })
    }

    return { ok: true, version: manifest.version, count: manifest.count }
}
