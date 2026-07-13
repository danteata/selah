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

export interface CachedTemplateBlob {
    storageId: string
    blob: Blob
    contentType: string
    size: number
    cachedAt: number
}

export interface LocalMediaItem {
    id: string
    name: string
    type: 'image' | 'video'
    /** Desktop: absolute path under appDataDir()/media-library/, resolved via resolveLocalUrl. */
    localFilePath?: string
    /** Web: true when the bytes live in the localMediaBlobs table under this same id. */
    hasBlob?: boolean
    size: number
    contentType: string
    /** Set once this item has also been uploaded to Convex (pro cloud sync). */
    syncedMediaId?: string
    syncedStorageId?: string
    createdAt: string
    updatedAt: string
}

export interface LocalMediaBlob {
    id: string
    blob: Blob
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

export interface PersistedLiveSermonState {
    id: 'current'
    transcript: string
    segments: unknown[]
    detectedVerses: unknown[]
    currentVerse: unknown | null
    activeBibleVersion: string
    savedAt: string
}

export interface SavedSermonTranscriptRecord {
    id: string
    title: string
    transcript: string
    segments?: unknown[]
    detectedVerses?: unknown[]
    provider: string
    createdAt: string
}

export interface OfflineTranscriptRecord {
    id: string
    title: string
    transcript: string
    segments?: unknown[]
    detectedVerses?: unknown[]
    provider: string
    language?: string
    scheduleId?: string
    createdAt: string
    updatedAt: string
}

class SelahDatabase extends Dexie {
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
    sermonLiveState!: Table<PersistedLiveSermonState, 'current'>
    sermonSavedTranscripts!: Table<SavedSermonTranscriptRecord, string>
    sermonOfflineTranscripts!: Table<OfflineTranscriptRecord, string>
    templateBlobs!: Table<CachedTemplateBlob, string>
    localMedia!: Table<LocalMediaItem, string>
    localMediaBlobs!: Table<LocalMediaBlob, string>

    constructor() {
        super('SelahDatabase')
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
        this.version(6).stores({
            sermonCorrections: 'id,synced,createdAt,sermonSessionId',
            sermonLiveState: 'id,savedAt',
            sermonSavedTranscripts: 'id,createdAt',
            sermonOfflineTranscripts: 'id,scheduleId,createdAt'
        })
        this.version(7).stores({
            sermonCorrections: 'id,synced,createdAt,sermonSessionId',
            sermonLiveState: 'id,savedAt',
            sermonSavedTranscripts: 'id,createdAt',
            sermonOfflineTranscripts: 'id,scheduleId,createdAt',
            templateBlobs: 'storageId,cachedAt'
        })
        this.version(8).stores({
            localMedia: 'id,type,createdAt,syncedMediaId',
            localMediaBlobs: 'id'
        })
    }
}

// Singleton instance to avoid creating multiple connections
let dbInstance: SelahDatabase | null = null

export function getIndexedDB(): SelahDatabase {
    if (!dbInstance) {
        dbInstance = new SelahDatabase()
    }
    return dbInstance
}

export function useIndexedDB(): SelahDatabase {
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

// Sermon live state (refresh-recovery journal) ----------------

export async function getLiveSermonState(): Promise<PersistedLiveSermonState | undefined> {
    const db = getIndexedDB()
    return await db.sermonLiveState.get('current')
}

export async function saveLiveSermonState(
    state: Omit<PersistedLiveSermonState, 'id' | 'savedAt'>
): Promise<void> {
    const db = getIndexedDB()
    await db.sermonLiveState.put({
        id: 'current',
        savedAt: new Date().toISOString(),
        ...state,
    })
}

export async function clearLiveSermonState(): Promise<void> {
    const db = getIndexedDB()
    await db.sermonLiveState.clear()
}

// Saved transcripts (manual "Save…" + offline auto-save queue) -

export async function getSavedSermonTranscripts(): Promise<SavedSermonTranscriptRecord[]> {
    const db = getIndexedDB()
    return await db.sermonSavedTranscripts.orderBy('createdAt').reverse().toArray()
}

export async function saveSermonTranscript(
    record: SavedSermonTranscriptRecord
): Promise<void> {
    const db = getIndexedDB()
    await db.sermonSavedTranscripts.put(record)
}

export async function deleteSavedSermonTranscript(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.sermonSavedTranscripts.delete(id)
}

export async function clearSavedSermonTranscripts(): Promise<void> {
    const db = getIndexedDB()
    await db.sermonSavedTranscripts.clear()
}

// Offline transcripts queue (failed Convex writes) -------------

export async function getOfflineTranscripts(): Promise<OfflineTranscriptRecord[]> {
    const db = getIndexedDB()
    return await db.sermonOfflineTranscripts.orderBy('createdAt').reverse().toArray()
}

export async function addOfflineTranscript(record: OfflineTranscriptRecord): Promise<void> {
    const db = getIndexedDB()
    await db.sermonOfflineTranscripts.put(record)
}

export async function deleteOfflineTranscript(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.sermonOfflineTranscripts.delete(id)
}

export async function findOfflineTranscriptByScheduleId(
    scheduleId: string
): Promise<OfflineTranscriptRecord | undefined> {
    const db = getIndexedDB()
    return await db.sermonOfflineTranscripts.where('scheduleId').equals(scheduleId).first()
}

export async function clearOfflineTranscripts(): Promise<void> {
    const db = getIndexedDB()
    await db.sermonOfflineTranscripts.clear()
}

// Template background blob cache ---------------------------------
// After the first download from Convex, a template's background image/video
// is stored here as a Blob. Subsequent renders of the same storageId hit
// this cache and serve a local URL.createObjectURL(blob) — no Convex traffic.

export async function getCachedTemplateBlob(storageId: string): Promise<Blob | null> {
    const db = getIndexedDB()
    const entry = await db.templateBlobs.get(storageId)
    return entry?.blob ?? null
}

export async function cacheTemplateBlob(
    storageId: string,
    blob: Blob,
): Promise<void> {
    const db = getIndexedDB()
    await db.templateBlobs.put({
        storageId,
        blob,
        contentType: blob.type || 'application/octet-stream',
        size: blob.size,
        cachedAt: Date.now(),
    })
}

export async function deleteCachedTemplateBlob(storageId: string): Promise<void> {
    const db = getIndexedDB()
    await db.templateBlobs.delete(storageId)
}

// Local media library ---------------------------------------------
// Media the operator uploads is saved here by default (free, no cloud
// storage cost) — on desktop as a path to a copied-in file, on web as a
// Blob in localMediaBlobs. `syncedMediaId`/`syncedStorageId` are set once
// the item has also been pushed to Convex (pro cloud sync).

export async function saveLocalMediaItem(item: LocalMediaItem): Promise<void> {
    const db = getIndexedDB()
    await db.localMedia.put(item)
}

export async function getLocalMediaItems(): Promise<LocalMediaItem[]> {
    const db = getIndexedDB()
    return await db.localMedia.orderBy('createdAt').reverse().toArray()
}

export async function getLocalMediaItem(id: string): Promise<LocalMediaItem | undefined> {
    const db = getIndexedDB()
    return await db.localMedia.get(id)
}

export async function updateLocalMediaItem(id: string, updates: Partial<LocalMediaItem>): Promise<void> {
    const db = getIndexedDB()
    await db.localMedia.update(id, {
        ...updates,
        updatedAt: new Date().toISOString(),
    })
}

export async function deleteLocalMediaItem(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.localMedia.delete(id)
}

export async function saveLocalMediaBlob(id: string, blob: Blob): Promise<void> {
    const db = getIndexedDB()
    await db.localMediaBlobs.put({ id, blob })
}

export async function getLocalMediaBlob(id: string): Promise<Blob | null> {
    const db = getIndexedDB()
    const entry = await db.localMediaBlobs.get(id)
    return entry?.blob ?? null
}

export async function deleteLocalMediaBlob(id: string): Promise<void> {
    const db = getIndexedDB()
    await db.localMediaBlobs.delete(id)
}

// One-shot migration from old localStorage keys to IDB ----------
// Runs lazily the first time any of the new helpers are called.
// Safe to invoke multiple times: it short-circuits if the old key is gone.

const LEGACY_KEYS = {
    live: 'sermon-listener:live-state',
    saved: 'sermon-listener:saved-transcripts',
    offline: 'sermon-listener:offline-transcripts',
} as const

let migrationPromise: Promise<void> | null = null

export function migrateLegacySermonStorage(): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve()
    if (migrationPromise) return migrationPromise
    migrationPromise = (async () => {
        try {
            await migrateLiveState()
            await migrateSavedTranscripts()
            await migrateOfflineTranscripts()
        } catch (err) {
            console.warn('[IDB] Legacy sermon storage migration failed:', err)
            // Reset so a future call can retry
            migrationPromise = null
        }
    })()
    return migrationPromise
}

async function migrateLiveState(): Promise<void> {
    const raw = localStorage.getItem(LEGACY_KEYS.live)
    if (!raw) return
    try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
            const existing = await getLiveSermonState()
            if (!existing) {
                await saveLiveSermonState({
                    transcript: typeof parsed.transcript === 'string' ? parsed.transcript : '',
                    segments: Array.isArray(parsed.segments) ? parsed.segments : [],
                    detectedVerses: Array.isArray(parsed.detectedVerses) ? parsed.detectedVerses : [],
                    currentVerse: parsed.currentVerse ?? null,
                    activeBibleVersion:
                        typeof parsed.activeBibleVersion === 'string' ? parsed.activeBibleVersion : '',
                })
            }
        }
    } catch (err) {
        console.warn('[IDB] Failed to parse legacy live state, skipping:', err)
    }
    localStorage.removeItem(LEGACY_KEYS.live)
}

async function migrateSavedTranscripts(): Promise<void> {
    const raw = localStorage.getItem(LEGACY_KEYS.saved)
    if (!raw) return
    try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
            for (const item of parsed) {
                if (item && item.id) {
                    await saveSermonTranscript({
                        id: item.id,
                        title: item.title || 'Untitled',
                        transcript: item.transcript || '',
                        segments: item.segments,
                        detectedVerses: item.detectedVerses,
                        provider: item.provider || 'web-speech',
                        createdAt: item.createdAt || new Date().toISOString(),
                    })
                }
            }
        }
    } catch (err) {
        console.warn('[IDB] Failed to parse legacy saved transcripts, skipping:', err)
    }
    localStorage.removeItem(LEGACY_KEYS.saved)
}

async function migrateOfflineTranscripts(): Promise<void> {
    const raw = localStorage.getItem(LEGACY_KEYS.offline)
    if (!raw) return
    try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
            for (const item of parsed) {
                if (item && item.id) {
                    await addOfflineTranscript({
                        id: item.id,
                        title: item.title || 'Untitled',
                        transcript: item.transcript || '',
                        segments: item.segments,
                        detectedVerses: item.detectedVerses,
                        provider: item.provider || 'web-speech',
                        language: item.language,
                        scheduleId: item.scheduleId,
                        createdAt: item.createdAt || new Date().toISOString(),
                        updatedAt: item.updatedAt || new Date().toISOString(),
                    })
                }
            }
        }
    } catch (err) {
        console.warn('[IDB] Failed to parse legacy offline transcripts, skipping:', err)
    }
    localStorage.removeItem(LEGACY_KEYS.offline)
}
