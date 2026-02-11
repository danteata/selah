import Dexie, { type Table } from 'dexie'
import type { Song, Media, LibraryItem, Scripture, Hymn } from '../types'

class WorshipCloudDatabase extends Dexie {
    songs!: Table<Song>
    media!: Table<Media>
    library!: Table<LibraryItem, string>
    cached!: Table<Media>
    bibleAndHymns!: Table<{
        id: string
        data: Array<Scripture | Hymn>
        createdAt: string
        updatedAt: string
    }>

    constructor() {
        super('WorshipCloudDatabase')
        this.version(2).stores({
            songs: 'id,lyrics,title,album,cover,artist,verses,createdAt,updatedAt',
            media: 'id,content,data,createdAt,updatedAt',
            library: 'id,type,content,createdAt,updatedAt',
            cached: 'id,content,data,createdAt,updatedAt',
            bibleAndHymns: 'id,data,createdAt,updatedAt'
        })
    }
}

// Singleton instance to avoid creating multiple connections
let dbInstance: WorshipCloudDatabase | null = null

export function getIndexedDB(): WorshipCloudDatabase {
    if (!dbInstance) {
        dbInstance = new WorshipCloudDatabase()
    }
    return dbInstance
}

export function useIndexedDB(): WorshipCloudDatabase {
    return getIndexedDB()
}

// Helper functions for common operations
export async function saveSongToDB(song: Song): Promise<void> {
    const db = getIndexedDB()
    await db.songs.put({
        ...song,
        updatedAt: new Date().toISOString()
    })
}

export async function getSongFromDB(id: string): Promise<Song | undefined> {
    const db = getIndexedDB()
    return await db.songs.get(id)
}

export async function saveLibraryItem(item: LibraryItem): Promise<void> {
    const db = getIndexedDB()
    await db.library.put({
        ...item,
        updatedAt: new Date().toISOString()
    })
}

export async function getLibraryItem(id: string): Promise<LibraryItem | undefined> {
    const db = getIndexedDB()
    return await db.library.get(id)
}

export async function deleteLibraryItem(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.library.delete(id)
}

export async function saveMedia(media: Media): Promise<void> {
    const db = getIndexedDB()
    await db.media.put({
        ...media,
        updatedAt: new Date().toISOString()
    })
}

export async function getMedia(id: string): Promise<Media | undefined> {
    const db = getIndexedDB()
    return await db.media.get(id)
}

export async function deleteMedia(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.media.delete(id)
}

export async function getHymns(): Promise<Hymn[] | undefined> {
    const db = getIndexedDB()
    const result = await db.bibleAndHymns.get('hymns')
    return result?.data as unknown as Hymn[] | undefined
}

export async function getBible(version: string): Promise<Scripture[] | undefined> {
    const db = getIndexedDB()
    const result = await db.bibleAndHymns.get(version)
    return result?.data as unknown as Scripture[] | undefined
}

export async function saveBibleAndHymns(
    id: string,
    data: Array<Scripture | Hymn>
): Promise<void> {
    const db = getIndexedDB()
    const now = new Date().toISOString()

    const existing = await db.bibleAndHymns.get(id)

    if (existing) {
        await db.bibleAndHymns.put({
            ...existing,
            data,
            updatedAt: now
        })
    } else {
        await db.bibleAndHymns.add({
            id,
            data,
            createdAt: now,
            updatedAt: now
        })
    }
}
