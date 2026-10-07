import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const desktop = vi.hoisted(() => ({ value: true }))
vi.mock('@/platform', () => ({ isDesktop: () => desktop.value, platform: {} }))

const resourceDir = vi.fn(async () => '/Applications/Selah.app/Contents/Resources')
const convertFileSrc = vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`)
vi.mock('@tauri-apps/api/path', () => ({ resourceDir }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc }))

import { hasEmbeddingPack, resetPackBaseUrlCache } from '../embeddingPackLoader'
import { EMBEDDING_GEMMA, MINILM } from '../embeddingModel'

const BUNDLED_MANIFEST = '/embedding-packs/WEB/manifest.json'
const RESOURCES = '/Applications/Selah.app/Contents/Resources'
const DESKTOP_PACK = `asset://localhost/${encodeURIComponent(`${RESOURCES}/semantic-packs/WEB/`)}manifest.json`
const SIDE_LOADED_PACK = `asset://localhost/${encodeURIComponent(`${RESOURCES}/assets/embedding-packs/WEB/`)}manifest.json`

const miniLmPack = { version: 'WEB', dim: MINILM.dimensions, count: 31100, modelName: MINILM.id }
const gemmaPack = { version: 'WEB', dim: EMBEDDING_GEMMA.dimensions, count: 31100, modelName: EMBEDDING_GEMMA.id }

function manifestResponse(body: unknown) {
    return { ok: true, json: async () => body } as unknown as Response
}

const missing = { ok: false, json: async () => ({}) } as unknown as Response

/** Serve `packs` by manifest URL; everything else 404s. */
function serve(packs: Record<string, unknown>) {
    const fetchMock = vi.fn(async (url: string) => (url in packs ? manifestResponse(packs[url]) : missing))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

describe('embedding pack base URL resolution', () => {
    beforeEach(() => {
        desktop.value = true
        resetPackBaseUrlCache()
        // No IndexedDB cache, so every check goes through the HTTP probe.
        // happy-dom's indexedDB never completes the initial open, so refuse it
        // outright — the loader treats a throwing open as "no cache".
        if (typeof indexedDB !== 'undefined') {
            vi.spyOn(indexedDB, 'open').mockImplementation(() => {
                throw new Error('indexedDB unavailable in this test')
            })
        }
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    describe('desktop (EmbeddingGemma)', () => {
        it('finds the bundled EmbeddingGemma pack, passing over the MiniLM one', async () => {
            // A release carries both: the web's MiniLM pack rides along in the
            // frontend bundle. Scoring EmbeddingGemma queries against it would
            // rank verses at random, so it must not win for being probed first.
            const fetchMock = serve({ [BUNDLED_MANIFEST]: miniLmPack, [DESKTOP_PACK]: gemmaPack })
            expect(await hasEmbeddingPack('WEB')).toBe(true)
            expect(fetchMock).toHaveBeenCalledWith(DESKTOP_PACK)
            expect(fetchMock).not.toHaveBeenCalledWith(SIDE_LOADED_PACK)
        })

        it('falls back to a locally built pack', async () => {
            serve({ [BUNDLED_MANIFEST]: miniLmPack, [SIDE_LOADED_PACK]: { ...gemmaPack, count: 90000 } })
            expect(await hasEmbeddingPack('WEB')).toBe(true)
        })

        it('reports absence when only MiniLM packs exist', async () => {
            // Including one from before packs recorded their model.
            const { modelName: _unrecorded, ...legacy } = miniLmPack
            serve({ [BUNDLED_MANIFEST]: miniLmPack, [SIDE_LOADED_PACK]: legacy })
            expect(await hasEmbeddingPack('WEB')).toBe(false)
        })
    })

    describe('web (MiniLM)', () => {
        beforeEach(() => {
            desktop.value = false
        })

        it('finds the bundled MiniLM pack', async () => {
            const fetchMock = serve({ [BUNDLED_MANIFEST]: miniLmPack })
            expect(await hasEmbeddingPack('WEB')).toBe(true)
            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(convertFileSrc).not.toHaveBeenCalled()
        })

        it('accepts a pack from before packs recorded their model', async () => {
            const { modelName: _unrecorded, ...legacy } = miniLmPack
            serve({ [BUNDLED_MANIFEST]: legacy })
            expect(await hasEmbeddingPack('WEB')).toBe(true)
        })

        it('refuses an EmbeddingGemma pack', async () => {
            serve({ [BUNDLED_MANIFEST]: gemmaPack })
            expect(await hasEmbeddingPack('WEB')).toBe(false)
        })
    })

    it('reports absence when no candidate serves a manifest', async () => {
        serve({})
        expect(await hasEmbeddingPack('WEB')).toBe(false)
    })

    it('rejects a manifest built for a different version', async () => {
        // A mismatched manifest means the wrong pack is sitting at that path;
        // loading it would search KJV rows while claiming to be WEB.
        serve({ [BUNDLED_MANIFEST]: { ...gemmaPack, version: 'KJV' }, [DESKTOP_PACK]: { ...gemmaPack, version: 'KJV' } })
        expect(await hasEmbeddingPack('WEB')).toBe(false)
    })
})
