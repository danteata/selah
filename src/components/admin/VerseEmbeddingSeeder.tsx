/**
 * Verse Embedding Seeder Component
 * 
 * Allows admins to seed verse embeddings for semantic Bible verse detection.
 * Uses Transformers.js to generate embeddings locally (FREE, no API costs).
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
            // Check each version for embeddings
            const initialStatuses: SeedingStatus[] = await Promise.all(
                bibleVersions.map(async (version) => {
                    const stats = await convex.query(api.verseEmbeddings.getEmbeddingStats, {
                        version: version.id,
                    })
                    return {
                        versionId: version.id,
                        versionName: version.name,
                        status: stats.hasEmbeddings ? 'completed' : 'pending',
                        progress: 0,
                        total: version.verseCount,
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

            // Get Bible data
            const bibleData = await convex.query(api.bibleVersions.getBibleVersion, { id: versionId })
            if (!bibleData?.data) {
                throw new Error('Bible version data not found')
            }

            const verses = bibleData.data
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

            // Book name to number mapping
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

            // Process in batches
            for (let i = 0; i < verses.length; i += BATCH_SIZE) {
                const batch = verses.slice(i, i + BATCH_SIZE)

                // Generate embeddings for batch
                const texts = batch.map((v) => v.scripture)
                const embeddings = await embedBatch(texts)

                // Add to all embeddings
                for (let j = 0; j < batch.length; j++) {
                    const verse = batch[j]
                    const bookNumber = BOOK_TO_NUMBER[verse.book] ?? 0

                    allEmbeddings.push({
                        reference: `${verse.book} ${verse.chapter}:${verse.verse}`,
                        book: verse.book,
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

            // Update status to uploading
            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? { ...s, status: 'uploading', progress: verses.length }
                        : s
                )
            )

            // Upload to Convex in chunks
            const CHUNK_SIZE = 100 // Upload 100 embeddings at a time
            for (let i = 0; i < allEmbeddings.length; i += CHUNK_SIZE) {
                const chunk = allEmbeddings.slice(i, i + CHUNK_SIZE)
                await seedEmbeddingsFromClient({
                    versionId,
                    embeddings: chunk,
                })
            }

            // Also cache locally for offline use
            await cacheVerseEmbeddings(allEmbeddings.map((e) => ({
                ...e,
                version: versionId,
                cachedAt: Date.now(),
            })))

            // Update status to completed
            setStatuses((prev) =>
                prev.map((s) =>
                    s.versionId === versionId
                        ? { ...s, status: 'completed', progress: verses.length }
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
    }, [bibleVersions, convex, loadModel, seedEmbeddingsFromClient])

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
                        Only superadmins can seed verse embeddings.
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
                        Verse Embedding Seeder
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Generate embeddings for semantic Bible verse detection (FREE, runs locally)
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
            <div className="mb-6 flex gap-3">
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
                                <StatusBadge status={status.status} />
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
