import { describe, it, expect, beforeEach, vi } from 'vitest'

// A real IndexedDB, installed before Dexie loads (it captures it on import).
await vi.hoisted(async () => {
    const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb')
    const win = globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown }
    win.indexedDB = new IDBFactory()
    win.IDBKeyRange = IDBKeyRange
})
import { getIndexedDB } from '../../../hooks/useIndexedDB'
import { removeBundledNonSongs } from '../bundledSongCleanup'
import type { LibraryItem, Song } from '../../../types'

const SEEDED_AT = '2026-07-08T00:00:00.000Z'

function item(id: string, title: string, lines: string[], updatedAt = SEEDED_AT): LibraryItem {
    const content = { id, _id: id, title, lyrics: lines.join('\n'), sections: [{ id: 's', type: 'verse', lines }] } as unknown as Song
    return { id, type: 'song', content, createdAt: SEEDED_AT, updatedAt }
}

describe('removeBundledNonSongs', () => {
    beforeEach(async () => {
        localStorage.clear()
        await getIndexedDB().library.clear()
    })

    it('removes seeded non-songs and nothing else', async () => {
        const db = getIndexedDB()
        await db.library.bulkPut([
            item('ew_1', 'Church Announcement', ['Youth meeting on Saturday']),
            item('ew_2', 'Amazing Grace', ['Amazing grace how sweet the sound']),
            // Edited after seeding — the user's now, so it stays.
            item('ew_3', 'Prayer Points', ['Pray for the nation'], '2026-08-01T00:00:00.000Z'),
            // The church's own entry, never seeded.
            item('song_9', 'Sunday Announcements', ['Choir practice at four']),
        ])

        expect(await removeBundledNonSongs()).toBe(1)
        const left = (await db.library.toArray()).map((i) => i.id).sort()
        expect(left).toEqual(['ew_2', 'ew_3', 'song_9'])
    })

    it('runs once', async () => {
        await getIndexedDB().library.put(item('ew_1', 'Church Announcement', ['Youth meeting on Saturday']))
        expect(await removeBundledNonSongs()).toBe(1)
        await getIndexedDB().library.put(item('ew_4', 'Church Announcement', ['Again']))
        expect(await removeBundledNonSongs()).toBe(0)
    })
})
