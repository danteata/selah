/**
 * Verse Embedding Uploader (Admin Only)
 * 
 * Allows superadmins to upload verse embeddings to Convex for cross-device sync.
 * This is ONLY for uploading to the remote database - local caching is available
 * to all users via LocalEmbeddingSync in the general settings.
 * 
 * Features:
 * - Upload embeddings to Convex for cross-device synchronization
 * - Background processing with notifications
 * - Accurate progress tracking
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useConvex, useAction, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useUserRole } from '../../hooks/useUserRole'
import {
    initializeEmbedder,
    embedBatch,
    isEmbedderReady,
} from '../../services/sermon-listener/localEmbeddings'
import { extractVerseFragments } from '../../lib/extractVerseFragments'

interface UploadStatus {
    versionId: string
    versionName: string
    status: 'pending' | 'loading-model' | 'generating' | 'uploading' | 'completed' | 'error'
    progress: number
    total: number
    error?: string
    hasConvexSync?: boolean
}

interface VerseEmbeddingUploaderProps {
    onClose?: () => void
}

// Global state for background uploads (persists across modal closes)
interface BackgroundUploadState {
    versionId: string
    versionName: string
    progress: number
    total: number
    status: 'generating' | 'uploading' | 'completed' | 'error'
    error?: string
}

// Store background upload state in window for persistence
declare global {
    interface Window {
        __backgroundUpload?: Map<string, BackgroundUploadState>
    }
}

// Initialize global state
if (typeof window !== 'undefined') {
    if (!window.__backgroundUpload) {
        window.__backgroundUpload = new Map()
    }
}

export function VerseEmbeddingUploader({ onClose }: VerseEmbeddingUploaderProps) {
    const convex = useConvex()
    const { isSuperadmin, isLoading: roleLoading } = useUserRole()
    const seedEmbeddingsFromClient = useAction(api.verseEmbeddings.seedEmbeddingsFromClient)

    const [statuses, setStatuses] = useState<UploadStatus[]>([])
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [modelLoaded, setModelLoaded] = useState(false)
    const [activeUpload, setActiveUpload] = useState<string | null>(null)
    const [backgroundUploadStates, setBackgroundUploadStates] = useState<Map<string, BackgroundUploadState>>(new Map())

    // Ref to track if component is mounted
    const isMountedRef = useRef(true)

    // Check for browser notification permission
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default')

    useEffect(() => {
        if ('Notification' in window) {
            setNotificationPermission(Notification.permission)
        }
    }, [])

    const requestNotificationPermission = useCallback(async () => {
        if ('Notification' in window && Notification.permission === 'default') {
            const permission = await Notification.requestPermission()
            setNotificationPermission(permission)
            return permission
        }
        return Notification.permission
    }, [])

    // Show notification
    const showNotification = useCallback((title: string, body: string) => {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/vite.svg' })
        }
    }, [])

    // Get available Bible versions
    const bibleVersions = useQuery(api.bibleVersions.listBibleVersions)

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
            const initialStatuses: UploadStatus[] = await Promise.all(
                bibleVersions.map(async (version) => {
                    // Check Convex sync status
                    let hasConvexSync = false
                    try {
                        hasConvexSync = await convex.query(api.verseEmbeddings.hasEmbeddings, {
                            version: version.id,
                        })
                    } catch {
                        // Convex check failed, assume no sync
                    }

                    // Check for background upload state
                    const bgState = window.__backgroundUpload?.get(version.id)

                    // Determine status
                    let status: UploadStatus['status'] = hasConvexSync ? 'completed' : 'pending'

                    // If there's an active background upload, show that status
                    if (bgState && (bgState.status === 'generating' || bgState.status === 'uploading')) {
                        status = bgState.status
                    }

                    return {
                        versionId: version.id,
                        versionName: version.name,
                        status,
                        progress: bgState?.progress || 0,
                        total: bgState?.total || version.verseCount,
                        hasConvexSync,
                    }
                })
            )

            setStatuses(initialStatuses)
        }

        initializeStatuses()

        return () => {
            isMountedRef.current = false
        }
    }, [bibleVersions, convex])

    // Poll for background upload updates
    useEffect(() => {
        const pollInterval = setInterval(() => {
            if (window.__backgroundUpload) {
                setBackgroundUploadStates(new Map(window.__backgroundUpload))

                // Update statuses based on background state
                setStatuses(prev => prev.map(status => {
                    const bgState = window.__backgroundUpload?.get(status.versionId)
                    if (bgState) {
                        return {
                            ...status,
                            status: bgState.status,
                            progress: bgState.progress,
                            total: bgState.total,
                            error: bgState.error,
                        }
                    }
                    return status
                }))
            }
        }, 500)

        return () => clearInterval(pollInterval)
    }, [])

    // Upload embeddings for a specific version to Convex
    const uploadVersion = useCallback(async (versionId: string) => {
        const version = bibleVersions?.find((v) => v.id === versionId)
        if (!version) return

        setActiveUpload(versionId)

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

            // Update status to generating
            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? { ...s, status: 'generating' }
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

            const totalVerses = verses.length

            // Initialize background state
            window.__backgroundUpload?.set(versionId, {
                versionId,
                versionName: version.name,
                progress: 0,
                total: totalVerses,
                status: 'generating',
            })

            const BATCH_SIZE = 50
            const allEmbeddings: Array<{
                reference: string
                book: string
                bookNumber: number
                chapter: number
                verse: number
                text: string
                embedding: number[]
                fragmentType?: string
                fragmentIndex?: number
                embeddingVersion?: string
            }> = []

            // Book mappings
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

            // Process in batches
            for (let i = 0; i < verses.length; i += BATCH_SIZE) {
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
                let embIdx = 0
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
                        embedding: embeddings[embIdx]?.embedding || [],
                        fragmentType: meta.type,
                        fragmentIndex: meta.fragmentIndex,
                        embeddingVersion: 'v2_fragments',
                    })
                    embIdx++
                }

                const processedCount = Math.min(i + BATCH_SIZE, totalVerses)

                // Update background state
                window.__backgroundUpload?.set(versionId, {
                    versionId,
                    versionName: version.name,
                    progress: processedCount,
                    total: totalVerses,
                    status: 'generating',
                })

                if (isMountedRef.current) {
                    setStatuses((prev) =>
                        prev.map((s) =>
                            s.versionId === versionId
                                ? { ...s, progress: processedCount, total: totalVerses }
                                : s
                        )
                    )
                }

                await new Promise((resolve) => setTimeout(resolve, 10))
            }

            // Update status to uploading
            window.__backgroundUpload?.set(versionId, {
                versionId,
                versionName: version.name,
                progress: totalVerses,
                total: totalVerses,
                status: 'uploading',
            })

            if (isMountedRef.current) {
                setStatuses((prev) =>
                    prev.map((s) =>
                        s.versionId === versionId
                            ? { ...s, status: 'uploading', progress: totalVerses }
                            : s
                    )
                )
            }

            // Upload to Convex
            const CHUNK_SIZE = 100
            for (let i = 0; i < allEmbeddings.length; i += CHUNK_SIZE) {
                const chunk = allEmbeddings.slice(i, i + CHUNK_SIZE)
                await seedEmbeddingsFromClient({
                    versionId,
                    embeddings: chunk,
                })
            }

            // Update status to completed
            window.__backgroundUpload?.set(versionId, {
                versionId,
                versionName: version.name,
                progress: totalVerses,
                total: totalVerses,
                status: 'completed',
            })

            if (isMountedRef.current) {
                setStatuses((prev) =>
                    prev.map((s) =>
                        s.versionId === versionId
                            ? {
                                ...s,
                                status: 'completed',
                                progress: totalVerses,
                                total: totalVerses,
                                hasConvexSync: true,
                            }
                            : s
                    )
                )
            }

            // Show notification
            showNotification(
                'Upload Complete',
                `Successfully uploaded embeddings for ${version.name} (${totalVerses.toLocaleString()} verses)`
            )
        } catch (error) {
            console.error(`Error uploading ${versionId}:`, error)

            window.__backgroundUpload?.set(versionId, {
                versionId,
                versionName: version.name,
                progress: 0,
                total: 0,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
            })

            if (isMountedRef.current) {
                setStatuses((prev) =>
                    prev.map((s) =>
                        s.versionId === versionId
                            ? { ...s, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
                            : s
                    )
                )
            }

            showNotification(
                'Upload Error',
                `Failed to upload embeddings for ${version.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
        } finally {
            if (isMountedRef.current) {
                setActiveUpload(null)
            }
        }
    }, [bibleVersions, convex, loadModel, seedEmbeddingsFromClient, showNotification])

    // Upload all pending versions
    const uploadAllPending = useCallback(async () => {
        const pending = statuses.filter((s) => s.status === 'pending')
        for (const status of pending) {
            await uploadVersion(status.versionId)
        }
    }, [statuses, uploadVersion])

    // Check access
    if (!roleLoading && !isSuperadmin) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
                <div className="text-center py-12">
                    <div className="text-red-500 text-6xl mb-4">🚫</div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                        Access Denied
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400">
                        Only superadmins can upload embeddings to the remote database.
                    </p>
                    <p className="text-gray-500 dark:text-gray-500 text-sm mt-2">
                        Users can cache embeddings locally via Settings → Sermon Listener.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        Upload Embeddings to Database
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Upload verse embeddings to Convex for cross-device synchronization
                    </p>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Model Status */}
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-medium text-gray-900 dark:text-white">Embedding Model</h3>
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
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                            {isModelLoading ? 'Loading...' : 'Load Model'}
                        </button>
                    )}
                </div>
            </div>

            {/* Notification Permission */}
            {notificationPermission !== 'granted' && (
                <div className="mb-6 flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/30 rounded-lg border border-amber-200 dark:border-amber-700">
                    <span className="text-sm text-amber-800 dark:text-amber-300">
                        🔔 Enable notifications to be alerted when uploads complete
                    </span>
                    <button
                        onClick={requestNotificationPermission}
                        className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                    >
                        Enable
                    </button>
                </div>
            )}

            {/* Background Upload Info */}
            {backgroundUploadStates.size > 0 && (
                <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                        ✨ Upload in progress. You can close this modal and the process will continue.
                        You'll be notified when it completes.
                    </p>
                </div>
            )}

            {/* Upload All Button */}
            <div className="mb-6">
                <button
                    onClick={uploadAllPending}
                    disabled={!modelLoaded || activeUpload !== null}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                    Upload All Pending
                </button>
            </div>

            {/* Version List */}
            <div className="space-y-3">
                {statuses.map((status) => (
                    <div
                        key={status.versionId}
                        className="border border-gray-200 dark:border-gray-600 rounded-lg p-4"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <h4 className="font-medium text-gray-900 dark:text-white">
                                    {status.versionName}
                                </h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {status.total.toLocaleString()} verses
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {status.hasConvexSync && (
                                    <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                        ☁️ Synced
                                    </span>
                                )}
                                {status.status === 'pending' && (
                                    <button
                                        onClick={() => uploadVersion(status.versionId)}
                                        disabled={!modelLoaded || activeUpload !== null}
                                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        Upload
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Progress Bar */}
                        {(status.status === 'generating' || status.status === 'uploading') && (
                            <div className="mt-2">
                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                    <span>
                                        {status.status === 'generating' ? 'Generating embeddings...' : 'Uploading to database...'}
                                    </span>
                                    <span>
                                        {Math.round((status.progress / status.total) * 100)}%
                                        ({status.progress.toLocaleString()} / {status.total.toLocaleString()})
                                    </span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                                    <div
                                        className="bg-blue-600 h-2 rounded-full transition-all"
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
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-2">How it works</h4>
                <ul className="text-sm text-blue-800 dark:text-blue-400 space-y-1">
                    <li>• Embeddings are generated locally using Transformers.js (FREE)</li>
                    <li>• Model: all-MiniLM-L6-v2 (22MB, 384 dimensions)</li>
                    <li>• Processing time: ~5-10 minutes per Bible version</li>
                    <li>• Uploaded embeddings sync across all devices</li>
                    <li>• Users can also cache locally via Settings → Sermon Listener</li>
                </ul>
            </div>
        </div>
    )
}

export default VerseEmbeddingUploader
