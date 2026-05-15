import { useEffect, useState } from 'react'
import { Database, Loader2 } from 'lucide-react'
import { embeddingSyncManager, type SyncStage } from '../../services/sermon-listener/embeddingSyncManager'

const STAGE_LABELS: Record<SyncStage, string> = {
    idle: '',
    downloading: 'Downloading Bible data...',
    'loading-model': 'Preparing search engine...',
    importing: 'Reading Bible text...',
    generating: 'Teaching Selah about your Bible...',
    upgrading: 'Fine-tuning for short verses...',
    caching: 'Saving to your device...',
    completed: 'Done!',
    error: 'Something went wrong',
}

export function EmbeddingSyncIndicator() {
    const [syncingVersions, setSyncingVersions] = useState<Array<{
        versionId: string
        stage: SyncStage
        progress: number
        total: number
        eta: string | null
    }>>([])

    useEffect(() => {
        return embeddingSyncManager.subscribe((states) => {
            const active = []
            for (const [versionId, state] of states) {
                if (state.stage !== 'idle' && state.stage !== 'completed' && state.stage !== 'error') {
                    active.push({
                        versionId,
                        stage: state.stage,
                        progress: state.progress,
                        total: state.total,
                        eta: state.eta,
                    })
                }
            }
            setSyncingVersions(active)
        })
    }, [])

    if (syncingVersions.length === 0) return null

    const primary = syncingVersions[0]
    const pct = primary.total > 0 ? Math.round((primary.progress / primary.total) * 100) : undefined

    return (
        <div className="fixed bottom-4 right-4 z-40 animate-fade-in">
            <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-[var(--accent-teal)]/30 max-w-xs">
                <div className="flex-shrink-0">
                    <div className="relative">
                        <Database className="w-5 h-5 text-[var(--accent-teal)]" />
                        <Loader2 className="w-3 h-3 text-[var(--accent-teal)] animate-spin absolute -top-1 -right-1" />
                    </div>
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                        {STAGE_LABELS[primary.stage] || 'Syncing...'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-[var(--accent-teal)] rounded-full transition-all duration-300"
                                style={{ width: `${pct ?? 0}%` }}
                            />
                        </div>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">
                            {pct != null ? `${pct}%` : '...'}
                        </span>
                    </div>
                    {primary.eta && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{primary.eta}</p>
                    )}
                    {syncingVersions.length > 1 && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500">
                            +{syncingVersions.length - 1} more
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}