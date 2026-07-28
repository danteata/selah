import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    hasEmbeddingPack: vi.fn(async (version: string) => version === '__none__'),
    tryLoadEmbeddingPack: vi.fn(async (version: string) => ({ ok: true, version, count: 10 })),
}))

vi.mock('../embeddingPackLoader', () => mocks)

import {
    SEMANTIC_PACK_PREFERENCE,
    resolveSemanticPackVersion,
    getResolvedSemanticPackVersion,
    hasSemanticPack,
    loadSemanticPack,
    resetSemanticPackResolution,
} from '../semanticPack'

/** Make only the named packs "present" on this install. */
function packsPresent(...versions: string[]) {
    mocks.hasEmbeddingPack.mockImplementation(async (v: string) => versions.includes(v))
}

describe('semanticPack resolution', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetSemanticPackResolution()
        packsPresent()
    })

    it('prefers WEB over KJV for the universal index', async () => {
        // Modern-English queries retrieve better against modern-English verse
        // text, so WEB must win whenever both packs are installed.
        expect(SEMANTIC_PACK_PREFERENCE[0]).toBe('WEB')
        packsPresent('WEB', 'KJV')
        expect(await resolveSemanticPackVersion()).toBe('WEB')
    })

    it('falls back to KJV when the preferred pack is absent', async () => {
        packsPresent('KJV')
        expect(await resolveSemanticPackVersion()).toBe('KJV')
    })

    it('reports null — not a throw — when no pack is installed', async () => {
        expect(await resolveSemanticPackVersion()).toBeNull()
        expect(await hasSemanticPack()).toBe(false)
    })

    it('treats a probe failure as "not available" and keeps going', async () => {
        mocks.hasEmbeddingPack.mockImplementation(async (v: string) => {
            if (v === 'WEB') throw new Error('offline')
            return v === 'KJV'
        })
        expect(await resolveSemanticPackVersion()).toBe('KJV')
    })

    it('probes once and caches, including for concurrent callers', async () => {
        packsPresent('WEB')
        const [a, b] = await Promise.all([resolveSemanticPackVersion(), resolveSemanticPackVersion()])
        expect(a).toBe('WEB')
        expect(b).toBe('WEB')
        await resolveSemanticPackVersion()
        // One probe for WEB total — not one per call.
        expect(mocks.hasEmbeddingPack).toHaveBeenCalledTimes(1)
    })

    it('exposes the resolved id synchronously only after a probe', async () => {
        packsPresent('WEB')
        expect(getResolvedSemanticPackVersion()).toBeNull()
        await resolveSemanticPackVersion()
        expect(getResolvedSemanticPackVersion()).toBe('WEB')
    })

    it('loads the resolved pack into the worker', async () => {
        packsPresent('WEB')
        expect(await loadSemanticPack()).toEqual({ ok: true, version: 'WEB' })
        expect(mocks.tryLoadEmbeddingPack).toHaveBeenCalledWith('WEB')
    })

    it('does not attempt a load when no pack exists', async () => {
        expect(await loadSemanticPack()).toEqual({ ok: false, version: null })
        expect(mocks.tryLoadEmbeddingPack).not.toHaveBeenCalled()
    })
})
