import { useState, useEffect, useCallback, useMemo } from 'react'
import {
    embeddingSyncManager,
    type VersionSyncState,
    type SyncStage,
    type SyncResult,
} from '../services/sermon-listener/embeddingSyncManager'

export type { VersionSyncState, SyncStage, SyncResult }

export function useEmbeddingStatus() {
    const [states, setStates] = useState<Map<string, VersionSyncState>>(
        () => embeddingSyncManager.getStates()
    )

    useEffect(() => {
        return embeddingSyncManager.subscribe(setStates)
    }, [])

    const checkStatus = useCallback(async (versionId: string) => {
        return embeddingSyncManager.checkStatus(versionId)
    }, [])

    const checkAllStatuses = useCallback(async (versionIds: string[]) => {
        return embeddingSyncManager.checkAllStatuses(versionIds)
    }, [])

    const startSync = useCallback(async (
        versionId: string,
        getBibleFileUrl: () => Promise<string | null>,
        downloadFn?: () => Promise<boolean>,
        withFragments?: boolean,
    ) => {
        return embeddingSyncManager.startSync(versionId, getBibleFileUrl, downloadFn, withFragments)
    }, [])

    const upgradeToFragments = useCallback(async (
        versionId: string,
        getBibleFileUrl: () => Promise<string | null>,
    ) => {
        return embeddingSyncManager.upgradeToFragments(versionId, getBibleFileUrl)
    }, [])

    const cancelSync = useCallback((versionId?: string) => {
        embeddingSyncManager.cancelSync(versionId)
    }, [])

    const clearEmbeddings = useCallback(async (versionId: string) => {
        return embeddingSyncManager.clearEmbeddings(versionId)
    }, [])

    const isSyncing = useMemo(() => embeddingSyncManager.isSyncing(), [states])
    const modelLoading = embeddingSyncManager.getModelLoading()
    const modelReady = embeddingSyncManager.getModelReady()

    return {
        states,
        checkStatus,
        checkAllStatuses,
        startSync,
        upgradeToFragments,
        cancelSync,
        clearEmbeddings,
        isSyncing,
        modelLoading,
        modelReady,
    }
}
