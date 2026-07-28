import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Controllable mocks for the embedder so we can drive the sync manager's
// model-load guard (item #2) and idle-unload timer (item #3) deterministically.
const mocks = vi.hoisted(() => ({
    initializeEmbedder: vi.fn(),
    isEmbedderReady: vi.fn(() => false),
    disposeEmbedder: vi.fn(),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => ({ embedding: [0.1, 0.2], dimensions: 2 }))),
    cacheVerseEmbeddings: vi.fn(async () => {}),
    getCachedVerseEmbeddings: vi.fn(async () => []),
    hasCachedEmbeddings: vi.fn(async () => false),
    hasFragmentEmbeddings: vi.fn(async () => false),
    countCachedEmbeddings: vi.fn(async () => 0),
    clearCachedEmbeddingsForVersion: vi.fn(async () => 0),
    getSyncProgress: vi.fn(async () => null),
    saveSyncProgress: vi.fn(async () => {}),
    clearSyncProgress: vi.fn(async () => {}),
    invalidateCachedEmbeddingsLookup: vi.fn(),
}))

vi.mock('../localEmbeddings', () => mocks)

import { embeddingSyncManager } from '../embeddingSyncManager'
import type { BibleVerse } from '../../../types'

const oneVerse = (): Promise<BibleVerse[]> =>
    Promise.resolve([{ book: 'Genesis', chapter: '1', verse: '1', scripture: 'In the beginning' } as BibleVerse])

/** A manually-resolvable promise, for controlling init timing. */
function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

describe('embeddingSyncManager — model-load guard (item #2)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.isEmbedderReady.mockReturnValue(false)
        embeddingSyncManager.setIdleUnloadTimeout(Infinity) // disable unload for these
    })

    it('loads the embedder only once for concurrent syncs', async () => {
        const d = deferred<{ ready: boolean; dimensions: number; modelName: string }>()
        mocks.initializeEmbedder.mockReturnValue(d.promise)

        const p1 = embeddingSyncManager.startSync('versionA', oneVerse, false)
        const p2 = embeddingSyncManager.startSync('versionB', oneVerse, false)

        // Let both reach the shared init await before resolving.
        await Promise.resolve()
        d.resolve({ ready: true, dimensions: 2, modelName: 'test' })

        const [r1, r2] = await Promise.all([p1, p2])
        expect(r1.success).toBe(true)
        expect(r2.success).toBe(true)
        expect(mocks.initializeEmbedder).toHaveBeenCalledTimes(1)
    })

    it('does not leave modelLoading stuck true when init fails', async () => {
        mocks.initializeEmbedder.mockResolvedValue({ ready: false, dimensions: 0, modelName: 'test' })

        const result = await embeddingSyncManager.startSync('versionFail', oneVerse, false)

        expect(result.success).toBe(false)
        expect(embeddingSyncManager.getModelLoading()).toBe(false)
    })
})

describe('embeddingSyncManager — idle unload (item #3)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        mocks.initializeEmbedder.mockResolvedValue({ ready: true, dimensions: 2, modelName: 'test' })
        // Model reports ready after init so the idle timer arms.
        mocks.isEmbedderReady.mockReturnValue(true)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('unloads the model after the idle timeout', async () => {
        embeddingSyncManager.setIdleUnloadTimeout(60_000)

        await embeddingSyncManager.startSync('versionIdle', oneVerse, false)
        expect(mocks.disposeEmbedder).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(60_001)
        expect(mocks.disposeEmbedder).toHaveBeenCalledTimes(1)
    })

    it('unloads immediately when timeout is 0', async () => {
        embeddingSyncManager.setIdleUnloadTimeout(0)
        await embeddingSyncManager.startSync('versionImmediate', oneVerse, false)
        expect(mocks.disposeEmbedder).toHaveBeenCalledTimes(1)
    })

    it('never unloads when timeout is Infinity', async () => {
        embeddingSyncManager.setIdleUnloadTimeout(Infinity)
        await embeddingSyncManager.startSync('versionNever', oneVerse, false)
        await vi.advanceTimersByTimeAsync(10 * 60_000)
        expect(mocks.disposeEmbedder).not.toHaveBeenCalled()
    })
})
