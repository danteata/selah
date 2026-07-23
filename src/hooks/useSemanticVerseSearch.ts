/**
 * useSemanticVerseSearch Hook
 * 
 * Provides semantic search for Bible verses using vector embeddings.
 * This hook integrates with the quick actions panel to enable
 * semantic verse search when embeddings are available.
 * 
 * Features:
 * - Checks both IndexedDB (local) and Convex (remote) for embeddings
 * - Prefers local embeddings for faster, offline-capable search
 * - Generates embeddings locally using Transformers.js
 * - Falls back to Convex vector search if no local embeddings
 * - Returns verse results with similarity scores
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useConvex } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAnalytics } from './useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'
import {
    embedText,
    isEmbedderReady as checkEmbedderReady,
    initializeEmbedder,
    getCachedVerseEmbeddings,
    hasCachedEmbeddings,
    getLocalCachedVersions,
    getPrewarmedEmbeddings,
} from '../services/sermon-listener/localEmbeddings'
import {
    loadFromCached as loadVerseStore,
    getLoadedIndex,
    searchVerseEmbeddings,
} from '../services/sermon-listener/verseEmbeddingStore'
import { NUMBER_TO_BOOK } from '../services/sermon-listener/verseDetection'
import { getDynamicThreshold, validateSemanticMatch } from '../lib/semanticRetrievalPolicy'

export interface SemanticVerseResult {
    _id: string
    reference: string
    book: string
    bookNumber: number
    chapter: number
    verse: number
    text: string
    score: number
}

interface UseSemanticVerseSearchOptions {
    /** Minimum similarity threshold (0-1, default 0.55 for short phrases) */
    threshold?: number
    /** Maximum results to return (default 5) */
    limit?: number
    /** Bible version to search in (optional) */
    version?: string
    /** Debounce delay in ms (default 200) */
    debounceMs?: number
    /** Prefer local embeddings over remote (default true) */
    preferLocal?: boolean
    /** Minimum query length for semantic search (default 2) */
    minQueryLength?: number
}

interface UseSemanticVerseSearchReturn {
    /** Search results from semantic search */
    results: SemanticVerseResult[]
    /** Whether a search is in progress */
    isSearching: boolean
    /** Whether embeddings are available (local or remote) */
    hasEmbeddings: boolean | null // null = loading
    /** Whether local embeddings are available in IndexedDB */
    hasLocalEmbeddings: boolean
    /** Whether the local embedding model is ready */
    isEmbedderReady: boolean
    /** Whether the embedding model is currently loading */
    isLoadingEmbedder: boolean
    /** Error message if any */
    error: string | null
    /** Perform a semantic search */
    search: (query: string) => Promise<void>
    /** Clear results */
    clearResults: () => void
    /** Initialize the embedding model (call this early for faster first search) */
    initEmbedder: () => Promise<void>
}

const embeddingsAvailabilityCache = new Map<string, boolean>()

export function useSemanticVerseSearch(
    options: UseSemanticVerseSearchOptions = {}
): UseSemanticVerseSearchReturn {
    const {
        threshold = 0.65,
        limit = 5,
        version,
        debounceMs = 200,
        preferLocal = true,
        minQueryLength = 2,
    } = options

    const convex = useConvex()
    const { trackEvent } = useAnalytics()
    const [results, setResults] = useState<SemanticVerseResult[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const cacheKey = version || 'KJV'
    const [hasEmbeddings, setHasEmbeddings] = useState<boolean | null>(() => {
        const cached = embeddingsAvailabilityCache.get(cacheKey)
        return cached !== undefined ? cached : null
    })
    const [hasLocalEmbeddings, setHasLocalEmbeddings] = useState(false)
    const [isEmbedderReady, setIsEmbedderReady] = useState(false)
    const [isLoadingEmbedder, setIsLoadingEmbedder] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Track which version we will actually search against (may differ from requested version if fallback is needed)
    const effectiveVersionRef = useRef<string | undefined>(version)

    const debounceRef = useRef<NodeJS.Timeout | null>(null)
    const abortControllerRef = useRef<AbortController | null>(null)
    const localEmbeddingsCache = useRef<Awaited<ReturnType<typeof getCachedVerseEmbeddings>>>(null)
    const embeddingCache = useRef<Map<string, number[]>>(new Map())

    // Check if embeddings are available — but defer the heavy IndexedDB load
    // until the user actually searches. This prevents 30K+ rows being loaded
    // into JS heap on mount, blocking the UI.
    useEffect(() => {
        const checkEmbeddings = async () => {
            const requestedVersion = version || 'KJV'

            // Try pre-warmed embeddings first (instant, no IndexedDB read)
            const prewarmed = getPrewarmedEmbeddings(requestedVersion)
            if (prewarmed && prewarmed.length > 0) {
                localEmbeddingsCache.current = prewarmed
                effectiveVersionRef.current = requestedVersion
                setHasLocalEmbeddings(true)
                setHasEmbeddings(true)
                embeddingsAvailabilityCache.set(cacheKey, true)
                return
            }

            // Check if embeddings exist locally (cheap metadata check, not full load)
            let hasLocal = await hasCachedEmbeddings(requestedVersion)
            let workingVersion = requestedVersion

            if (!hasLocal) {
                const cachedVersions = await getLocalCachedVersions()
                if (cachedVersions.length > 0) {
                    // Also check pre-warmed for fallback versions
                    for (const v of cachedVersions) {
                        const pw = getPrewarmedEmbeddings(v)
                        if (pw && pw.length > 0) {
                            localEmbeddingsCache.current = pw
                            workingVersion = v
                            hasLocal = true
                            break
                        }
                    }
                    if (!hasLocal) {
                        workingVersion = cachedVersions[0]
                        hasLocal = true
                    }
                }
            }

            effectiveVersionRef.current = workingVersion

            if (hasLocal) {
                // Don't load all embeddings into memory here — defer to first search.
                // Just record that local embeddings are available.
                setHasLocalEmbeddings(true)
                setHasEmbeddings(true)
                embeddingsAvailabilityCache.set(cacheKey, true)
            } else {
                setHasLocalEmbeddings(false)
                // Fall back to checking Convex
                try {
                    const result = await convex.query(api.verseEmbeddings.hasEmbeddings, {
                        version,
                    })
                    setHasEmbeddings(result)
                    embeddingsAvailabilityCache.set(cacheKey, result)
                    if (result) {
                        effectiveVersionRef.current = version
                    }
                } catch (err) {
                    console.error('[useSemanticVerseSearch] Failed to check remote embeddings:', err)
                    setHasEmbeddings(false)
                    embeddingsAvailabilityCache.set(cacheKey, false)
                }
            }
        }
        checkEmbeddings()
    }, [convex, version])

    // Initialize the embedder
    const initEmbedder = useCallback(async () => {
        if (isEmbedderReady || isLoadingEmbedder) return

        setIsLoadingEmbedder(true)
        setError(null)

        try {
            const result = await initializeEmbedder()
            setIsEmbedderReady(result.ready)
            if (!result.ready) {
                setError('Failed to initialize embedding model')
            }
        } catch (err) {
            console.error('[useSemanticVerseSearch] Failed to initialize embedder:', err)
            setError('Failed to initialize embedding model')
            setIsEmbedderReady(false)
        } finally {
            setIsLoadingEmbedder(false)
        }
    }, [isEmbedderReady, isLoadingEmbedder])

    // Check if embedder is already ready on mount — do NOT eagerly initialize
    // here since prewarmSemanticSearch() already handles that via requestIdleCallback.
    // The embedder will be initialized lazily on first search if still not ready.
    useEffect(() => {
        const ready = checkEmbedderReady()
        setIsEmbedderReady(ready)
    }, [])

    // Perform semantic search
    const search = useCallback(async (query: string) => {
        // Clear previous debounce timer
        if (debounceRef.current) {
            clearTimeout(debounceRef.current)
        }

        // Abort previous search
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }

        // Validate inputs
        if (!query.trim() || query.trim().length < minQueryLength) {
            setResults([])
            return
        }

        if (!hasEmbeddings) {
            return
        }

        const wordCount = query.trim().split(/\s+/).length
        const dynamicThreshold = getDynamicThreshold(wordCount)

        // Debounce the search
        debounceRef.current = setTimeout(async () => {
            // Create new abort controller for this search
            const abortController = new AbortController()
            abortControllerRef.current = abortController

            setIsSearching(true)
            setError(null)

            try {
                // Ensure embedder is ready
                if (!isEmbedderReady) {
                    await initEmbedder()
                }

                if (abortController.signal.aborted) return

                // Generate embedding for the query (with cache)
                const cacheKey = query.trim().toLowerCase()
                let queryEmbedding = embeddingCache.current.get(cacheKey)
                if (!queryEmbedding) {
                    const embeddingResult = await embedText(query)
                    queryEmbedding = embeddingResult.embedding
                    if (embeddingCache.current.size > 50) {
                        const firstKey = embeddingCache.current.keys().next().value
                        if (firstKey) embeddingCache.current.delete(firstKey)
                    }
                    embeddingCache.current.set(cacheKey, queryEmbedding)
                }

                if (abortController.signal.aborted) return

                // Lazy-load embeddings into the packed-Float32Array worker
                // store on the first local search. The worker keeps the
                // index; the main thread retains only metadata-light state.
                const workingVersion = effectiveVersionRef.current || version || 'KJV'
                if (preferLocal && hasLocalEmbeddings) {
                    const loaded = getLoadedIndex()
                    if (!loaded || loaded.version !== workingVersion) {
                        let rows = getPrewarmedEmbeddings(workingVersion)
                        if (!rows || rows.length === 0) {
                            rows = await getCachedVerseEmbeddings(workingVersion)
                        }
                        if (rows && rows.length > 0) {
                            loadVerseStore(workingVersion, rows)
                            // Release our reference; the worker owns it now.
                            rows = []
                        }
                    }
                }

                if (abortController.signal.aborted) return

                let searchResults: SemanticVerseResult[] = []

                // Prefer local search if available
                const loadedIdx = getLoadedIndex()
                if (preferLocal && hasLocalEmbeddings && loadedIdx) {
                    const localResults = await searchVerseEmbeddings(
                        queryEmbedding,
                        dynamicThreshold,
                        limit,
                    )
                    searchResults = localResults.map((r) => {
                        // Determine book number - could be in bookNumber field or book field (as string or number)
                        let bookNum = r.bookNumber

                        // If bookNumber is missing or 0, try to parse from book field
                        if (!bookNum) {
                            const parsedBook = parseInt(r.book, 10)
                            if (!isNaN(parsedBook)) {
                                // book field is a number string like "45"
                                bookNum = parsedBook
                            }
                        }

                        // Get book name from bookNumber
                        const bookName = (bookNum && NUMBER_TO_BOOK[bookNum]) ||
                            // If book field is already a name (not a number), use it
                            (isNaN(parseInt(r.book)) ? r.book : 'Unknown')

                        return {
                            _id: r.reference,
                            ...r,
                            bookNumber: bookNum || 0,
                            book: bookName,
                            // Format reference as "Book Chapter:Verse"
                            reference: `${bookName} ${r.chapter}:${r.verse}`,
                        }
                    })
                } else {
                    const convexResults = await convex.action(api.verseEmbeddings.findSimilarVerses, {
                        queryEmbedding,
                        threshold: dynamicThreshold,
                        limit,
                        version: effectiveVersionRef.current || version,
                    })
                    // Also format Convex results
                    searchResults = (convexResults as SemanticVerseResult[]).map(r => {
                        const bookName = NUMBER_TO_BOOK[r.bookNumber] || r.book || 'Unknown'
                        return {
                            ...r,
                            book: bookName,
                            reference: `${bookName} ${r.chapter}:${r.verse}`,
                        }
                    })
                }

                if (abortController.signal.aborted) return

                const validatedResults = searchResults.filter(r =>
                    validateSemanticMatch(query, r.text, wordCount)
                )

                setResults(validatedResults.length > 0 ? validatedResults : searchResults)
                trackEvent(AnalyticsEventType.BIBLE_SEMANTIC_SEARCH, {
                    query_length: query.length,
                    result_count: (validatedResults.length > 0 ? validatedResults : searchResults).length,
                    used_local: preferLocal && hasLocalEmbeddings && !!loadedIdx,
                    version: workingVersion,
                })
            } catch (err) {
                if (!abortController.signal.aborted) {
                    console.error('[useSemanticVerseSearch] Search failed:', err)
                    setError('Search failed. Please try again.')
                    setResults([])
                }
            } finally {
                if (!abortController.signal.aborted) {
                    setIsSearching(false)
                }
            }
        }, debounceMs)
    }, [hasEmbeddings, hasLocalEmbeddings, isEmbedderReady, initEmbedder, convex, threshold, limit, version, debounceMs, preferLocal, minQueryLength, trackEvent])

    // Clear results
    const clearResults = useCallback(() => {
        setResults([])
        setError(null)
        if (debounceRef.current) {
            clearTimeout(debounceRef.current)
        }
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        // Aborting a running search does NOT clear isSearching in the search's
        // own `finally` (it guards on `!aborted` so a superseding search keeps
        // the spinner). Since clearResults aborts with no replacement search,
        // we must clear it here — otherwise the "Searching…" spinner hangs
        // forever (e.g. when a valid reference like "Malachi 7:8" cancels the
        // in-flight semantic search for the partial "Malachi 7").
        setIsSearching(false)
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current)
            }
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
            }
        }
    }, [])

    return {
        results,
        isSearching,
        hasEmbeddings,
        hasLocalEmbeddings,
        isEmbedderReady,
        isLoadingEmbedder,
        error,
        search,
        clearResults,
        initEmbedder,
    }
}

export default useSemanticVerseSearch
