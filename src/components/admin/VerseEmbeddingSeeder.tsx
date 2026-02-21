/**
 * Verse Embedding Seeder Component (Admin Only)
 * 
 * Allows superadmins to seed verse embeddings to Convex for cross-device sync.
 * Uses Transformers.js to generate embeddings locally (FREE, no API costs).
 * 
 * NOTE: Regular users can cache embeddings locally via SermonListenerSettings.
 * This component is for superadmins who want to upload embeddings to Convex
 * for cross-device synchronization.
 */

import { useState, useEffect, useCallback } from 'react'
import { useConvex, useAction, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useUserRole } from '../../hooks/useUserRole'
import {
    initializeEmbedder,
    embedBatch,
    isEmbedderReady,
    cacheVerseEmbeddings,
    hasCachedEmbeddings,
} from '../../services/sermon-listener/localEmbeddings'

interface SeedingStatus {
    versionId: string
    versionName: string
    status: 'pending' | 'loading-model' | 'seeding' | 'uploading' | 'completed' | 'error' | 'cached'
    progress: number
    total: number
    error?: string
    hasLocalCache?: boolean
    hasConvexSync?: boolean
}

interface VerseEmbeddingSeederProps {
    onClose?: () => void
}

export function VerseEmbeddingSeeder({ onClose }: VerseEmbeddingSeederProps) {
    const convex = useConvex()
    const { isSuperadmin, isLoading: roleLoading } = useUserRole()
    const seedEmbeddingsFromClient = useAction(api.verseEmbeddings.seedEmbeddingsFromClient)

    const [statuses, setStatuses] = useState<SeedingStatus[]>([])
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [modelLoaded, setModelLoaded] = useState(false)
    const [activeSeeding, setActiveSeeding] = useState<string | null>(null)
    const [uploadToConvex, setUploadToConvex] = useState(false) // Opt-in for remote upload

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
            // Check each version for embeddings (local cache first, then Convex)
            const initialStatuses: SeedingStatus[] = await Promise.all(
                bibleVersions.map(async (version) => {
                    // Check local cache first
                    const hasLocalCache = await hasCachedEmbeddings(version.id)

                    // Check Convex sync status
                    let hasConvexSync = false
                    try {
                        const stats = await convex.query(api.verseEmbeddings.getEmbeddingStats, {
                            version: version.id,
                        })
                        hasConvexSync = stats.hasEmbeddings
                    } catch {
                        // Convex check failed, assume no sync
                    }

                    // Determine status
                    const status: SeedingStatus['status'] = hasLocalCache || hasConvexSync
                        ? 'completed'
                        : 'pending'

                    return {
                        versionId: version.id,
                        versionName: version.name,
                        status,
                        progress: 0,
                        total: version.verseCount,
                        hasLocalCache,
                        hasConvexSync,
                    }
                })
            )

            setStatuses(initialStatuses)
        }

        initializeStatuses()
    }, [bibleVersions, convex])

    // Seed embeddings for a specific version
    const seedVersion = useCallback(async (versionId: string) => {
        const version = bibleVersions?.find((v) => v.id === versionId)
        if (!version) return

        setActiveSeeding(versionId)

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
            const BATCH_SIZE = 50 // Process 50 verses at a time
            const allEmbeddings: Array<{
                reference: string
                book: string
                bookNumber: number
                chapter: number
                verse: number
                text: string
                embedding: number[]
            }> = []

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

            // Process in batches
            for (let i = 0; i < verses.length; i += BATCH_SIZE) {
                const batch = verses.slice(i, i + BATCH_SIZE)

                // Generate embeddings for batch
                const texts = batch.map((v) => v.scripture)
                const embeddings = await embedBatch(texts)

                // Add to all embeddings (include bookNumber for local cache)
                for (let j = 0; j < batch.length; j++) {
                    const verse = batch[j]

                    // Determine book number and name
                    // Bible JSON files may have book as numeric string ("43") or name ("John")
                    let bookNumber: number
                    let bookName: string

                    const parsedBook = parseInt(verse.book, 10)
                    if (!isNaN(parsedBook)) {
                        // book field is a number string like "43"
                        bookNumber = parsedBook
                        bookName = NUMBER_TO_BOOK[bookNumber] || verse.book
                    } else {
                        // book field is a name like "John"
                        bookNumber = BOOK_TO_NUMBER[verse.book] ?? 0
                        bookName = verse.book
                    }

                    allEmbeddings.push({
                        reference: `${bookName} ${verse.chapter}:${verse.verse}`,
                        book: bookName,
                        bookNumber,
                        chapter: parseInt(verse.chapter, 10),
                        verse: parseInt(verse.verse, 10),
                        text: verse.scripture,
                        embedding: embeddings[j].embedding,
                    })
                }

                // Update progress
                setStatuses((prev) =>
                    prev.map((s) =>
                        s.versionId === versionId
                            ? { ...s, progress: Math.min(i + BATCH_SIZE, verses.length) }
                            : s
                    )
                )

                // Small delay to prevent UI freeze
                await new Promise((resolve) => setTimeout(resolve, 10))
            }

            // Cache locally first (this is the primary storage for local-first approach)
            await cacheVerseEmbeddings(allEmbeddings.map((e) => ({
                ...e,
                version: versionId,
                cachedAt: Date.now(),
            })))

            // Upload to Convex only if opted in (for cross-device sync)
            if (uploadToConvex) {
                // Update status to uploading
                setStatuses((prev) =>
                    prev.map((s) =>
                        s.versionId === versionId
                            ? { ...s, status: 'uploading', progress: verses.length }
                            : s
                    )
                )

                try {
                    const CHUNK_SIZE = 100 // Upload 100 embeddings at a time
                    for (let i = 0; i < allEmbeddings.length; i += CHUNK_SIZE) {
                        const chunk = allEmbeddings.slice(i, i + CHUNK_SIZE)
                        await seedEmbeddingsFromClient({
                            versionId,
                            embeddings: chunk,
                        })
                    }
                } catch (uploadError) {
                    // Log but don't fail - local cache is sufficient
                    console.warn(`Convex upload failed for ${versionId}, but local cache is available:`, uploadError)
                }
            }

            // Update status to completed with sync flags
            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? {
                            ...s,
                            status: 'completed',
                            progress: verses.length,
                            hasLocalCache: true,
                            hasConvexSync: uploadToConvex,
                        }
                        : s
                )
            )
        } catch (error) {
            console.error(`Error seeding ${versionId}:`, error)
            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? { ...s, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
                        : s
                )
            )
        } finally {
            setActiveSeeding(null)
        }
    }, [bibleVersions, convex, loadModel, seedEmbeddingsFromClient, uploadToConvex])

    // Seed all pending versions
    const seedAllPending = useCallback(async () => {
        const pending = statuses.filter((s) => s.status === 'pending')
        for (const status of pending) {
            await seedVersion(status.versionId)
        }
    }, [statuses, seedVersion])

    // Check access
    if (!roleLoading && !isSuperadmin) {
        return (
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
                <div className="text-center py-12">
                    <div className="text-red-500 text-6xl mb-4">🚫</div>
                    <h2 className="text-xl font-semibold text-gray-900 mb-2">
                        Access Denied
                    </h2>
                    <p className="text-gray-600">
                        Only superadmins can upload embeddings to Convex for cross-device sync.
                    </p>
                    <p className="text-gray-500 text-sm mt-2">
                        Users can cache embeddings locally via Sermon Listener Settings.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                        Verse Embedding Seeder (Admin)
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Upload embeddings to Convex for cross-device sync (local caching available to all users)
                    </p>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Model Status */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-medium text-gray-900">Embedding Model</h3>
                        <p className="text-sm text-gray-500">
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

            {/* Actions */}
            <div className="mb-6 space-y-3">
                {/* Upload option */}
                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <input
                        type="checkbox"
                        id="uploadToConvex"
                        checked={uploadToConvex}
                        onChange={(e) => setUploadToConvex(e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="uploadToConvex" className="text-sm text-gray-700">
                        <span className="font-medium">Also upload to Convex</span>
                        <span className="text-gray-500"> (optional, for cross-device sync)</span>
                    </label>
                </div>

                <button
                    onClick={seedAllPending}
                    disabled={!modelLoaded || activeSeeding !== null}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                    Seed All Pending
                </button>
            </div>

            {/* Version List */}
            <div className="space-y-3">
                {statuses.map((status) => (
                    <div
                        key={status.versionId}
                        className="border rounded-lg p-4"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <h4 className="font-medium text-gray-900">
                                    {status.versionName}
                                </h4>
                                <p className="text-sm text-gray-500">
                                    {status.total.toLocaleString()} verses
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Show local/convex status badges */}
                                {status.hasLocalCache && (
                                    <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-700">
                                        💾 Local
                                    </span>
                                )}
                                {status.hasConvexSync && (
                                    <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                                        ☁️ Synced
                                    </span>
                                )}
                                {!status.hasLocalCache && !status.hasConvexSync && status.status === 'pending' && (
                                    <StatusBadge status={status.status} />
                                )}
                                {status.status === 'pending' && (
                                    <button
                                        onClick={() => seedVersion(status.versionId)}
                                        disabled={!modelLoaded || activeSeeding !== null}
                                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        Seed
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Progress Bar */}
                        {(status.status === 'seeding' || status.status === 'uploading') && (
                            <div className="mt-2">
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>
                                        {status.status === 'seeding' ? 'Generating embeddings...' : 'Uploading to database...'}
                                    </span>
                                    <span>{status.progress.toLocaleString()} / {status.total.toLocaleString()}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                        className="bg-blue-600 h-2 rounded-full transition-all"
                                        style={{ width: `${(status.progress / status.total) * 100}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Error Message */}
                        {status.error && (
                            <p className="mt-2 text-sm text-red-600">
                                Error: {status.error}
                            </p>
                        )}
                    </div>
                ))}
            </div>

            {/* Info */}
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-2">How it works</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                    <li>• Embeddings are generated locally using Transformers.js (FREE)</li>
                    <li>• Model: all-MiniLM-L6-v2 (22MB, 384 dimensions)</li>
                    <li>• Processing time: ~5-10 minutes per Bible version</li>
                    <li>• Enables semantic verse detection from paraphrases</li>
                </ul>
            </div>
        </div>
    )
}

// Status badge component
function StatusBadge({ status }: { status: SeedingStatus['status'] }) {
    const styles: Record<SeedingStatus['status'], string> = {
        pending: 'bg-gray-100 text-gray-600',
        'loading-model': 'bg-yellow-100 text-yellow-700',
        seeding: 'bg-blue-100 text-blue-700',
        uploading: 'bg-purple-100 text-purple-700',
        completed: 'bg-green-100 text-green-700',
        error: 'bg-red-100 text-red-700',
        cached: 'bg-indigo-100 text-indigo-700',
    }

    const labels: Record<SeedingStatus['status'], string> = {
        pending: 'Pending',
        'loading-model': 'Loading Model',
        seeding: 'Seeding',
        uploading: 'Uploading',
        completed: 'Completed',
        error: 'Error',
        cached: 'Cached Locally',
    }

    return (
        <span className={`px-2 py-1 text-xs font-medium rounded ${styles[status]}`}>
            {labels[status]}
        </span>
    )
}

export default VerseEmbeddingSeeder
