/**
 * Embedding Pack Loader
 *
 * Loads a *prebuilt* verse embedding pack from disk (desktop) or HTTP (web)
 * and hands the packed `Float32Array` to the similarity worker. This avoids
 * the multi-minute first-run embedding generation entirely.
 *
 * Pack layout (under `src-tauri/assets/embedding-packs/<VERSION>/`):
 *
 *   manifest.json
 *     { version: "KJV", dim: 384, count: 31102,
 *       modelName: "Xenova/all-MiniLM-L6-v2", builtAt: "2026-05-18T..." }
 *
 *   metadata.json
 *     [{ reference, book, bookNumber, chapter, verse, text }, ...]
 *     // count items, in the same order as the binary
 *
 *   embeddings.f32
 *     Raw little-endian Float32 buffer of length count × dim × 4 bytes.
 *     Embeddings are L2-normalised so cosine similarity == dot product.
 *
 * On desktop the three files are bundled as Tauri resources and read via
 * the `asset://` protocol. On web the loader falls back to the relative
 * URL `/embedding-packs/<VERSION>/...`, which can be served from the
 * static site host if the operator wants instant search on the browser
 * build too. In practice the pack is desktop-only — the web build keeps
 * doing on-demand IndexedDB caching.
 */

import { isDesktop } from '../../platform'
import { loadFromPackedBuffer, type VerseMeta } from './verseEmbeddingStore'

interface PackManifest {
    version: string
    dim: number
    count: number
    modelName?: string
    builtAt?: string
}

interface LoadResult {
    ok: boolean
    version?: string
    count?: number
    error?: string
}

/**
 * Resolve the base URL where the pack files live for a given version.
 * Returns null if neither the desktop bundle nor the web fallback exists.
 */
async function resolvePackBaseUrl(version: string): Promise<string | null> {
    if (typeof window === 'undefined') return null

    if (isDesktop()) {
        try {
            const [{ resourceDir }, { convertFileSrc }] = await Promise.all([
                import('@tauri-apps/api/path'),
                import('@tauri-apps/api/core'),
            ])
            const root = await resourceDir()
            const sep = root.endsWith('/') || root.endsWith('\\') ? '' : '/'
            // The trailing slash matters — we'll join filenames onto it.
            return convertFileSrc(`${root}${sep}assets/embedding-packs/${version}/`)
        } catch {
            return null
        }
    }

    // Web fallback. Operators can drop the same files under `public/` and
    // they'll be served from the site origin.
    return `/embedding-packs/${version}/`
}

async function fetchManifest(baseUrl: string): Promise<PackManifest | null> {
    try {
        const res = await fetch(`${baseUrl}manifest.json`)
        if (!res.ok) return null
        return (await res.json()) as PackManifest
    } catch {
        return null
    }
}

async function fetchMetadata(baseUrl: string): Promise<VerseMeta[] | null> {
    try {
        const res = await fetch(`${baseUrl}metadata.json`)
        if (!res.ok) return null
        return (await res.json()) as VerseMeta[]
    } catch {
        return null
    }
}

async function fetchEmbeddings(baseUrl: string): Promise<Float32Array | null> {
    try {
        const res = await fetch(`${baseUrl}embeddings.f32`)
        if (!res.ok) return null
        const buf = await res.arrayBuffer()
        // Zero-copy view over the response buffer.
        return new Float32Array(buf)
    } catch {
        return null
    }
}

/**
 * Try to load a prebuilt embedding pack for the given version. If any of
 * the three files (manifest, metadata, embeddings) is missing the function
 * resolves with `{ ok: false }` and the caller can fall back to the
 * IndexedDB-cached embeddings (or kick off a fresh sync).
 *
 * Loading is idempotent: if the worker already holds the right version
 * the function short-circuits and returns success without re-reading
 * disk.
 */
export async function tryLoadEmbeddingPack(version: string): Promise<LoadResult> {
    const baseUrl = await resolvePackBaseUrl(version)
    if (!baseUrl) return { ok: false, error: 'no pack base url' }

    const manifest = await fetchManifest(baseUrl)
    if (!manifest) return { ok: false, error: 'manifest missing' }
    if (manifest.version !== version) {
        return { ok: false, error: `manifest version ${manifest.version} != requested ${version}` }
    }

    const [metadata, packed] = await Promise.all([
        fetchMetadata(baseUrl),
        fetchEmbeddings(baseUrl),
    ])
    if (!metadata) return { ok: false, error: 'metadata missing' }
    if (!packed) return { ok: false, error: 'embeddings binary missing' }

    if (metadata.length !== manifest.count) {
        return {
            ok: false,
            error: `metadata count ${metadata.length} != manifest count ${manifest.count}`,
        }
    }
    if (packed.length !== manifest.count * manifest.dim) {
        return {
            ok: false,
            error: `packed length ${packed.length} != count×dim ${manifest.count * manifest.dim}`,
        }
    }

    const ok = loadFromPackedBuffer({
        version: manifest.version,
        dim: manifest.dim,
        packed,
        metadata,
    })
    if (!ok) return { ok: false, error: 'worker rejected pack' }

    return { ok: true, version: manifest.version, count: manifest.count }
}
