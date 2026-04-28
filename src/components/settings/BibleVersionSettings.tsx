import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Download, Check, Loader2, Database, Search, RefreshCw, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useScripture } from '../../hooks/useScripture'
import type { BibleVersion } from '../../types'
import {
    initializeEmbedder,
    embedBatch,
    isEmbedderReady,
    cacheVerseEmbeddings,
    hasCachedEmbeddings,
    clearCachedEmbeddingsForVersion,
    hasFragmentEmbeddings,
} from '../../services/sermon-listener/localEmbeddings'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { extractVerseFragments } from '../../lib/extractVerseFragments'

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

interface EmbeddingSyncStatus {
    versionId: string
    hasEmbeddings: boolean
    embeddingCount: number
    hasFragments: boolean
    isSyncing: boolean
    progress: number
    total: number
    stage: 'idle' | 'loading-model' | 'importing' | 'generating' | 'caching' | 'completed' | 'error'
    error?: string
    eta?: string
}

type SyncStage = 'idle' | 'loading-model' | 'importing' | 'generating' | 'caching' | 'completed' | 'error'

export function BibleVersionSettings() {
    const convex = useConvex()
    const [bibleVersionOptions, setBibleVersionOptions] = useState<BibleVersion[]>([])
    const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null)
    const [downloadProgress, setDownloadProgress] = useState(0)

    // Embedding sync state
    const [embeddingStatuses, setEmbeddingStatuses] = useState<Record<string, EmbeddingSyncStatus>>({})
    const [syncingVersion, setSyncingVersion] = useState<string | null>(null)
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [modelLoaded, setModelLoaded] = useState(false)

    // Embedding sync state

    const startTimeRef = useRef<number | null>(null)
    const progressRef = useRef<{ progress: number; time: number }[]>([])

    // Fetch available Bible versions from Convex (all users can see all available versions)
    const convexBibleVersions = useQuery(api.bibleVersions.listBibleVersions)

    // Get static fallback from app store (always call this hook unconditionally)
    const staticBibleVersions = useAppStore((state) => state.bibleVersions) as BibleVersion[]

    // Use Convex versions if available, otherwise fall back to static list
    const bibleVersions = useMemo(() => {
        return (convexBibleVersions || staticBibleVersions) as BibleVersion[]
    }, [convexBibleVersions, staticBibleVersions])

    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const setDefaultBibleVersion = useAppStore((state) => state.setDefaultBibleVersion)

    const { downloadBibleVersion, isVersionDownloaded } = useScripture()

    const [statusesLoading, setStatusesLoading] = useState(true)

    // Initialize bibleVersionOptions immediately when bibleVersions loads
    useEffect(() => {
        if (bibleVersions && bibleVersions.length > 0) {
            setBibleVersionOptions(bibleVersions.map(v => ({ ...v, isDownloaded: false })))
        }
    }, [bibleVersions])

    // Check embedding status for all versions (parallel)
    const checkEmbeddingStatuses = useCallback(async () => {
        if (!bibleVersions || bibleVersions.length === 0) return

        const entries = await Promise.all(bibleVersions.map(async (version) => {
            const hasEmb = await hasCachedEmbeddings(version.id)
            const hasFrags = hasEmb ? await hasFragmentEmbeddings(version.id) : false
            return [version.id, {
                versionId: version.id,
                hasEmbeddings: hasEmb,
                embeddingCount: 0,
                hasFragments: hasFrags,
                isSyncing: false,
                progress: 0,
                total: version.verseCount || 31102,
                stage: 'idle' as const,
            }] as const
        }))

        setEmbeddingStatuses(Object.fromEntries(entries))
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

    // Calculate ETA based on progress
    const calculateEta = useCallback((progress: number, total: number): string => {
        if (!startTimeRef.current || progress === 0) return ''

        const elapsed = Date.now() - startTimeRef.current
        const rate = progress / elapsed // verses per ms
        const remaining = total - progress
        const etaMs = remaining / rate

        // Format ETA
        const etaSeconds = Math.ceil(etaMs / 1000)
        if (etaSeconds < 60) return `${etaSeconds}s remaining`
        const etaMinutes = Math.ceil(etaSeconds / 60)
        if (etaMinutes < 60) return `${etaMinutes}m remaining`
        const etaHours = Math.floor(etaMinutes / 60)
        const remainingMinutes = etaMinutes % 60
        return `${etaHours}h ${remainingMinutes}m remaining`
    }, [])

    // Load embedding model
    const loadModel = useCallback(async () => {
        if (isEmbedderReady()) {
            setModelLoaded(true)
            return true
        }

        setIsModelLoading(true)
        try {
            const result = await initializeEmbedder()
            setModelLoaded(result.ready)
            return result.ready
        } catch (error) {
            console.error('Error loading embedding model:', error)
            return false
        } finally {
            setIsModelLoading(false)
        }
    }, [])

    // Sync embeddings for a version
    const syncEmbeddings = useCallback(async (versionId: string) => {
        const version = bibleVersions.find(v => v.id === versionId)
        if (!version) return

        setSyncingVersion(versionId)
        startTimeRef.current = Date.now()
        progressRef.current = []

        try {
            // Stage: Loading model
            setEmbeddingStatuses(prev => ({
                ...prev,
                [versionId]: {
                    ...prev[versionId],
                    isSyncing: true,
                    stage: 'loading-model',
                    progress: 0,
                }
            }))

            if (!isEmbedderReady()) {
                const loaded = await loadModel()
                if (!loaded) throw new Error('Failed to load embedding model')
            }

            // Stage: Importing Bible data
            setEmbeddingStatuses(prev => ({
                ...prev,
                [versionId]: {
                    ...prev[versionId],
                    stage: 'importing',
                }
            }))

            const fileInfo = await convex.query(api.bibleVersions.getBibleFileUrl, { versionId })
            if (!fileInfo?.url) {
                throw new Error('Bible version file not found')
            }

            // Clear old embeddings before re-seeding (ensures v1 entries are replaced with v2)
            await clearCachedEmbeddingsForVersion(versionId)

            const response = await fetch(fileInfo.url)
            if (!response.ok) {
                throw new Error(`Failed to fetch Bible file: ${response.status}`)
            }
            const verses = await response.json() as Array<{ book: string; chapter: string; verse: string; scripture: string }>
            if (!verses || verses.length === 0) {
                throw new Error('Bible version data is empty')
            }

            // Stage: Generating embeddings
            setEmbeddingStatuses(prev => ({
                ...prev,
                [versionId]: {
                    ...prev[versionId],
                    stage: 'generating',
                    total: verses.length,
                }
            }))

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
                const batch = verses.slice(i, i + BATCH_SIZE)

                // Generate fragment texts alongside full verse texts
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

                // Update progress with ETA
                const currentProgress = Math.min(i + BATCH_SIZE, verses.length)
                const eta = calculateEta(currentProgress, verses.length)

                setEmbeddingStatuses(prev => ({
                    ...prev,
                    [versionId]: {
                        ...prev[versionId],
                        progress: currentProgress,
                        eta,
                    }
                }))

                // Small delay to prevent UI freeze
                await new Promise(resolve => setTimeout(resolve, 10))
            }

            // Stage: Caching
            setEmbeddingStatuses(prev => ({
                ...prev,
                [versionId]: {
                    ...prev[versionId],
                    stage: 'caching',
                    progress: verses.length,
                }
            }))

            await cacheVerseEmbeddings(allEmbeddings.map(e => ({
                ...e,
                version: versionId,
                cachedAt: Date.now(),
            })))

            // Stage: Completed
            setEmbeddingStatuses(prev => ({
                ...prev,
                [versionId]: {
                    ...prev[versionId],
                    isSyncing: false,
                    stage: 'completed',
                    hasEmbeddings: true,
                    embeddingCount: allEmbeddings.length,
                    hasFragments: true,
                    eta: undefined,
                }
            }))

        } catch (error) {
            console.error(`Error syncing embeddings for ${versionId}:`, error)
            setEmbeddingStatuses(prev => ({
                ...prev,
                [versionId]: {
                    ...prev[versionId],
                    isSyncing: false,
                    stage: 'error',
                    error: error instanceof Error ? error.message : 'Unknown error',
                    eta: undefined,
                }
            }))
        } finally {
            setSyncingVersion(null)
            startTimeRef.current = null
        }
    }, [bibleVersions, convex, loadModel, calculateEta])

    // Clear embeddings for a version
    const clearEmbeddings = useCallback(async (versionId: string) => {
        await clearCachedEmbeddingsForVersion(versionId)
        setEmbeddingStatuses(prev => ({
            ...prev,
            [versionId]: {
                ...prev[versionId],
                hasEmbeddings: false,
                embeddingCount: 0,
                stage: 'idle',
            }
        }))
    }, [])

    // Handle download with optional auto-sync
    const handleDownload = async (versionId: string) => {
        setDownloadingVersion(versionId)
        setDownloadProgress(0)

        try {
            // Simulate progress for better UX
            const progressInterval = setInterval(() => {
                setDownloadProgress(prev => Math.min(prev + 10, 90))
            }, 200)

            const result = await downloadBibleVersion(versionId)

            clearInterval(progressInterval)
            setDownloadProgress(100)

            if (result) {
                // Refresh statuses
                await refreshDownloadStatuses()

                // Auto-sync embeddings if enabled
                if (autoSyncEnabled) {
                    await syncEmbeddings(versionId)
                }
            } else {
                alert(`Failed to download ${versionId}. Please try again.`)
            }
        } catch (error) {
            console.error('Error downloading Bible version:', error)
            alert(`Failed to download ${versionId}. Please try again.`)
        } finally {
            setDownloadingVersion(null)
            setDownloadProgress(0)
        }
    }

    useEffect(() => {
        if (bibleVersions && bibleVersions.length > 0) {
            Promise.all([refreshDownloadStatuses(), checkEmbeddingStatuses()]).finally(() => {
                setStatusesLoading(false)
            })
        }
    }, [refreshDownloadStatuses, checkEmbeddingStatuses])

    // Get stage label
    const getStageLabel = (stage: SyncStage): string => {
        switch (stage) {
            case 'loading-model': return 'Loading AI model...'
            case 'importing': return 'Importing Bible data...'
            case 'generating': return 'Generating embeddings...'
            case 'caching': return 'Saving to cache...'
            case 'completed': return 'Complete'
            case 'error': return 'Error'
            default: return ''
        }
    }

    const isLoading = !convexBibleVersions && !staticBibleVersions?.length

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                    Bible Versions
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Download Bible versions for offline use. Enable search to find verses by meaning.
                </p>
            </div>

            {/* Default Version Selector */}
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

            {/* Version List */}
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
                        const embeddingStatus = embeddingStatuses[version.id]

                        return (
                            <div
                                key={version.id}
                                className="relative py-4"
                            >
                                {/* Main row */}
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                {version.id}
                                            </span>
                                            {embeddingStatus?.hasEmbeddings && (
                                                <span className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
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
                                        {/* Status loading spinner */}
                                        {statusesLoading ? (
                                            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                                        ) : (
                                        <>
                                        {/* Download/Cache button */}
                                        {version.isDownloaded ? (
                                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                                <Check className="w-4 h-4" />
                                                <span className="text-sm">Cached</span>
                                            </div>
                                        ) : downloadingVersion === version.id ? (
                                            <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span className="text-sm">{downloadProgress}%</span>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => handleDownload(version.id)}
                                                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-primary-500 text-primary-600 dark:text-primary-400 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Download className="w-4 h-4" />
                                                Cache
                                            </button>
                                        )}

                                        {/* Embedding sync controls */}
                                        {version.isDownloaded && (
                                            embeddingStatus?.isSyncing ? (
                                                <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    <span className="text-sm">{Math.round((embeddingStatus.progress / embeddingStatus.total) * 100)}%</span>
                                                </div>
                                            ) : embeddingStatus?.hasEmbeddings ? (
                                                <div className="flex items-center gap-1">
                                                    {!embeddingStatus.hasFragments && (
                                                        <button
                                                            onClick={() => syncEmbeddings(version.id)}
                                                            disabled={syncingVersion !== null}
                                                            className="flex items-center gap-1 px-2 py-1 text-xs border border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50 font-medium"
                                                            title="Re-seed with fragment embeddings for improved short-verse detection"
                                                        >
                                                            <RefreshCw className="w-3 h-3" />
                                                            Upgrade
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => syncEmbeddings(version.id)}
                                                        disabled={syncingVersion !== null}
                                                        className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                                                        title="Refresh embeddings"
                                                    >
                                                        <RefreshCw className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => clearEmbeddings(version.id)}
                                                        disabled={syncingVersion !== null}
                                                        className="p-1.5 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                                        title="Clear embeddings"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => syncEmbeddings(version.id)}
                                                    disabled={syncingVersion !== null || isModelLoading}
                                                    className="flex items-center gap-1 px-2 py-1 text-xs border border-purple-500 text-purple-600 dark:text-purple-400 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-50"
                                                >
                                                    <Search className="w-3 h-3" />
                                                    Enable Search
                                                </button>
                                            )
                                        )}
                                        </>
                                        )}
                                    </div>
                                </div>

                                {/* Embedding sync progress */}
                                {embeddingStatus?.isSyncing && (
                                    <div className="mt-3 space-y-1">
                                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                            <span>{getStageLabel(embeddingStatus.stage)}</span>
                                            <span>
                                                {embeddingStatus.progress.toLocaleString()} / {embeddingStatus.total.toLocaleString()}
                                                {embeddingStatus.eta && ` • ${embeddingStatus.eta}`}
                                            </span>
                                        </div>
                                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                                            <div
                                                className="bg-purple-600 h-1.5 rounded-full transition-all"
                                                style={{ width: `${(embeddingStatus.progress / embeddingStatus.total) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Error message */}
                                {embeddingStatus?.error && (
                                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                                        {embeddingStatus.error}
                                    </p>
                                )}

                                {/* v1 upgrade notice */}
                                {embeddingStatus?.hasEmbeddings && !embeddingStatus.hasFragments && !embeddingStatus.isSyncing && (
                                    <div className="mt-2 flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                        <Database className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                                Fragment embeddings available
                                            </p>
                                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                                                Click <strong>Upgrade</strong> to re-seed with fragment-level embeddings for improved short-verse detection.
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
