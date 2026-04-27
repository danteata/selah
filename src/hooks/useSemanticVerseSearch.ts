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
import {
    embedText,
    isEmbedderReady as checkEmbedderReady,
    initializeEmbedder,
    getCachedVerseEmbeddings,
    hasCachedEmbeddings,
    findSimilarLocally,
    getLocalCachedVersions,
} from '../services/sermon-listener/localEmbeddings'
import { NUMBER_TO_BOOK } from '../services/sermon-listener/verseDetection'

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
    /** Debounce delay in ms (default 300) */
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

/**
 * Calculate dynamic threshold based on query length.
 * Shorter queries need lower thresholds to find matches.
 */
function calculateDynamicThreshold(query: string, baseThreshold: number): number {
    const wordCount = query.trim().split(/\s+/).length

    // For very short queries (2-3 words), use much lower threshold
    if (wordCount <= 3) {
        return Math.max(0.45, baseThreshold - 0.20)
    }
    // For short queries (4-5 words), use moderately lower threshold
    if (wordCount <= 5) {
        return Math.max(0.50, baseThreshold - 0.15)
    }
    // For medium queries (6-8 words), slightly lower threshold
    if (wordCount <= 8) {
        return Math.max(0.55, baseThreshold - 0.10)
    }
    // For longer queries, use base threshold
    return baseThreshold
}

/**
 * Hook for semantic verse search using vector embeddings.
 * Supports both local (IndexedDB) and remote (Convex) embeddings.
 */
export function useSemanticVerseSearch(
    options: UseSemanticVerseSearchOptions = {}
): UseSemanticVerseSearchReturn {
    const {
        threshold = 0.65,
        limit = 5,
        version,
        debounceMs = 300,
        preferLocal = true,
        minQueryLength = 2,
    } = options

    const convex = useConvex()
    const [results, setResults] = useState<SemanticVerseResult[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [hasEmbeddings, setHasEmbeddings] = useState<boolean | null>(null)
    const [hasLocalEmbeddings, setHasLocalEmbeddings] = useState(false)
    const [isEmbedderReady, setIsEmbedderReady] = useState(false)
    const [isLoadingEmbedder, setIsLoadingEmbedder] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Track which version we will actually search against (may differ from requested version if fallback is needed)
    const effectiveVersionRef = useRef<string | undefined>(version)

    const debounceRef = useRef<NodeJS.Timeout | null>(null)
    const abortControllerRef = useRef<AbortController | null>(null)
    const localEmbeddingsCache = useRef<Awaited<ReturnType<typeof getCachedVerseEmbeddings>>>(null)

    // Check if embeddings are available (both local and remote)
    useEffect(() => {
        const checkEmbeddings = async () => {
            // First check local IndexedDB for requested version
            const requestedVersion = version || 'KJV'
            let hasLocal = await hasCachedEmbeddings(requestedVersion)
            let workingVersion = requestedVersion

            if (!hasLocal) {
                // Fallback: find another locally cached version
                const cachedVersions = await getLocalCachedVersions()
                if (cachedVersions.length > 0) {
                    workingVersion = cachedVersions[0]
                    hasLocal = true
                    console.log(`[useSemanticVerseSearch] Version ${requestedVersion} not cached. Falling back to ${workingVersion}`)
                }
            }

            effectiveVersionRef.current = workingVersion

            if (hasLocal) {
                // Load local embeddings into memory for faster search
                const localEmbeddings = await getCachedVerseEmbeddings(workingVersion)
                localEmbeddingsCache.current = localEmbeddings
                setHasLocalEmbeddings(true)
                setHasEmbeddings(true)
                console.log(`[useSemanticVerseSearch] Found ${localEmbeddings?.length || 0} local embeddings for ${workingVersion}`)
            } else {
                setHasLocalEmbeddings(false)
                // Fall back to checking Convex
                try {
                    const result = await convex.query(api.verseEmbeddings.hasEmbeddings, {
                        version,
                    })
                    setHasEmbeddings(result)
                    if (result) {
                        effectiveVersionRef.current = version
                    }
                } catch (err) {
                    console.error('[useSemanticVerseSearch] Failed to check remote embeddings:', err)
                    setHasEmbeddings(false)
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

    // Check if embedder is already ready on mount
    useEffect(() => {
        setIsEmbedderReady(checkEmbedderReady())
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

        // Calculate dynamic threshold based on query length
        const dynamicThreshold = calculateDynamicThreshold(query, threshold)
        console.log('[useSemanticVerseSearch] Query:', query, 'Word count:', query.trim().split(/\s+/).length, 'Dynamic threshold:', dynamicThreshold)

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

                // Generate embedding for the query
                const embeddingResult = await embedText(query)

                if (abortController.signal.aborted) return

                let searchResults: SemanticVerseResult[] = []

                // Prefer local search if available
                if (preferLocal && hasLocalEmbeddings && localEmbeddingsCache.current) {
                    console.log('[useSemanticVerseSearch] Using local embeddings search with threshold:', dynamicThreshold)
                    const localResults = findSimilarLocally(
                        embeddingResult.embedding,
                        localEmbeddingsCache.current,
                        dynamicThreshold,
                        limit
                    )
                    searchResults = localResults.map(r => {
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

                        console.log('[useSemanticVerseSearch] Local result:', {
                            originalRef: r.reference,
                            book: r.book,
                            bookNumber: r.bookNumber,
                            resolvedBookNum: bookNum,
                            resolvedBookName: bookName
                        })
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
                    // Fall back to Convex vector search
                    console.log('[useSemanticVerseSearch] Using Convex vector search with threshold:', dynamicThreshold)
                    const convexResults = await convex.action(api.verseEmbeddings.findSimilarVerses, {
                        queryEmbedding: embeddingResult.embedding,
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

                setResults(searchResults)
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
    }, [hasEmbeddings, hasLocalEmbeddings, isEmbedderReady, initEmbedder, convex, threshold, limit, version, debounceMs, preferLocal, minQueryLength])

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
