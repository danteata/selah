import { useState, useEffect, useCallback } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useEmbeddingStatus } from '../../hooks/useEmbeddingStatus'
import { isEmbedderReady } from '../../services/sermon-listener/localEmbeddings'
import type { SyncStage } from '../../services/sermon-listener/embeddingSyncManager'
import { Check, Loader2, Download, Trash2, RefreshCw, Bell, BellOff } from 'lucide-react'

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

interface LocalEmbeddingSyncProps {
    onClose?: () => void
}

export function LocalEmbeddingSync({ onClose }: LocalEmbeddingSyncProps = {}) {
    const convex = useConvex()
    const bibleVersions = useQuery(api.bibleVersions.listBibleVersions)

    const {
        states: embeddingStatuses,
        checkAllStatuses,
        startSync,
        upgradeToFragments,
        clearEmbeddings,
        isSyncing,
        modelLoading,
        modelReady,
    } = useEmbeddingStatus()

    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default')
    const [showSuccess, setShowSuccess] = useState<string | null>(null)

    const [withFragments, setWithFragments] = useState(false)

    useEffect(() => {
        if (bibleVersions && bibleVersions.length > 0) {
            checkAllStatuses(bibleVersions.map(v => v.id))
        }
    }, [bibleVersions, checkAllStatuses])

    useEffect(() => {
        if ('Notification' in window) {
            setNotificationPermission(Notification.permission)
        }
    }, [])

    const requestNotificationPermission = useCallback(async () => {
        if (!('Notification' in window)) return
        const permission = await Notification.requestPermission()
        setNotificationPermission(permission)
    }, [])

    const showNotification = useCallback((title: string, body: string) => {
        if (notificationPermission === 'granted' && 'Notification' in window) {
            new Notification(title, { body, icon: '/vite.svg' })
        }
    }, [notificationPermission])

    const handleSeed = useCallback(async (versionId: string, withFragments = false) => {
        const versionName = bibleVersions?.find(v => v.id === versionId)?.name ?? versionId
        try {
            const result = await startSync(versionId, async () => {
                const fileInfo = await convex.query(api.bibleVersions.getBibleFileUrl, { versionId })
                return fileInfo?.url ?? null
            }, undefined, withFragments)
            if (result.success) {
                showNotification('Search ready', `You can now find verses in ${versionName}`)
                setShowSuccess(versionId)
                setTimeout(() => setShowSuccess(null), 2000)

                // Auto-upgrade to fragments in the background after fast full-verse seed completes
                if (!withFragments) {
                    setTimeout(() => {
                        upgradeToFragments(versionId, async () => {
                            const fileInfo = await convex.query(api.bibleVersions.getBibleFileUrl, { versionId })
                            return fileInfo?.url ?? null
                        })
                    }, 500)
                }
            } else if (!result.cancelled) {
                showNotification('Setup failed', `Could not prepare ${versionName} for search`)
            }
        } catch {
            showNotification('Setup failed', `Could not prepare ${versionName} for search`)
        }
    }, [bibleVersions, startSync, upgradeToFragments, convex, showNotification])

    const handleClear = useCallback(async (versionId: string) => {
        await clearEmbeddings(versionId)
    }, [clearEmbeddings])

    const isVersionSyncing = useCallback((versionId: string) => {
        const state = embeddingStatuses.get(versionId)
        if (!state) return false
        return state.stage !== 'idle' && state.stage !== 'completed' && state.stage !== 'error'
    }, [embeddingStatuses])

    return (
        <div className="space-y-6">
            {showSuccess && (
                <div className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg shadow-lg animate-fade-in">
                    <Check className="w-4 h-4" />
                    <span className="text-sm font-medium">Search index ready!</span>
                </div>
            )}

            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Smart Verse Search
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Teach Selah your Bible so it can find verses from the words you remember.
                    </p>
                </div>
            </div>

            {notificationPermission !== 'granted' && (
                <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/30 rounded-lg border border-amber-200 dark:border-amber-700">
                    <div className="flex items-center gap-2">
                        <BellOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span className="text-sm text-amber-800 dark:text-amber-300">
                            Enable notifications to be alerted when background caching completes
                        </span>
                    </div>
                    <button
                        onClick={requestNotificationPermission}
                        className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-1"
                    >
                        <Bell className="w-4 h-4" />
                        Enable
                    </button>
                </div>
            )}

            {isSyncing && (
                <div className="p-3 bg-[var(--accent-teal)]/5 rounded-lg border border-[var(--accent-teal)]/30">
                    <div className="flex items-center gap-2 text-[var(--accent-teal)]">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm font-medium">Getting your Bible ready for search...</span>
                    </div>
                    <p className="text-xs text-[var(--accent-teal)] mt-1">
                        You can navigate away — this will continue in the background.
                    </p>
                </div>
            )}

            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-medium text-gray-900 dark:text-white">Search Engine</h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {modelReady || isEmbedderReady()
                                ? 'Ready to find verses'
                                : modelLoading
                                    ? 'Warming up...'
                                    : 'Will start when needed'}
                        </p>
                    </div>
                    {(modelReady || isEmbedderReady()) && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                            Ready
                        </span>
                    )}
                </div>
            </div>

            {bibleVersions && bibleVersions.length > 0 && !embeddingStatuses.size && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                        <strong>Tip:</strong> Save at least one Bible version (KJV recommended) so you can search verses by the words you remember.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            id="fragments-toggle"
                            type="checkbox"
                            checked={withFragments}
                            onChange={(e) => setWithFragments(e.target.checked)}
                            className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
                        />
                        <label htmlFor="fragments-toggle" className="text-sm text-blue-900 dark:text-blue-200 cursor-pointer">
                            Also teach short phrases (slower, but helps with brief verses)
                        </label>
                    </div>
                    {bibleVersions.find(v => v.id.toLowerCase() === 'kjv') && (
                        <button
                            onClick={() => {
                                const kjv = bibleVersions.find(v => v.id.toLowerCase() === 'kjv')
                                if (kjv) handleSeed(kjv.id, withFragments)
                            }}
                            disabled={isSyncing}
                            className="mt-4 w-full px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-sm"
                        >
                            <Download className="w-4 h-4" />
                            Cache KJV Now
                        </button>
                    )}
                </div>
            )}

            <div className="space-y-3">
                {(bibleVersions ?? []).map((version) => {
                    const status = embeddingStatuses.get(version.id)
                    const syncing = isVersionSyncing(version.id)
                    const stage = status?.stage ?? 'idle'

                    return (
                        <div key={version.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="font-medium text-gray-900 dark:text-white">
                                        {version.name}
                                    </h4>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        {(version.verseCount ?? 31102).toLocaleString()} verses
                                        {status?.hasEmbeddings && status.embeddingCount > 0 && (
                                            <span className="ml-2 text-green-600 dark:text-green-400">
                                                · {status.embeddingCount.toLocaleString()} rows saved
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {status?.hasEmbeddings && !syncing && (
                                        <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 flex items-center gap-1">
                                            <Check className="w-3 h-3" />
                                            Cached
                                        </span>
                                    )}
                                    {syncing && status && (
                                        <span className="px-2 py-1 text-xs font-medium rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center gap-1">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            {status.total > 0 ? `${Math.round((status.progress / status.total) * 100)}%` : STAGE_LABELS[stage] || 'Processing...'}
                                        </span>
                                    )}
                                    {!syncing && !status?.hasEmbeddings && (
                                        <button
                                            onClick={() => handleSeed(version.id, withFragments)}
                                            disabled={isSyncing}
                                            className="px-3 py-1.5 text-sm bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 flex items-center gap-1 transition-all shadow-sm"
                                        >
                                            <Download className="w-4 h-4" />
                                            Cache
                                        </button>
                                    )}
                                    {status?.hasEmbeddings && !syncing && (
                                        <>
                                            <button
                                                onClick={() => handleSeed(version.id, withFragments)}
                                                disabled={isSyncing}
                                                className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1 transition-all shadow-sm"
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                                Refresh
                                            </button>
                                            <button
                                                onClick={() => handleClear(version.id)}
                                                disabled={isSyncing}
                                                className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 flex items-center gap-1 transition-all shadow-sm"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Clear
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {syncing && status && (
                                <div className="mt-3">
                                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                        <span>{STAGE_LABELS[stage]}</span>
                                        <span>
                                            {status.progress.toLocaleString()} / {status.total.toLocaleString()}
                                            {status.eta && ` · ${status.eta}`}
                                        </span>
                                    </div>
                                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                        <div
                                            className="bg-[var(--accent-teal)] h-2 rounded-full transition-all"
                                            style={{ width: `${status.total > 0 ? Math.min((status.progress / status.total) * 100, 100) : 0}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {status?.error && (
                                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                                    Error: {status.error}
                                </p>
                            )}
                        </div>
                    )
                })}
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <h4 className="font-medium text-gray-900 dark:text-white mb-2">How it works</h4>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>· The app learns your Bible version on your device (FREE)</li>
                    <li>· Uses a small 22MB brain to understand verse meaning</li>
                    <li>· Basic mode: ~1–2 minutes per Bible version</li>
                    <li>· Thorough mode: ~3–5 minutes, better at finding short verses</li>
                    <li>· Type what you remember and the app finds the verse</li>
                    <li>· Data is saved to your browser for offline use</li>
                    <li>· Works offline once set up</li>
                </ul>
            </div>

            {onClose && (
                <div className="flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                    >
                        Close
                    </button>
                </div>
            )}
        </div>
    )
}

export default LocalEmbeddingSync
