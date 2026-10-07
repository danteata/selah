import { useEffect, useSyncExternalStore } from 'react'
import { useConvex, useConvexAuth } from 'convex/react'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { refreshServerSongs, serverSongsAge, STALE_AFTER_MS } from '../services/songs/serverSongs'
import {
    adoptUnsyncedLocalSongs,
    getSongSyncStatus,
    refreshPendingCount,
    subscribeSongSync,
    subscribeSyncRequests,
    syncPendingSongs,
    type SongSyncStatus,
} from '../services/songs/songSync'
import { subscribeSongsChanged } from './useSongs'

/** Quiet period after a library change before syncing, so an import (or a
 *  burst of edits) goes up together. */
const SYNC_DEBOUNCE_MS = 3000

/**
 * Keeps this device's song library and the server's in step: fetches the
 * server's list when online and signed in (and again when it has gone stale),
 * and uploads songs saved here. Mount once, inside the Convex provider.
 */
export function useSongLibrarySync(): void {
    const convex = useConvex()
    const { isOffline } = useConvexConnection()
    const { isAuthenticated } = useConvexAuth()
    const online = !isOffline && isAuthenticated

    useEffect(() => {
        void adoptUnsyncedLocalSongs().then(() => refreshPendingCount())
    }, [])

    useEffect(() => {
        if (!online) return
        let timer: ReturnType<typeof setTimeout> | undefined
        const sync = () => {
            void refreshPendingCount().then((pending) => {
                if (pending > 0) void syncPendingSongs(convex)
            })
        }

        // Coming online (or signing in): fetch the list, then send what waited.
        void refreshServerSongs(convex).then(sync)

        const unsubscribeChanges = subscribeSongsChanged(() => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(sync, SYNC_DEBOUNCE_MS)
        })
        const unsubscribeRequests = subscribeSyncRequests(() => {
            void refreshServerSongs(convex).then(() => syncPendingSongs(convex))
        })
        const onFocus = () => {
            if (serverSongsAge() > STALE_AFTER_MS) void refreshServerSongs(convex)
        }
        window.addEventListener('focus', onFocus)

        return () => {
            if (timer) clearTimeout(timer)
            unsubscribeChanges()
            unsubscribeRequests()
            window.removeEventListener('focus', onFocus)
        }
    }, [online, convex])
}

/** Live sync status for the UI. */
export function useSongSyncStatus(): SongSyncStatus {
    return useSyncExternalStore(subscribeSongSync, getSongSyncStatus)
}
