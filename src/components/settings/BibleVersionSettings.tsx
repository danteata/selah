import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Database, Search, RefreshCw, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useScripture } from '../../hooks/useScripture'
import type { BibleVersion } from '../../types'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useEmbeddingStatus } from '../../hooks/useEmbeddingStatus'
import type { SyncStage } from '../../services/sermon-listener/embeddingSyncManager'

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

export function BibleVersionSettings() {
    const convex = useConvex()
    const [bibleVersionOptions, setBibleVersionOptions] = useState<BibleVersion[]>([])

    const {
        states: embeddingStatuses,
        checkAllStatuses,
        startSync,
        upgradeToFragments,
        clearEmbeddings,
        isSyncing,
    } = useEmbeddingStatus()

    const convexBibleVersions = useQuery(api.bibleVersions.listBibleVersions)
    const staticBibleVersions = useAppStore((state) => state.bibleVersions) as BibleVersion[]

    const bibleVersions = useMemo(() => {
        return (convexBibleVersions || staticBibleVersions) as BibleVersion[]
    }, [convexBibleVersions, staticBibleVersions])

    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const setDefaultBibleVersion = useAppStore((state) => state.setDefaultBibleVersion)
    const { downloadBibleVersion, isVersionDownloaded } = useScripture()
    const [statusesLoading, setStatusesLoading] = useState(true)

    useEffect(() => {
        if (bibleVersions && bibleVersions.length > 0) {
            setBibleVersionOptions(bibleVersions.map(v => ({ ...v, isDownloaded: false })))
        }
    }, [bibleVersions])

    const refreshDownloadStatuses = useCallback(async () => {
        if (!bibleVersions || bibleVersions.length === 0) return
        setStatusesLoading(true)
        const results = await Promise.all(bibleVersions.map(async (v) => ({
            ...v,
            isDownloaded: await isVersionDownloaded(v.id),
        })))
        setBibleVersionOptions(results)
        setStatusesLoading(false)
    }, [bibleVersions, isVersionDownloaded])

    useEffect(() => {
        if (bibleVersions && bibleVersions.length > 0) {
            Promise.all([
                refreshDownloadStatuses(),
                checkAllStatuses(bibleVersions.map(v => v.id)),
            ]).finally(() => setStatusesLoading(false))
        }
    }, [bibleVersions, refreshDownloadStatuses, checkAllStatuses])

    const handleEnableSearch = useCallback(async (versionId: string, withFragments = false) => {
        const version = bibleVersionOptions.find(v => v.id === versionId)
        const needsDownload = version && !version.isDownloaded

        const result = await startSync(
            versionId,
            async () => {
                const fileInfo = await convex.query(api.bibleVersions.getBibleFileUrl, { versionId })
                return fileInfo?.url ?? null
            },
            needsDownload
                ? async () => {
                    const result = await downloadBibleVersion(versionId)
                    if (result) {
                        await refreshDownloadStatuses()
                    }
                    return !!result
                }
                : undefined,
            withFragments,
        )
        if (!result.success && !result.cancelled) {
            // Error message is rendered from shared embedding status state
            console.error(`[EmbeddingSync] Failed for ${versionId}: ${result.error ?? 'Unknown error'}`)
            return
        }

        // Auto-upgrade to fragments in the background after fast full-verse seed completes
        if (result.success && !withFragments) {
            // Small delay so the UI shows "Complete" briefly before switching to upgrading
            setTimeout(() => {
                upgradeToFragments(versionId, async () => {
                    const fileInfo = await convex.query(api.bibleVersions.getBibleFileUrl, { versionId })
                    return fileInfo?.url ?? null
                })
            }, 500)
        }
    }, [bibleVersionOptions, startSync, upgradeToFragments, convex, downloadBibleVersion, refreshDownloadStatuses])

    const handleClear = useCallback(async (versionId: string) => {
        await clearEmbeddings(versionId)
    }, [clearEmbeddings])

    const isLoading = !convexBibleVersions && !staticBibleVersions?.length

    const pct = (s: { progress: number; total: number }) =>
        s.total > 0 ? Math.round((s.progress / s.total) * 100) : undefined

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                    Bible Versions
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Download a Bible version and turn on smart search so you can find verses by typing what you remember.
                </p>
            </div>

            <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Default Bible Version
                </label>
                {isLoading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading versions...
                    </div>
                ) : (
                    <select
                        value={defaultBibleVersion || 'KJV'}
                        onChange={(e) => setDefaultBibleVersion(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
                    >
                        {bibleVersionOptions
                            .filter(v => v.isDownloaded)
                            .map((version) => (
                                <option key={version.id} value={version.id}>
                                    {version.name} ({version.id})
                                </option>
                            ))}
                    </select>
                )}
            </div>

            <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Available Versions
                </h4>
                {bibleVersionOptions.length === 0 ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="animate-pulse flex items-center justify-between py-3">
                                <div className="space-y-2">
                                    <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                                    <div className="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                                </div>
                                <div className="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {bibleVersionOptions.map((version) => {
                            const embeddingStatus = embeddingStatuses.get(version.id)
                            const isVersionSyncing = embeddingStatus
                                ? embeddingStatus.stage !== 'idle' && embeddingStatus.stage !== 'completed' && embeddingStatus.stage !== 'error'
                                : false
                            const stage = embeddingStatus?.stage ?? 'idle'
                            const progressPct = embeddingStatus ? pct(embeddingStatus) : undefined

                            return (
                                <div key={version.id} className="relative py-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                    {version.id}
                                                </span>
                                                {embeddingStatus?.hasEmbeddings && !isVersionSyncing && (
                                                    <span className="flex items-center gap-1 text-xs text-[var(--accent-teal)]">
                                                        <Search className="w-3 h-3" />
                                                        {embeddingStatus.hasFragments ? (
                                                            <span className="text-[10px] px-1 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded font-medium">v2</span>
                                                        ) : (
                                                            <span className="text-[10px] px-1 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded font-medium">v1</span>
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                {version.name}
                                                {version.isPublicDomain && ' · Public Domain'}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {statusesLoading ? (
                                                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                                            ) : isVersionSyncing ? (
                                                <div className="flex items-center gap-2 text-[var(--accent-teal)]">
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    <span className="text-sm">
                                                        {progressPct != null ? `${progressPct}%` : STAGE_LABELS[stage] || 'Processing...'}
                                                    </span>
                                                </div>
                                            ) : (
                                                <>
                                                    {embeddingStatus?.hasEmbeddings ? (
                                                        <div className="flex items-center gap-1">
                                                            {!embeddingStatus.hasFragments && (
                                                                <button
                                                                    onClick={() => handleEnableSearch(version.id, true)}
                                                                    disabled={isSyncing}
                                                                    className="flex items-center gap-1 px-2 py-1 text-xs border border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50 font-medium"
                                                                    title="Improve how the app finds short verses"
                                                                >
                                                                    <RefreshCw className="w-3 h-3" />
                                                                    Upgrade
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleEnableSearch(version.id, embeddingStatus?.hasFragments ?? false)}
                                                                disabled={isSyncing}
                                                                className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                                                                title="Refresh embeddings"
                                                            >
                                                                <RefreshCw className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleClear(version.id)}
                                                                disabled={isSyncing}
                                                                className="p-1.5 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                                                title="Clear embeddings"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    ) : version.isDownloaded ? (
                                                        <button
                                                            onClick={() => handleEnableSearch(version.id)}
                                                            disabled={isSyncing}
                                                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-[var(--accent-teal)] text-[var(--accent-teal)] rounded-lg hover:bg-[var(--accent-teal)]/10 disabled:opacity-50 transition-colors"
                                                        >
                                                            <Search className="w-3.5 h-3.5" />
                                                            Enable Search
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleEnableSearch(version.id)}
                                                            disabled={isSyncing}
                                                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-primary-500 text-primary-600 dark:text-primary-400 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 transition-colors"
                                                        >
                                                            <Search className="w-3.5 h-3.5" />
                                                            Download & Enable Search
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {isVersionSyncing && embeddingStatus && (
                                        <div className="mt-3 space-y-1">
                                            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                                <span>{STAGE_LABELS[stage]}</span>
                                                <span>
                                                    {embeddingStatus.progress.toLocaleString()} / {embeddingStatus.total.toLocaleString()}
                                                    {embeddingStatus.eta && ` · ${embeddingStatus.eta}`}
                                                </span>
                                            </div>
                                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                                                <div
                                                    className="bg-[var(--accent-teal)] h-1.5 rounded-full transition-all"
                                                    style={{ width: `${progressPct ?? 0}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {embeddingStatus?.error && (
                                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                                            {embeddingStatus.error}
                                        </p>
                                    )}

                                    {embeddingStatus?.hasEmbeddings && !embeddingStatus.hasFragments && !isVersionSyncing && (
                                        <div className="mt-2 flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                            <Database className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                                    Better short-verse search available
                                                </p>
                                                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                                                    Click <strong>Upgrade</strong> to help the app find short and partial verses more accurately.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
