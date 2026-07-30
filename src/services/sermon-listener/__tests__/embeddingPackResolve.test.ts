import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Desktop is the interesting case: it is the build where the pack was reported
// missing even though one shipped.
vi.mock('@/platform', () => ({ isDesktop: () => true, platform: {} }))

const resourceDir = vi.fn(async () => '/Applications/Selah.app/Contents/Resources')
const convertFileSrc = vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`)
vi.mock('@tauri-apps/api/path', () => ({ resourceDir }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc }))

import { hasEmbeddingPack, resetPackBaseUrlCache } from '../embeddingPackLoader'

const BUNDLED_MANIFEST = '/embedding-packs/WEB/manifest.json'

function manifestResponse(body: unknown) {
    return { ok: true, json: async () => body } as unknown as Response
}

const missing = { ok: false, json: async () => ({}) } as unknown as Response

describe('embedding pack base URL resolution', () => {
    beforeEach(() => {
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

    it('finds the frontend-bundled pack on desktop', async () => {
        // The regression this pins: releases ship public/embedding-packs (served
        // from the app origin inside the Tauri webview) and nothing under the
        // Tauri resource dir. Resolving only the resource dir made every desktop
        // user look like they had no pack, so Bible settings offered "Enable
        // Search" on versions the shared index already covered.
        const fetchMock = vi.fn(async (url: string) =>
            url === BUNDLED_MANIFEST ? manifestResponse({ version: 'WEB', dim: 384, count: 31100 }) : missing,
        )
        vi.stubGlobal('fetch', fetchMock)

        expect(await hasEmbeddingPack('WEB')).toBe(true)
        expect(fetchMock).toHaveBeenCalledWith(BUNDLED_MANIFEST)
    })

    it('prefers the bundled pack over a side-loaded resource pack', async () => {
        const fetchMock = vi.fn(async () => manifestResponse({ version: 'WEB', dim: 384, count: 31100 }))
        vi.stubGlobal('fetch', fetchMock)

        expect(await hasEmbeddingPack('WEB')).toBe(true)
        // First candidate answered, so the asset:// probe never happens.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith(BUNDLED_MANIFEST)
    })

    it('falls back to a side-loaded resource pack when nothing is bundled', async () => {
        const fetchMock = vi.fn(async (url: string) =>
            url.startsWith('asset://') ? manifestResponse({ version: 'WEB', dim: 384, count: 90000 }) : missing,
        )
        vi.stubGlobal('fetch', fetchMock)

        expect(await hasEmbeddingPack('WEB')).toBe(true)
        expect(fetchMock).toHaveBeenCalledWith(BUNDLED_MANIFEST)
        expect(convertFileSrc).toHaveBeenCalledWith(
            '/Applications/Selah.app/Contents/Resources/assets/embedding-packs/WEB/',
        )
    })

    it('reports absence when no candidate serves a matching manifest', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => missing))
        expect(await hasEmbeddingPack('WEB')).toBe(false)
    })

    it('rejects a manifest built for a different version', async () => {
        // A mismatched manifest means the wrong pack is sitting at that path;
        // loading it would search KJV rows while claiming to be WEB.
        vi.stubGlobal('fetch', vi.fn(async () => manifestResponse({ version: 'KJV', dim: 384, count: 31100 })))
        expect(await hasEmbeddingPack('WEB')).toBe(false)
    })
})
