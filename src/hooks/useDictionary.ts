import { useCallback, useEffect, useState } from 'react'
import { getIndexedDB } from './useIndexedDB'
import {
    parseDictionaryIndex,
    normalizeDictionaryKey,
    shardForKey,
    type DictionaryIndex,
    type RawDictionaryIndex,
} from '../lib/search/dictionarySearch'
import type {
    DictionaryEntry,
    DictionaryManifest,
    DictionaryPack,
    DictionarySense,
} from '../types'

/**
 * Dictionary data served as static assets bundled with the app (web + Tauri),
 * exactly like `public/bibles/*.json`. Built by
 * `scripts/build-dictionary-packs.mjs`.
 *
 * Three kinds of file, fetched independently:
 *   manifest.json          — which packs exist (a few KB)
 *   <pack>/index.json      — every headword in the pack, no definitions
 *   <pack>/<shard>.json    — the definitions for one first letter
 *
 * Searching costs one index per pack; opening an entry costs one shard. Both
 * are cached in IndexedDB, so the second service is fully offline even if the
 * first one wasn't.
 */
const DICTIONARY_URL = '/dictionaries'

/** Pack format this client understands; a mismatch means re-fetch. */
const SUPPORTED_FORMAT = 1

/** The compact on-disk entry — see the key legend in the build script. */
interface RawDictionaryEntry {
    w: string
    s: Array<{ t: string; l?: string }>
    r?: string[]
    x?: string
    m?: string
    n?: string
}

type RawShard = Record<string, RawDictionaryEntry>

// ---------------------------------------------------------------------------
// Session caches, shared across every hook instance.
//
// Same reasoning as the Bible cache in useScripture: the panel re-renders on
// every keystroke, and re-reading a 1 MB index out of IndexedDB (plus the
// structured clone) per render is what makes a search box feel broken.
// `inFlight` collapses the concurrent first-loads that a mounting panel fires
// for several packs at once.
// ---------------------------------------------------------------------------

let manifestCache: DictionaryManifest | null = null
let manifestInFlight: Promise<DictionaryManifest | null> | null = null
const indexCache = new Map<string, DictionaryIndex>()
const indexInFlight = new Map<string, Promise<DictionaryIndex | null>>()
const shardCache = new Map<string, RawShard>()
const shardInFlight = new Map<string, Promise<RawShard | null>>()

/** Drop cached dictionary data (all of it, or one pack). Used by tests and
 *  after a pack format bump. */
export function invalidateDictionaryCache(packId?: string): void {
    if (!packId) {
        manifestCache = null
        manifestInFlight = null
        indexCache.clear()
        indexInFlight.clear()
        shardCache.clear()
        shardInFlight.clear()
        return
    }
    indexCache.delete(packId)
    indexInFlight.delete(packId)
    for (const key of [...shardCache.keys()]) {
        if (key.startsWith(`${packId}:`)) shardCache.delete(key)
    }
    for (const key of [...shardInFlight.keys()]) {
        if (key.startsWith(`${packId}:`)) shardInFlight.delete(key)
    }
}

/** Expand the compact on-disk shape into the app-facing entry. */
export function expandDictionaryEntry(
    key: string,
    packId: string,
    raw: RawDictionaryEntry,
): DictionaryEntry {
    const senses: DictionarySense[] = (raw.s ?? []).map((sense) => ({
        text: sense.t,
        ...(sense.l ? { label: sense.l } : {}),
    }))

    return {
        key,
        word: raw.w,
        packId,
        senses,
        ...(raw.r?.length ? { refs: raw.r } : {}),
        ...(raw.x ? { transliteration: raw.x } : {}),
        ...(raw.m ? { lemma: raw.m } : {}),
        ...(raw.n ? { strongs: raw.n } : {}),
    }
}

async function readCachedFile(id: string): Promise<unknown | null> {
    try {
        const cached = await getIndexedDB().dictionaries.get(id)
        if (!cached) return null
        if (cached.format !== SUPPORTED_FORMAT) return null
        return cached.data
    } catch {
        // A blocked/absent IndexedDB must not break lookups — fall through to
        // the bundled asset, which is always there.
        return null
    }
}

async function writeCachedFile(id: string, packId: string, data: unknown): Promise<void> {
    try {
        await getIndexedDB().dictionaries.put({
            id,
            packId,
            data,
            format: SUPPORTED_FORMAT,
            cachedAt: new Date().toISOString(),
        })
    } catch {
        // Caching is an optimisation; a quota error shouldn't fail the lookup.
    }
}

async function fetchJson<T>(path: string): Promise<T | null> {
    try {
        const response = await fetch(`${DICTIONARY_URL}/${path}`)
        if (!response.ok) return null
        return await response.json() as T
    } catch {
        return null
    }
}

export function useDictionary() {
    /**
     * Which packs shipped with this build. Cheap and cached — safe to call from
     * any component that needs pack names or attribution.
     */
    const loadManifest = useCallback(async (): Promise<DictionaryManifest | null> => {
        if (manifestCache) return manifestCache
        if (manifestInFlight) return manifestInFlight

        manifestInFlight = (async () => {
            const manifest = await fetchJson<DictionaryManifest>('manifest.json')
            if (!manifest?.packs?.length) {
                // No packs bundled — the caller renders an empty state rather
                // than an error. This is the expected state in a build that
                // skipped `build-dictionary-packs`.
                return null
            }
            if (manifest.format !== SUPPORTED_FORMAT) {
                console.warn(
                    `Dictionary packs are format ${manifest.format}, this build expects ${SUPPORTED_FORMAT}. Re-run scripts/build-dictionary-packs.mjs.`,
                )
                return null
            }
            return manifest
        })()

        try {
            const manifest = await manifestInFlight
            if (manifest) manifestCache = manifest
            return manifest
        } finally {
            manifestInFlight = null
        }
    }, [])

    /** A pack's headword index, ready to search. */
    const loadIndex = useCallback(async (packId: string): Promise<DictionaryIndex | null> => {
        const inMemory = indexCache.get(packId)
        if (inMemory) return inMemory

        const pending = indexInFlight.get(packId)
        if (pending) return pending

        const load = (async (): Promise<DictionaryIndex | null> => {
            const id = `${packId}:index`
            const cached = await readCachedFile(id) as RawDictionaryIndex | null
            if (cached?.entries) return parseDictionaryIndex(cached)

            const raw = await fetchJson<RawDictionaryIndex>(`${packId}/index.json`)
            if (!raw?.entries) {
                console.error(`Dictionary index missing for pack ${packId}`)
                return null
            }
            await writeCachedFile(id, packId, raw)
            return parseDictionaryIndex(raw)
        })()

        indexInFlight.set(packId, load)
        try {
            const index = await load
            if (index) indexCache.set(packId, index)
            return index
        } finally {
            indexInFlight.delete(packId)
        }
    }, [])

    const loadShard = useCallback(async (packId: string, shard: string): Promise<RawShard | null> => {
        const cacheKey = `${packId}:${shard}`
        const inMemory = shardCache.get(cacheKey)
        if (inMemory) return inMemory

        const pending = shardInFlight.get(cacheKey)
        if (pending) return pending

        const load = (async (): Promise<RawShard | null> => {
            const cached = await readCachedFile(cacheKey) as RawShard | null
            if (cached) return cached

            const raw = await fetchJson<RawShard>(`${packId}/${shard}.json`)
            if (!raw) {
                console.error(`Dictionary shard ${shard} missing for pack ${packId}`)
                return null
            }
            await writeCachedFile(cacheKey, packId, raw)
            return raw
        })()

        shardInFlight.set(cacheKey, load)
        try {
            const raw = await load
            if (raw) shardCache.set(cacheKey, raw)
            return raw
        } finally {
            shardInFlight.delete(cacheKey)
        }
    }, [])

    /**
     * Look up one entry. `word` may be the display headword, a Strong's number
     * or anything that normalises to the same key.
     */
    const getEntry = useCallback(async (
        packId: string,
        word: string,
    ): Promise<DictionaryEntry | null> => {
        const key = normalizeDictionaryKey(word)
        if (!key) return null

        const shard = await loadShard(packId, shardForKey(key))
        const raw = shard?.[key]
        if (!raw) return null

        return expandDictionaryEntry(key, packId, raw)
    }, [loadShard])

    /** Look the same word up in every given pack, skipping packs that lack it. */
    const getEntries = useCallback(async (
        packIds: string[],
        word: string,
    ): Promise<DictionaryEntry[]> => {
        const entries = await Promise.all(packIds.map((packId) => getEntry(packId, word)))
        return entries.filter((entry): entry is DictionaryEntry => !!entry)
    }, [getEntry])

    return { loadManifest, loadIndex, loadShard, getEntry, getEntries }
}

/**
 * The bundled packs, loaded once per session.
 *
 * `packs` is empty until the manifest resolves — and stays empty in a build
 * with no dictionary assets, which callers should render as "no dictionaries
 * installed" rather than an error.
 */
export function useDictionaryPacks(): { packs: DictionaryPack[]; loading: boolean } {
    const { loadManifest } = useDictionary()
    const [packs, setPacks] = useState<DictionaryPack[]>(manifestCache?.packs ?? [])
    const [loading, setLoading] = useState(!manifestCache)

    useEffect(() => {
        let cancelled = false

        loadManifest().then((manifest) => {
            if (cancelled) return
            setPacks(manifest?.packs ?? [])
            setLoading(false)
        })

        return () => { cancelled = true }
    }, [loadManifest])

    return { packs, loading }
}
