import Dexie, { type Table } from 'dexie'
import type { Song, Media, LibraryItem, Scripture, Hymn } from '../types'

export interface LocalTemplate {
    id: string
    name: string
    description?: string
    slideId: string
    category: string
    appliesTo?: string[]
    thumbnail?: string
    backgroundStorageId?: string
    createdBy?: string
    favoritedBy?: string[]
    createdAt: string
    updatedAt: string
    synced?: boolean
    serverId?: string
}

export interface CachedAuthSession {
    id: string
    clerkId: string
    email: string
    fullname: string
    role: string
    avatar: string
    churchId: string
    churchName: string
    cachedAt: string
}

export interface CachedChurch {
    id: string
    serverId: string
    name: string
    type: string
    address: string
    pastor: string
    cachedAt: string
}

export interface CachedSetting {
    id: string
    data: any
    cachedAt: string
}

export interface PendingMutation {
    id?: number
    mutationName: string
    args: Record<string, unknown>
    status: 'pending' | 'completed' | 'failed'
    createdAt: string
    retryCount: number
    localId?: string
}

export interface LocalSermonCorrection {
    id: string
    sermonSessionId?: string
    reference: string
    originalReference?: string
    correctionType: 'missed' | 'wrong-verse' | 'wrong-book'
    closestRawText?: string
    timestamp: number
    synced: boolean
    createdAt: string
}

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
    authSessions!: Table<CachedAuthSession, string>
    churches!: Table<CachedChurch, string>
    appSettings!: Table<CachedSetting, string>
    pendingMutations!: Table<PendingMutation, number>
    localTemplates!: Table<LocalTemplate, string>
    sermonCorrections!: Table<LocalSermonCorrection, string>

    constructor() {
        super('WorshipCloudDatabase')
        this.version(2).stores({
            songs: 'id,lyrics,title,album,cover,artist,verses,createdAt,updatedAt',
            media: 'id,content,data,createdAt,updatedAt',
            library: 'id,type,content,createdAt,updatedAt',
            cached: 'id,content,data,createdAt,updatedAt',
            bibleAndHymns: 'id,data,createdAt,updatedAt'
        })
        this.version(3).stores({
            songs: 'id,lyrics,title,album,cover,artist,verses,createdAt,updatedAt',
            media: 'id,content,data,createdAt,updatedAt',
            library: 'id,type,content,createdAt,updatedAt',
            cached: 'id,content,data,createdAt,updatedAt',
            bibleAndHymns: 'id,data,createdAt,updatedAt',
            authSessions: 'id,clerkId,email,cachedAt',
            churches: 'id,serverId,name,cachedAt',
            appSettings: 'id,cachedAt',
            pendingMutations: '++id,status,createdAt,mutationName'
        })
        this.version(4).stores({
            songs: 'id,lyrics,title,album,cover,artist,verses,createdAt,updatedAt',
            media: 'id,content,data,createdAt,updatedAt',
            library: 'id,type,content,createdAt,updatedAt',
            cached: 'id,content,data,createdAt,updatedAt',
            bibleAndHymns: 'id,data,createdAt,updatedAt',
            authSessions: 'id,clerkId,email,cachedAt',
            churches: 'id,serverId,name,cachedAt',
            appSettings: 'id,cachedAt',
            pendingMutations: '++id,status,createdAt,mutationName',
            localTemplates: 'id,category,createdAt,updatedAt,synced'
        })
        this.version(5).stores({
            sermonCorrections: 'id,synced,createdAt,sermonSessionId'
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

// Auth session caching
export async function cacheAuthSession(session: Omit<CachedAuthSession, 'cachedAt'>): Promise<void> {
    const db = getIndexedDB()
    await db.authSessions.put({
        ...session,
        cachedAt: new Date().toISOString(),
    })
}

export async function getCachedAuthSession(): Promise<CachedAuthSession | undefined> {
    const db = getIndexedDB()
    const all = await db.authSessions.toArray()
    return all.sort((a, b) => new Date(b.cachedAt).getTime() - new Date(a.cachedAt).getTime())[0]
}

export async function clearCachedAuthSession(): Promise<void> {
    const db = getIndexedDB()
    await db.authSessions.clear()
}

// Church caching
export async function cacheChurch(church: { _id: string; name: string; type: string; address: string; pastor: string }): Promise<void> {
    const db = getIndexedDB()
    await db.churches.put({
        id: church._id,
        serverId: church._id,
        name: church.name,
        type: church.type,
        address: church.address,
        pastor: church.pastor,
        cachedAt: new Date().toISOString(),
    })
}

export async function getCachedChurch(churchId: string): Promise<CachedChurch | undefined> {
    const db = getIndexedDB()
    return await db.churches.get(churchId)
}

export async function getAllCachedChurches(): Promise<CachedChurch[]> {
    const db = getIndexedDB()
    return await db.churches.toArray()
}

// App settings caching
export async function cacheAppSetting(id: string, data: any): Promise<void> {
    const db = getIndexedDB()
    await db.appSettings.put({
        id,
        data,
        cachedAt: new Date().toISOString(),
    })
}

export async function getCachedAppSetting(id: string): Promise<CachedSetting | undefined> {
    const db = getIndexedDB()
    return await db.appSettings.get(id)
}

// Pending mutations
export async function addPendingMutation(mutation: Omit<PendingMutation, 'id'>): Promise<number> {
    const db = getIndexedDB()
    return await db.pendingMutations.add(mutation as PendingMutation)
}

export async function getPendingMutations(): Promise<PendingMutation[]> {
    const db = getIndexedDB()
    return await db.pendingMutations
        .where('status')
        .equals('pending')
        .sortBy('createdAt')
}

export async function updatePendingMutation(id: number, updates: Partial<PendingMutation>): Promise<void> {
    const db = getIndexedDB()
    await db.pendingMutations.update(id, updates)
}

export async function clearCompletedMutations(): Promise<void> {
    const db = getIndexedDB()
    await db.pendingMutations
        .where('status')
        .equals('completed')
        .delete()
}

export async function clearAllPendingMutations(): Promise<void> {
    const db = getIndexedDB()
    await db.pendingMutations.clear()
}

// Local templates (offline support)
export async function saveLocalTemplate(template: LocalTemplate): Promise<void> {
    const db = getIndexedDB()
    await db.localTemplates.put({
        ...template,
        updatedAt: new Date().toISOString(),
    })
}

export async function getLocalTemplates(): Promise<LocalTemplate[]> {
    const db = getIndexedDB()
    return await db.localTemplates.toArray()
}

export async function getLocalTemplate(id: string): Promise<LocalTemplate | undefined> {
    const db = getIndexedDB()
    return await db.localTemplates.get(id)
}

export async function deleteLocalTemplate(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.localTemplates.delete(id)
}

export async function updateLocalTemplate(id: string, updates: Partial<LocalTemplate>): Promise<void> {
    const db = getIndexedDB()
    await db.localTemplates.update(id, {
        ...updates,
        updatedAt: new Date().toISOString(),
    })
}

export async function saveSermonCorrection(correction: LocalSermonCorrection): Promise<void> {
    const db = getIndexedDB()
    await db.sermonCorrections.put(correction)
}

export async function getSermonCorrections(sessionId?: string): Promise<LocalSermonCorrection[]> {
    const db = getIndexedDB()
    if (sessionId) {
        return await db.sermonCorrections.where('sermonSessionId').equals(sessionId).toArray()
    }
    return await db.sermonCorrections.toArray()
}

export async function getUnsyncedCorrections(): Promise<LocalSermonCorrection[]> {
    const db = getIndexedDB()
    return await db.sermonCorrections.where('synced').equals(0).toArray()
}

export async function markCorrectionSynced(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.sermonCorrections.update(id, { synced: true })
}

export async function deleteSermonCorrection(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.sermonCorrections.delete(id)
}

export async function clearSermonCorrections(): Promise<void> {
    const db = getIndexedDB()
    await db.sermonCorrections.clear()
}
