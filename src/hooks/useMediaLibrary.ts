import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { useEntitlements } from '../providers/LicenseProvider'
import { isDesktop } from '../platform'
import { saveFileToLocalMediaLibrary, readLocalMediaFile, deleteLocalMediaFile } from '../services/localMediaFiles'
import {
    saveLocalMediaItem,
    getLocalMediaItems,
    updateLocalMediaItem,
    deleteLocalMediaItem,
    saveLocalMediaBlob,
    getLocalMediaBlob,
    deleteLocalMediaBlob,
    type LocalMediaItem,
} from './useIndexedDB'

export interface MediaLibraryItem {
    /** Local IndexedDB row id for device-local items; Convex `_id` for pure-remote items. */
    id: string
    name: string
    type: 'image' | 'video'
    /** Desktop: has a copy on disk at this path. */
    localFilePath?: string
    /** Web: has a copy in the localMediaBlobs IndexedDB table under `id`. */
    hasBlob?: boolean
    /** Set once this item is also stored in Convex — via sync (pro) or because it's pure-remote. */
    storageId?: string
    isExternal?: boolean
    externalType?: 'youtube' | 'vimeo'
    url?: string
    createdAt: string
}

function generateLocalId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `media_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function localItemToUi(item: LocalMediaItem): MediaLibraryItem {
    return {
        id: item.id,
        name: item.name,
        type: item.type,
        localFilePath: item.localFilePath,
        hasBlob: item.hasBlob,
        storageId: item.syncedStorageId,
        createdAt: item.createdAt,
    }
}

export interface UseMediaLibraryReturn {
    items: MediaLibraryItem[] | undefined
    isLoading: boolean
    /** Saves a file to the local device library (free, default — no Convex upload). */
    uploadFile: (file: File) => Promise<void>
    /** Uploads an already-local item's bytes to Convex too, so it follows the user across devices. Requires Pro. */
    syncToCloud: (item: MediaLibraryItem) => Promise<void>
    /** Adds a YouTube/Vimeo link to the library — always Convex-backed, no local/sync distinction (just a URL, no storage cost). */
    addExternalVideo: (platform: 'youtube' | 'vimeo', url: string, name?: string) => Promise<void>
    deleteItem: (item: MediaLibraryItem) => Promise<void>
}

export function useMediaLibrary(): UseMediaLibraryReturn {
    const { isOffline } = useConvexConnection()
    const { isPro } = useEntitlements()
    const remoteItems = useQuery(api.media.getMediaLibrary) as (MediaLibraryItem & { _id: string })[] | undefined
    const generateUploadUrlMutation = useMutation(api.media.generateUploadUrl)
    const createItemMutation = useMutation(api.media.createMediaLibraryItem)
    const deleteItemMutation = useMutation(api.media.deleteMediaLibraryItem)

    const [localItems, setLocalItems] = useState<LocalMediaItem[] | undefined>(undefined)

    const refreshLocalItems = useCallback(async () => {
        setLocalItems(await getLocalMediaItems())
    }, [])

    useEffect(() => {
        getLocalMediaItems().then(setLocalItems).catch(() => {})
    }, [])

    const items = useMemo((): MediaLibraryItem[] | undefined => {
        if (localItems === undefined) return undefined

        const synced = new Set(localItems.map((l) => l.syncedMediaId).filter(Boolean))
        const pureRemote = (remoteItems || [])
            .filter((r) => !synced.has(r._id))
            .map((r) => ({ ...r, id: r._id }))

        return [...localItems.map(localItemToUi), ...pureRemote]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }, [localItems, remoteItems])

    const uploadFile = async (file: File): Promise<void> => {
        const id = generateLocalId()
        const type: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image'
        const now = new Date().toISOString()

        const localFilePath = isDesktop() ? await saveFileToLocalMediaLibrary(file, id) : undefined
        if (!isDesktop()) {
            await saveLocalMediaBlob(id, file)
        }

        await saveLocalMediaItem({
            id,
            name: file.name,
            type,
            localFilePath,
            hasBlob: !isDesktop(),
            size: file.size,
            contentType: file.type,
            createdAt: now,
            updatedAt: now,
        })
        await refreshLocalItems()
    }

    const syncToCloud = async (item: MediaLibraryItem): Promise<void> => {
        if (!isPro) {
            throw new Error('Cloud sync requires a Pro subscription')
        }
        if (isOffline) {
            throw new Error('Syncing to the cloud requires an internet connection')
        }
        if (!item.localFilePath && !item.hasBlob) {
            throw new Error('This item has no local copy to sync')
        }

        const local = await getLocalMediaItems().then((all) => all.find((l) => l.id === item.id))
        if (!local) throw new Error('Local media item not found')

        let blob: Blob
        if (local.localFilePath) {
            blob = await readLocalMediaFile(local.localFilePath, local.contentType)
        } else {
            const cached = await getLocalMediaBlob(item.id)
            if (!cached) throw new Error('Local media blob not found')
            blob = cached
        }

        const uploadUrl = await generateUploadUrlMutation({})
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': local.contentType },
            body: blob,
        })
        if (!response.ok) {
            throw new Error('Failed to upload file')
        }
        const { storageId } = await response.json()

        const syncedMediaId = await createItemMutation({ name: local.name, type: local.type, storageId })
        await updateLocalMediaItem(item.id, { syncedMediaId, syncedStorageId: storageId })
        await refreshLocalItems()
    }

    const addExternalVideo = async (platform: 'youtube' | 'vimeo', url: string, name?: string): Promise<void> => {
        if (isOffline) {
            throw new Error('Adding a video link requires an internet connection')
        }

        await createItemMutation({
            name: name || `${platform === 'youtube' ? 'YouTube' : 'Vimeo'} Video`,
            type: 'video',
            isExternal: true,
            externalType: platform,
            url,
        })
    }

    const deleteItem = async (item: MediaLibraryItem): Promise<void> => {
        const local = localItems?.find((l) => l.id === item.id)

        if (local) {
            if (local.localFilePath) await deleteLocalMediaFile(local.localFilePath)
            if (local.hasBlob) await deleteLocalMediaBlob(local.id)
            await deleteLocalMediaItem(local.id)
            if (local.syncedMediaId && !isOffline) {
                await deleteItemMutation({ mediaId: local.syncedMediaId })
            }
            await refreshLocalItems()
            return
        }

        // Pure-remote item (no local counterpart on this device).
        await deleteItemMutation({ mediaId: item.id })
    }

    return {
        items,
        isLoading: localItems === undefined,
        uploadFile,
        syncToCloud,
        addExternalVideo,
        deleteItem,
    }
}
