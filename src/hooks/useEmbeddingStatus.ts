import { useSyncExternalStore } from 'react'
import { embeddingSyncManager, type VersionSyncState } from '../services/sermon-listener/embeddingSyncManager'

type EmbeddingStatusLevel = 'ready' | 'loading' | 'error' | 'off'

export interface EmbeddingStatus {
    stage: VersionSyncState['stage'] | 'off'
    level: EmbeddingStatusLevel
    progress: number
    total: number
    hasEmbeddings: boolean
    hasFragments: boolean
}

function getStatusFromState(state: VersionSyncState | undefined): EmbeddingStatus {
    if (!state || state.stage === 'idle') {
        return {
            stage: state?.hasEmbeddings ? 'completed' : 'off',
            level: state?.hasEmbeddings ? 'ready' : 'off',
            progress: 0,
            total: 0,
            hasEmbeddings: state?.hasEmbeddings ?? false,
            hasFragments: state?.hasFragments ?? false,
        }
    }
    if (state.stage === 'completed') {
        return { stage: 'completed', level: 'ready', progress: state.progress, total: state.total, hasEmbeddings: true, hasFragments: state.hasFragments }
    }
    if (state.stage === 'error') {
        return { stage: 'error', level: 'error', progress: 0, total: 0, hasEmbeddings: state.hasEmbeddings, hasFragments: state.hasFragments }
    }
    return { stage: state.stage, level: 'loading', progress: state.progress, total: state.total, hasEmbeddings: state.hasEmbeddings, hasFragments: state.hasFragments }
}

let cachedSnapshot: Map<string, VersionSyncState> | null = null
let cachedJSON = ''

function getStatesSnapshot(): Map<string, VersionSyncState> {
    const current = embeddingSyncManager.getStates()
    const json = JSON.stringify(Array.from(current.entries()))
    if (json !== cachedJSON) {
        cachedJSON = json
        cachedSnapshot = current
    }
    return cachedSnapshot!
}

export function useEmbeddingStatus(versionId?: string): EmbeddingStatus | null {
    const states = useSyncExternalStore(
        (callback) => embeddingSyncManager.subscribe(callback),
        getStatesSnapshot,
    )

    if (!versionId) {
        const allStates = Array.from(states.values())
        if (allStates.length === 0) return null
        const completed = allStates.find(s => s.stage === 'completed')
        if (completed) return getStatusFromState(completed)
        const inProgress = allStates.find(s => s.stage !== 'idle' && s.stage !== 'error')
        if (inProgress) return getStatusFromState(inProgress)
        return getStatusFromState(allStates[0])
    }

    const state = states.get(versionId)
    return state ? getStatusFromState(state) : null
}