/**
 * Semantic Pack Resolution
 *
 * One place decides which prebuilt embedding pack backs "search by meaning".
 *
 * A pack is a *retrieval index*, not a translation the user reads. Whichever
 * pack we load answers queries for EVERY active Bible version: the matched
 * references come back from the index, and callers re-render each hit in the
 * version the user is actually reading (`searchVerses` / the dense retriever
 * in `useSemanticVerseSearch`). So downloading NIV does not require embedding
 * NIV — the universal pack already covers it.
 *
 * Why WEB (World English Bible) is preferred over KJV:
 *   - Queries arrive as modern English — typed from memory, or transcribed
 *     from a preacher speaking. KJV's archaic forms ("thou hast", "verily")
 *     sit measurably further from that in MiniLM space, which costs recall
 *     for every user whose reading version isn't KJV.
 *   - WEB is a modern-English public-domain revision of the ASV, so it can be
 *     shipped without licensing cost, and it's already bundled as
 *     `public/bibles/web.json`.
 * KJV stays in the list as a fallback so an install that only has the older
 * pack keeps working.
 *
 * Naming note: "WEB" here is always the translation. The browser platform is
 * spelled out as "web"/"browser" in comments to keep the two apart.
 */

import { hasEmbeddingPack, tryLoadEmbeddingPack } from './embeddingPackLoader'

/**
 * Packs to try, best retrieval quality first. The first one actually present
 * on this install wins.
 */
export const SEMANTIC_PACK_PREFERENCE = ['WEB', 'KJV'] as const

/** Resolved pack id, `null` for "probed, none available", `undefined` for
 *  "not probed yet". Packs are static assets, so one probe per session is
 *  enough — `resetSemanticPackResolution()` exists for tests. */
let resolvedVersion: string | null | undefined
let inflight: Promise<string | null> | null = null

/**
 * Which pack should serve semantic search? Probes the preference order once
 * and caches the answer. Returns null when no pack is available at all, in
 * which case callers fall back to generated IndexedDB embeddings or Convex.
 */
export async function resolveSemanticPackVersion(): Promise<string | null> {
    if (resolvedVersion !== undefined) return resolvedVersion
    if (inflight) return inflight

    inflight = (async () => {
        for (const version of SEMANTIC_PACK_PREFERENCE) {
            try {
                if (await hasEmbeddingPack(version)) return version
            } catch {
                // Probe failures are just "not available" — try the next one.
            }
        }
        return null
    })()

    try {
        resolvedVersion = await inflight
        return resolvedVersion
    } finally {
        inflight = null
    }
}

/**
 * The already-resolved pack id without awaiting a probe. Returns null before
 * the first `resolveSemanticPackVersion()` completes, so only use this where
 * a missing answer is safe (rendering hints, cheap guards).
 */
export function getResolvedSemanticPackVersion(): string | null {
    return resolvedVersion ?? null
}

/** True when some prebuilt pack can serve semantic search for any version. */
export async function hasSemanticPack(): Promise<boolean> {
    return (await resolveSemanticPackVersion()) !== null
}

/**
 * Resolve and load the universal pack into the similarity worker. Idempotent —
 * `tryLoadEmbeddingPack` no-ops when the worker already holds the version.
 */
export async function loadSemanticPack(): Promise<{ ok: boolean; version: string | null }> {
    const version = await resolveSemanticPackVersion()
    if (!version) return { ok: false, version: null }
    const result = await tryLoadEmbeddingPack(version)
    return { ok: result.ok, version }
}

/** Test seam — drop the cached probe result. */
export function resetSemanticPackResolution(): void {
    resolvedVersion = undefined
    inflight = null
}
