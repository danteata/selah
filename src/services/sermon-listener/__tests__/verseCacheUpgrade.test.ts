import { describe, it, expect, beforeEach, vi } from 'vitest'

// A real IndexedDB (the shared setup installs a stub).
await vi.hoisted(async () => {
    const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb')
    const win = globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown }
    win.indexedDB = new IDBFactory()
    win.IDBKeyRange = IDBKeyRange
})
import { getCachedVerseEmbeddings } from '../localEmbeddings'

/** Create the cache database at `version` holding one row, as an older build would. */
function seed(version: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('selah-verse-embeddings', version)
        req.onupgradeneeded = () => {
            const db = req.result
            const store = db.createObjectStore('embeddings', { keyPath: 'reference' })
            store.createIndex('by_book', 'book')
            store.createIndex('by_version', 'version')
            db.createObjectStore('sync-progress', { keyPath: 'versionId' })
            store.put({ reference: 'John 3:16', book: 'John', bookNumber: 43, chapter: 3, verse: 16, text: '', embedding: [0], version: 'NIV', cachedAt: 0 })
        }
        req.onsuccess = () => { req.result.close(); resolve() }
        req.onerror = () => reject(req.error)
    })
}

describe('verse embedding cache upgrade', () => {
    // A fresh, empty IndexedDB per test: the module under test keeps its
    // connection open, which would block deleting a shared database.
    beforeEach(async () => {
        const { IDBFactory } = await import('fake-indexeddb')
        ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory()
    })

    it('clears rows written by 0.1.26 (EmbeddingGemma, database version 3)', async () => {
        await seed(3)
        expect(await getCachedVerseEmbeddings('NIV')).toEqual([])
    })

    it('keeps rows written before 0.1.26 (MiniLM, database version 2)', async () => {
        await seed(2)
        const rows = await getCachedVerseEmbeddings('NIV')
        expect(rows.map((r) => r.reference)).toEqual(['John 3:16'])
    })
})
