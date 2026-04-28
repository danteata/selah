/**
 * Local Embedding Sync Component
 * 
 * Allows ALL users to sync verse embeddings locally for semantic Bible verse detection.
 * This component provides local-only caching - no Convex upload (that's admin-only).
 * 
 * Features:
 * - Generate embeddings locally using Transformers.js (FREE)
 * - Cache in IndexedDB for offline use
 * - Select which Bible versions to cache
 * - Background processing with browser notifications
 * - Accurate progress tracking
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import {
    initializeEmbedder,
    embedBatch,
    isEmbedderReady,
    cacheVerseEmbeddings,
    hasCachedEmbeddings,
    getCachedVerseEmbeddings,
    clearCachedEmbeddingsForVersion,
} from '../../services/sermon-listener/localEmbeddings'
import { extractVerseFragments } from '../../lib/extractVerseFragments'
import { IconWrapper } from '../utils/IconWrapper'
import { Check, Loader2, Download, Trash2, RefreshCw, Bell, BellOff } from 'lucide-react'

// Global background seeding state (persists across modal closes)
declare global {
    interface Window {
        __localSeeding?: Map<string, {
            versionId: string
            versionName: string
            progress: number
            total: number
            status: 'seeding' | 'completed' | 'error'
            error?: string
        }>
    }
}

interface LocalSyncStatus {
    versionId: string
    versionName: string
    status: 'pending' | 'loading-model' | 'seeding' | 'completed' | 'error' | 'cached'
    progress: number
    total: number
    error?: string
    hasLocalCache: boolean
    cachedCount?: number
}

interface LocalEmbeddingSyncProps {
    onClose?: () => void
}

// Book name to number mapping (needed for local cache)
const BOOK_TO_NUMBER: Record<string, number> = {
    'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
    'Joshua': 6, 'Judges': 7, 'Ruth': 8, '1 Samuel': 9, '2 Samuel': 10,
    '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14, 'Ezra': 15,
    'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19, 'Proverbs': 20,
    'Ecclesiastes': 21, 'Song of Solomon': 22, 'Isaiah': 23, 'Jeremiah': 24, 'Lamentations': 25,
    'Ezekiel': 26, 'Daniel': 27, 'Hosea': 28, 'Joel': 29, 'Amos': 30,
    'Obadiah': 31, 'Jonah': 32, 'Micah': 33, 'Nahum': 34, 'Habakkuk': 35,
    'Zephaniah': 36, 'Haggai': 37, 'Zechariah': 38, 'Malachi': 39,
    'Matthew': 40, 'Mark': 41, 'Luke': 42, 'John': 43, 'Acts': 44,
    'Romans': 45, '1 Corinthians': 46, '2 Corinthians': 47, 'Galatians': 48, 'Ephesians': 49,
    'Philippians': 50, 'Colossians': 51, '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54,
    '2 Timothy': 55, 'Titus': 56, 'Philemon': 57, 'Hebrews': 58, 'James': 59,
    '1 Peter': 60, '2 Peter': 61, '1 John': 62, '2 John': 63, '3 John': 64,
    'Jude': 65, 'Revelation': 66,
}

// Book number to name mapping (inverse of BOOK_TO_NUMBER)
const NUMBER_TO_BOOK: Record<number, string> = {
    1: 'Genesis', 2: 'Exodus', 3: 'Leviticus', 4: 'Numbers', 5: 'Deuteronomy',
    6: 'Joshua', 7: 'Judges', 8: 'Ruth', 9: '1 Samuel', 10: '2 Samuel',
    11: '1 Kings', 12: '2 Kings', 13: '1 Chronicles', 14: '2 Chronicles', 15: 'Ezra',
    16: 'Nehemiah', 17: 'Esther', 18: 'Job', 19: 'Psalms', 20: 'Proverbs',
    21: 'Ecclesiastes', 22: 'Song of Solomon', 23: 'Isaiah', 24: 'Jeremiah', 25: 'Lamentations',
    26: 'Ezekiel', 27: 'Daniel', 28: 'Hosea', 29: 'Joel', 30: 'Amos',
    31: 'Obadiah', 32: 'Jonah', 33: 'Micah', 34: 'Nahum', 35: 'Habakkuk',
    36: 'Zephaniah', 37: 'Haggai', 38: 'Zechariah', 39: 'Malachi',
    40: 'Matthew', 41: 'Mark', 42: 'Luke', 43: 'John', 44: 'Acts',
    45: 'Romans', 46: '1 Corinthians', 47: '2 Corinthians', 48: 'Galatians', 49: 'Ephesians',
    50: 'Philippians', 51: 'Colossians', 52: '1 Thessalonians', 53: '2 Thessalonians', 54: '1 Timothy',
    55: '2 Timothy', 56: 'Titus', 57: 'Philemon', 58: 'Hebrews', 59: 'James',
    60: '1 Peter', 61: '2 Peter', 62: '1 John', 63: '2 John', 64: '3 John',
    65: 'Jude', 66: 'Revelation',
}

export function LocalEmbeddingSync({ onClose }: LocalEmbeddingSyncProps = {}) {
    const convex = useConvex()
    const bibleVersions = useQuery(api.bibleVersions.listBibleVersions)

    const [statuses, setStatuses] = useState<LocalSyncStatus[]>([])
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [modelLoaded, setModelLoaded] = useState(false)
    const [activeSeeding, setActiveSeeding] = useState<string | null>(null)
    const [showSuccess, setShowSuccess] = useState(false)
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default')
    const [backgroundSeedingStates, setBackgroundSeedingStates] = useState<Map<string, {
        versionId: string
        versionName: string
        progress: number
        total: number
        status: 'seeding' | 'completed' | 'error'
        error?: string
    }>>(new Map())

    const seedingAbortControllerRef = useRef<AbortController | null>(null)

    // Initialize background seeding state
    useEffect(() => {
        if (!window.__localSeeding) {
            window.__localSeeding = new Map()
        }
        setBackgroundSeedingStates(new Map(window.__localSeeding))
    }, [])

    // Poll for background seeding updates
    useEffect(() => {
        const interval = setInterval(() => {
            if (window.__localSeeding) {
                setBackgroundSeedingStates(new Map(window.__localSeeding))
            }
        }, 1000)
        return () => clearInterval(interval)
    }, [])

    // Check notification permission
    useEffect(() => {
        if ('Notification' in window) {
            setNotificationPermission(Notification.permission)
        }
    }, [])

    // Request notification permission
    const requestNotificationPermission = useCallback(async () => {
        if (!('Notification' in window)) {
            console.log('Notifications not supported')
            return
        }
        const permission = await Notification.requestPermission()
        setNotificationPermission(permission)
    }, [])

    // Show notification
    const showNotification = useCallback((title: string, body: string) => {
        if (notificationPermission === 'granted' && 'Notification' in window) {
            new Notification(title, { body, icon: '/vite.svg' })
        }
    }, [notificationPermission])

    // Initialize embedding model
    const loadModel = useCallback(async () => {
        if (isEmbedderReady()) {
            setModelLoaded(true)
            return
        }

        setIsModelLoading(true)
        try {
            const result = await initializeEmbedder()
            setModelLoaded(result.ready)
            if (!result.ready) {
                console.error('Failed to load embedding model:', result)
            }
        } catch (error) {
            console.error('Error loading embedding model:', error)
        } finally {
            setIsModelLoading(false)
        }
    }, [])

    // Initialize statuses when versions are loaded
    useEffect(() => {
        if (!bibleVersions) return

        const initializeStatuses = async () => {
            const initialStatuses: LocalSyncStatus[] = await Promise.all(
                bibleVersions.map(async (version) => {
                    const hasLocalCache = await hasCachedEmbeddings(version.id)
                    const cachedVerses = hasLocalCache ? await getCachedVerseEmbeddings(version.id) : []

                    return {
                        versionId: version.id,
                        versionName: version.name,
                        status: hasLocalCache ? 'cached' : 'pending',
                        progress: 0,
                        total: version.verseCount,
                        hasLocalCache,
                        cachedCount: cachedVerses.length,
                    }
                })
            )

            setStatuses(initialStatuses)
        }

        initializeStatuses()
    }, [bibleVersions])

    // Seed embeddings for a specific version (LOCAL ONLY)
    const seedVersion = useCallback(async (versionId: string) => {
        const version = bibleVersions?.find((v) => v.id === versionId)
        if (!version) return

        setActiveSeeding(versionId)

        // Create abort controller for this seeding session
        seedingAbortControllerRef.current = new AbortController()
        const signal = seedingAbortControllerRef.current.signal

        try {
            // Update status to loading model
            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? { ...s, status: 'loading-model', progress: 0 }
                        : s
                )
            )

            // Load model if not ready
            if (!isEmbedderReady()) {
                await loadModel()
            }

            if (!isEmbedderReady()) {
                throw new Error('Failed to load embedding model')
            }

            // Update status to seeding
            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? { ...s, status: 'seeding' }
                        : s
                )
            )

            // Get Bible data from file storage
            const fileInfo = await convex.query(api.bibleVersions.getBibleFileUrl, { versionId })
            if (!fileInfo?.url) {
                throw new Error('Bible version file not found')
            }

            // Fetch the Bible JSON file
            const response = await fetch(fileInfo.url)
            if (!response.ok) {
                throw new Error(`Failed to fetch Bible file: ${response.status}`)
            }
            const verses = await response.json() as Array<{ book: string; chapter: string; verse: string; scripture: string }>
            if (!verses || verses.length === 0) {
                throw new Error('Bible version data is empty')
            }

            // Use actual verses length for progress tracking
            const totalVerses = verses.length

            // Initialize background seeding state
            if (!window.__localSeeding) {
                window.__localSeeding = new Map()
            }
            window.__localSeeding.set(versionId, {
                versionId,
                versionName: version.name,
                progress: 0,
                total: totalVerses,
                status: 'seeding',
            })
            setBackgroundSeedingStates(new Map(window.__localSeeding))

            const BATCH_SIZE = 50
            const allEmbeddings: Array<{
                reference: string
                book: string
                bookNumber: number
                chapter: number
                verse: number
                text: string
                embedding: number[]
            }> = []

            // Process in batches
            for (let i = 0; i < verses.length; i += BATCH_SIZE) {
                // Check for abort
                if (signal.aborted) {
                    throw new Error('Seeding cancelled')
                }

                const batch = verses.slice(i, i + BATCH_SIZE)

                // Generate embeddings for batch (full verses + fragments)
                const allTexts: string[] = []
                const fragmentMeta: Array<{ verseIdx: number; type: string; fragmentIndex: number }> = []

                for (let j = 0; j < batch.length; j++) {
                    const verse = batch[j]
                    const fragments = extractVerseFragments(verse.scripture)
                    for (const frag of fragments) {
                        allTexts.push(frag.text)
                        fragmentMeta.push({ verseIdx: j, type: frag.type, fragmentIndex: frag.fragmentIndex })
                    }
                }

                const embeddings = await embedBatch(allTexts)

                // Add to all embeddings
                for (let metaIdx = 0; metaIdx < fragmentMeta.length; metaIdx++) {
                    const meta = fragmentMeta[metaIdx]
                    const verse = batch[meta.verseIdx]

                    let bookNumber: number
                    let bookName: string

                    const parsedBook = parseInt(verse.book, 10)
                    if (!isNaN(parsedBook)) {
                        bookNumber = parsedBook
                        bookName = NUMBER_TO_BOOK[bookNumber] || verse.book
                    } else {
                        bookNumber = BOOK_TO_NUMBER[verse.book] ?? 0
                        bookName = verse.book
                    }

                    allEmbeddings.push({
                        reference: meta.type === 'full'
                            ? `${bookName} ${verse.chapter}:${verse.verse}`
                            : `${bookName} ${verse.chapter}:${verse.verse}__${meta.type}_${meta.fragmentIndex}`,
                        book: bookName,
                        bookNumber,
                        chapter: parseInt(verse.chapter, 10),
                        verse: parseInt(verse.verse, 10),
                        text: allTexts[metaIdx],
                        embedding: embeddings[metaIdx]?.embedding || [],
                    })
                }

                const processedCount = Math.min(i + BATCH_SIZE, totalVerses)

                // Update progress in state
                setStatuses((prev) =>
                    prev.map((s) =>
                        s.versionId === versionId
                            ? { ...s, progress: processedCount, total: totalVerses }
                            : s
                    )
                )

                // Update background state
                window.__localSeeding.set(versionId, {
                    versionId,
                    versionName: version.name,
                    progress: processedCount,
                    total: totalVerses,
                    status: 'seeding',
                })
                setBackgroundSeedingStates(new Map(window.__localSeeding))

                // Small delay to prevent UI freeze
                await new Promise((resolve) => setTimeout(resolve, 10))
            }

            // Cache locally (NO Convex upload - that's admin-only)
            await cacheVerseEmbeddings(allEmbeddings.map((e) => ({
                ...e,
                version: versionId,
                cachedAt: Date.now(),
            })))

            // Update status to completed
            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? {
                            ...s,
                            status: 'cached',
                            progress: totalVerses,
                            total: totalVerses,
                            hasLocalCache: true,
                            cachedCount: totalVerses,
                        }
                        : s
                )
            )

            // Update background state to completed
            window.__localSeeding.set(versionId, {
                versionId,
                versionName: version.name,
                progress: totalVerses,
                total: totalVerses,
                status: 'completed',
            })
            setBackgroundSeedingStates(new Map(window.__localSeeding))

            setShowSuccess(true)
            setTimeout(() => setShowSuccess(false), 2000)

            // Show notification
            showNotification(
                'Embedding Complete',
                `Successfully cached ${totalVerses.toLocaleString()} verses for ${version.name}`
            )

        } catch (error) {
            console.error(`Error seeding ${versionId}:`, error)

            const errorMessage = error instanceof Error ? error.message : 'Unknown error'

            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? { ...s, status: 'error', error: errorMessage }
                        : s
                )
            )

            // Update background state to error
            if (window.__localSeeding) {
                window.__localSeeding.set(versionId, {
                    versionId,
                    versionName: version.name,
                    progress: 0,
                    total: 0,
                    status: 'error',
                    error: errorMessage,
                })
                setBackgroundSeedingStates(new Map(window.__localSeeding))
            }
        } finally {
            setActiveSeeding(null)
            seedingAbortControllerRef.current = null
        }
    }, [bibleVersions, convex, loadModel, showNotification])

    // Clear local cache for a version
    const clearLocalCache = useCallback(async (versionId: string) => {
        const deleted = await clearCachedEmbeddingsForVersion(versionId)
        console.log(`[LocalEmbeddingSync] Cleared ${deleted} cached embeddings for ${versionId}`)

        setStatuses((prev) =>
            prev.map((s) =>
                s.versionId === versionId
                    ? { ...s, status: 'pending', hasLocalCache: false, cachedCount: 0 }
                    : s
            )
        )
    }, [])

    // Seed KJV automatically if no versions are cached
    const seedKJVAutomatically = useCallback(async () => {
        const kjv = statuses.find((s) => s.versionId.toLowerCase() === 'kjv')
        if (kjv && kjv.status === 'pending' && !activeSeeding) {
            console.log('[LocalEmbeddingSync] Auto-seeding KJV for verse detection...')
            await seedVersion(kjv.versionId)
        }
    }, [statuses, activeSeeding, seedVersion])

    // Auto-seed KJV on first load if nothing is cached
    useEffect(() => {
        if (statuses.length === 0) return

        const hasAnyCache = statuses.some((s) => s.hasLocalCache)
        if (!hasAnyCache && !activeSeeding) {
            // Check if KJV is available and auto-seed
            const kjv = statuses.find((s) => s.versionId.toLowerCase() === 'kjv')
            if (kjv && kjv.status === 'pending') {
                // Prompt user instead of auto-seeding
                // We'll show a recommendation in the UI
            }
        }
    }, [statuses, activeSeeding])

    return (
        <div className="space-y-6">
            {/* Success Toast */}
            {showSuccess && (
                <div className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg shadow-lg animate-fade-in">
                    <Check className="w-4 h-4" />
                    <span className="text-sm font-medium">Embeddings cached locally!</span>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Local Verse Embeddings
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Cache Bible verse embeddings locally for semantic detection (FREE, runs in browser)
                    </p>
                </div>
            </div>

            {/* Notification Permission */}
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

            {/* Background Seeding Info */}
            {backgroundSeedingStates.size > 0 && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                        ✨ Background caching in progress. You can close this modal and the process will continue.
                        You'll be notified when it completes.
                    </p>
                    {Array.from(backgroundSeedingStates.values()).map((state) => (
                        <div key={state.versionId} className="mt-2 text-sm">
                            <span className="font-medium">{state.versionName}:</span>{' '}
                            {state.status === 'seeding' ? (
                                <span>
                                    {Math.round((state.progress / state.total) * 100)}%
                                    ({state.progress.toLocaleString()} / {state.total.toLocaleString()} verses)
                                </span>
                            ) : state.status === 'completed' ? (
                                <span className="text-green-600 dark:text-green-400">✓ Completed</span>
                            ) : (
                                <span className="text-red-600 dark:text-red-400">✗ Error: {state.error}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Model Status */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-medium text-gray-900 dark:text-white">Embedding Model</h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {modelLoaded
                                ? '✅ Model loaded and ready'
                                : isModelLoading
                                    ? '⏳ Loading model...'
                                    : '⚪ Model not loaded'}
                        </p>
                    </div>
                    {!modelLoaded && (
                        <button
                            onClick={loadModel}
                            disabled={isModelLoading}
                            className="px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 flex items-center gap-2 transition-all shadow-sm"
                        >
                            {isModelLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                'Load Model'
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Recommendation Banner */}
            {statuses.some((s) => s.status === 'pending') && !statuses.some((s) => s.hasLocalCache) && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                        <strong>Recommendation:</strong> Cache at least one Bible version (KJV recommended) to enable semantic verse detection.
                        This allows the sermon listener to detect verses even when paraphrased.
                    </p>
                    {statuses.find((s) => s.versionId.toLowerCase() === 'kjv') && (
                        <button
                            onClick={() => {
                                const kjv = statuses.find((s) => s.versionId.toLowerCase() === 'kjv')
                                if (kjv) seedVersion(kjv.versionId)
                            }}
                            disabled={!modelLoaded || activeSeeding !== null}
                            className="mt-4 w-full px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-sm"
                        >
                            <Download className="w-4 h-4" />
                            Cache KJV Now
                        </button>
                    )}
                </div>
            )}

            {/* Version List */}
            <div className="space-y-3">
                {statuses.map((status) => (
                    <div
                        key={status.versionId}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="font-medium text-gray-900 dark:text-white">
                                    {status.versionName}
                                </h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {status.total.toLocaleString()} verses
                                    {status.cachedCount && status.hasLocalCache && (
                                        <span className="ml-2 text-green-600 dark:text-green-400">
                                            • {status.cachedCount.toLocaleString()} cached
                                        </span>
                                    )}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Status badge */}
                                {status.hasLocalCache && (
                                    <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        Cached
                                    </span>
                                )}
                                {status.status === 'pending' && !status.hasLocalCache && (
                                    <button
                                        onClick={() => seedVersion(status.versionId)}
                                        disabled={!modelLoaded || activeSeeding !== null}
                                        className="px-3 py-1.5 text-sm bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 disabled:opacity-50 flex items-center gap-1 transition-all shadow-sm"
                                    >
                                        <Download className="w-4 h-4" />
                                        Cache
                                    </button>
                                )}
                                {status.hasLocalCache && (
                                    <>
                                        <button
                                            onClick={() => seedVersion(status.versionId)}
                                            disabled={!modelLoaded || activeSeeding !== null}
                                            className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1 transition-all shadow-sm"
                                        >
                                            <RefreshCw className="w-4 h-4" />
                                            Refresh
                                        </button>
                                        <button
                                            onClick={() => clearLocalCache(status.versionId)}
                                            disabled={activeSeeding !== null}
                                            className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 flex items-center gap-1 transition-all shadow-sm"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            Clear
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Progress Bar */}
                        {status.status === 'seeding' && (
                            <div className="mt-3">
                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                    <span>Generating embeddings...</span>
                                    <span>
                                        {Math.round((status.progress / status.total) * 100)}%
                                        ({status.progress.toLocaleString()} / {status.total.toLocaleString()})
                                    </span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                    <div
                                        className="bg-[var(--accent-teal)] h-2 rounded-full transition-all"
                                        style={{ width: `${Math.min((status.progress / status.total) * 100, 100)}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Error Message */}
                        {status.error && (
                            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                                Error: {status.error}
                            </p>
                        )}
                    </div>
                ))}
            </div>

            {/* Info */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <h4 className="font-medium text-gray-900 dark:text-white mb-2">How it works</h4>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>• Embeddings are generated locally using Transformers.js (FREE)</li>
                    <li>• Model: all-MiniLM-L6-v2 (22MB, 384 dimensions)</li>
                    <li>• Processing time: ~5-10 minutes per Bible version</li>
                    <li>• Enables semantic verse detection from paraphrases</li>
                    <li>• Cached data is stored in your browser (IndexedDB)</li>
                    <li>• Works offline after initial caching</li>
                </ul>
            </div>

            {/* Close button */}
            {
                onClose && (
                    <div className="flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        >
                            Close
                        </button>
                    </div>
                )
            }
        </div >
    )
}

export default LocalEmbeddingSync
