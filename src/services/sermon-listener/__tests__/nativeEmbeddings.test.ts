import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/platform', () => ({ isDesktop: () => true, platform: {} }))

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { disposeEmbedder, embedBatch, embedText, initializeEmbedder, isEmbedderReady } from '../localEmbeddings'
import { EMBEDDING_GEMMA } from '../embeddingModel'

const DIM = EMBEDDING_GEMMA.dimensions

/** What `embed_texts` returns: row i filled with i + 1, as raw f32 bytes. */
function vectorsFor(texts: string[]): ArrayBuffer {
    const flat = new Float32Array(texts.length * DIM)
    texts.forEach((_, i) => flat.fill(i + 1, i * DIM, (i + 1) * DIM))
    return flat.buffer
}

describe('desktop embeddings (native EmbeddingGemma)', () => {
    beforeEach(() => {
        invoke.mockReset()
        invoke.mockImplementation(async (cmd: string, args?: { texts: string[] }) =>
            cmd === 'embed_texts' ? vectorsFor(args!.texts) : undefined,
        )
        disposeEmbedder()
    })

    it('sends each text with its task prefix and splits the vectors back out', async () => {
        const out = await embedBatch(['God so loved the world', 'the Lord is my shepherd'], 'query')
        expect(invoke).toHaveBeenCalledWith('embed_texts', {
            texts: [
                'task: search result | query: God so loved the world',
                'task: search result | query: the Lord is my shepherd',
            ],
        })
        expect(out).toHaveLength(2)
        expect(out[0].dimensions).toBe(DIM)
        expect(out[0].embedding).toHaveLength(DIM)
        expect(out[1].embedding.every((x) => x === 2)).toBe(true)
    })

    it('prefixes verses as documents', async () => {
        await embedText('In the beginning', 'document')
        expect(invoke).toHaveBeenCalledWith('embed_texts', { texts: ['title: none | text: In the beginning'] })
    })

    it('reports the model it loaded, and unloads it on dispose', async () => {
        expect(isEmbedderReady()).toBe(false)
        expect(await initializeEmbedder()).toEqual({ ready: true, dimensions: DIM, modelName: EMBEDDING_GEMMA.id })
        expect(invoke).toHaveBeenCalledWith('embed_texts', { texts: [] })
        expect(isEmbedderReady()).toBe(true)

        disposeEmbedder()
        expect(isEmbedderReady()).toBe(false)
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('embeddings_unload'))
    })

    it('rejects a reply of the wrong size rather than misaligning vectors', async () => {
        invoke.mockImplementation(async () => new Float32Array(DIM).buffer)
        await expect(embedBatch(['one', 'two'], 'query')).rejects.toThrow(/768 floats for 2 texts/)
    })

    it('reports a model that fails to load as not ready', async () => {
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'embed_texts') throw 'embedding model not bundled'
        })
        const status = await initializeEmbedder()
        expect(status.ready).toBe(false)
    })
})
