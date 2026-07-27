/**
 * Semantic Verse Detection Service
 *
 * Integrates local embedding generation with Convex vector search
 * to detect Bible verses from paraphrases and quotes.
 *
 * Flow:
 * 1. Collect transcript text over a sliding window
 * 2. Generate embedding locally using Transformers.js
 * 3. Send embedding to Convex for vector search
 * 4. Merge results with regex-based detection
 */

import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import {
    initializeEmbedder,
    embedBatch,
    isEmbedderReady,
    getCachedVerseEmbeddings,
    getLocalCachedVersions,
    hasCachedEmbeddings,
    prewarmSemanticSearch,
} from './localEmbeddings'
import { hasSemanticPack, loadSemanticPack, resolveSemanticPackVersion } from './semanticPack'
import {
    loadFromCached as loadVerseStore,
    searchVerseEmbeddings,
    getLoadedIndex,
    pingWorker,
} from './verseEmbeddingStore'
import { getDynamicThreshold, validateSemanticMatch, isAmbiguousMatch } from '../../lib/semanticRetrievalPolicy'

// ---------------------------------------------------------------------------
// Text Preparation Web Worker
// ---------------------------------------------------------------------------

interface WorkerPrepareRequest {
    id: number
    text: string
    excludedRanges: ExcludedRange[]
}

interface WorkerPrepareSuccess {
    id: number
    sentences: string[]
    dedupedSentences: string[]
    windows: string[]
}

interface WorkerPrepareError {
    id: number
    error: string
}

type WorkerPrepareResponse = WorkerPrepareSuccess | WorkerPrepareError

let textWorkerInstance: Worker | null = null
let textWorkerNextId = 0
const textWorkerPending = new Map<
    number,
    { resolve: (v: WorkerPrepareSuccess) => void; reject: (e: Error) => void }
>()

function getTextWorker(): Worker {
    if (textWorkerInstance) return textWorkerInstance
    textWorkerInstance = new Worker(new URL('./textPreparation.worker.ts', import.meta.url), {
        type: 'module',
    })
    textWorkerInstance.onmessage = (event: MessageEvent<WorkerPrepareResponse>) => {
        const res = event.data
        const handler = textWorkerPending.get(res.id)
        if (!handler) return
        textWorkerPending.delete(res.id)
        if ('error' in res) {
            handler.reject(new Error(res.error))
        } else {
            handler.resolve(res)
        }
    }
    textWorkerInstance.onerror = (err) => {
        console.error('[SemanticDetector] Text worker error:', err)
        for (const [, h] of textWorkerPending) {
            h.reject(new Error('Worker failed'))
        }
        textWorkerPending.clear()
    }
    return textWorkerInstance
}

function postToTextWorker(text: string, excludedRanges: ExcludedRange[]): Promise<WorkerPrepareSuccess> {
    const worker = getTextWorker()
    const id = ++textWorkerNextId
    return new Promise((resolve, reject) => {
        textWorkerPending.set(id, { resolve, reject })
        worker.postMessage({ id, text, excludedRanges } satisfies WorkerPrepareRequest)
    })
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SEMANTIC_DETECTION_LIMIT = 5 // Max results per search (per query)
const MIN_TEXT_LENGTH = 20 // Minimum characters before attempting detection
const MAX_TEXT_LENGTH = 500 // Maximum characters to embed (truncated)
// Throttle semantic searches. This is a fixed floor added on top of however
// long the search cycle itself takes (embedding + similarity), so it directly
// shows up as perceived lag between speech and a semantic verse appearing on
// screen. `pendingSearch` (below) already prevents overlapping search cycles,
// so this doesn't need to be large to avoid runaway concurrent searches --
// it just paces back-to-back cycles once one finishes.
const THROTTLE_MS = 500

export interface SemanticVerseMatch {
    reference: string
    book: string
    chapter: number
    verse: number
    text: string
    score: number
    detectionType: 'semantic'
}

export interface SemanticDetectionConfig {
    enabled: boolean
    limit: number
    minTextLength: number
    throttleMs: number
    version?: string
}

export interface ExcludedRange {
    startIndex: number
    endIndex: number
}

const DEFAULT_CONFIG: SemanticDetectionConfig = {
    enabled: true,
    limit: SEMANTIC_DETECTION_LIMIT,
    minTextLength: MIN_TEXT_LENGTH,
    throttleMs: THROTTLE_MS,
}

/**
 * Semantic Verse Detector Class
 *
 * Manages the semantic detection lifecycle:
 * - Model initialization
 * - Text buffering
 * - Throttled searches
 * - Result caching
 */
const MAX_PROGRESSIVE_RETRIES = 2
const SHORT_SENTENCE_WORD_LIMIT = 8

export class SemanticVerseDetector {
    private convexClient: ConvexHttpClient | null = null
    private config: SemanticDetectionConfig
    private lastSearchTime = 0
    private pendingSearch: Promise<SemanticVerseMatch[]> | null = null
    private textBuffer = ''
    private initialized = false
    private useLocalFallback = false
    private lastProcessedLength = 0
    private initializingPromise: Promise<unknown> | null = null
    // The sliding-window fallback (slow, only runs when the fast sentence
    // pass found nothing confident) is deferred in the background rather
    // than blocking the caller — see `performSegmentedSearch`. This tracks
    // that background work so at most one fallback runs at a time.
    private deferredFallback: Promise<void> | null = null

    constructor(config: Partial<SemanticDetectionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
    }

    /**
     * Initialize the detector with Convex client and embedding model.
     */
    async initialize(convexUrl: string): Promise<{
        ready: boolean
        modelLoaded: boolean
        hasEmbeddings: boolean
        error?: string
    }> {
        if (this.initialized) {
            return {
                ready: true,
                modelLoaded: isEmbedderReady(),
                hasEmbeddings: !this.useLocalFallback,
            }
        }

        if (this.initializingPromise) {
            return this.initializingPromise as Promise<{
                ready: boolean
                modelLoaded: boolean
                hasEmbeddings: boolean
                error?: string
            }>
        }

        this.initializingPromise = (async () => {
            try {
                this.convexClient = new ConvexHttpClient(convexUrl)

                let hasEmbeddings = false
                let convexError = false
                try {
                    hasEmbeddings = await this.convexClient.query(api.verseEmbeddings.hasEmbeddings, {
                        version: this.config.version,
                    })
                } catch (error) {
                    console.warn('[SemanticDetector] Could not check embedding stats, using local fallback')
                    convexError = true
                    hasEmbeddings = false
                }

                const embedderStatus = await initializeEmbedder()
                this.initialized = embedderStatus.ready

                // Wait for prewarm to complete so local embeddings are available
                try {
                    await prewarmSemanticSearch()
                } catch {
                    // Prewarm failure is non-fatal — we'll try loading directly
                }

                // Check local embeddings (prewarm may have just loaded them).
                // Generated rows for the active version win; otherwise the
                // universal prebuilt pack serves it, which is the common case
                // now that we don't make users embed each version themselves.
                let hasLocalCache = false
                if (this.config.version) {
                    hasLocalCache = await hasCachedEmbeddings(this.config.version)
                }
                if (!hasLocalCache) {
                    hasLocalCache = await hasSemanticPack()
                }
                if (!hasLocalCache) {
                    // No pack — `searchLocally` still falls back to any other
                    // version's generated rows, so count those as usable too.
                    hasLocalCache = (await getLocalCachedVersions()).length > 0
                }

                if (!hasEmbeddings && !convexError) {
                    console.warn(
                        '[SemanticDetector] No verse embeddings found in database. ' +
                            'Run seeding first or use local fallback.',
                    )
                }

                // Prefer local embeddings when available — avoids sending every
                // embedding vector to Convex during live transcription (~8-15
                // action calls per search cycle = significant bandwidth).
                if (hasLocalCache) {
                    this.useLocalFallback = true
                } else if (!hasEmbeddings || convexError) {
                    this.useLocalFallback = true
                }

                // Only mark as "no embeddings" if both remote and local are empty
                if (!hasEmbeddings && !hasLocalCache) {
                    console.warn('[SemanticDetector] No embeddings available (remote or local). Semantic detection will be limited.')
                }

                return {
                    ready: this.initialized,
                    modelLoaded: embedderStatus.ready,
                    hasEmbeddings: hasEmbeddings || hasLocalCache,
                }
            } catch (error) {
                console.error('[SemanticDetector] Initialization failed:', error)
                return {
                    ready: false,
                    modelLoaded: false,
                    hasEmbeddings: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                }
            } finally {
                this.initializingPromise = null
            }
        })()

        return this.initializingPromise as Promise<{
            ready: boolean
            modelLoaded: boolean
            hasEmbeddings: boolean
            error?: string
        }>
    }

    /**
     * Add text to the buffer for semantic analysis. `onUpgrade`, if given, is
     * called at most once with a better result set if the (slower, deferred)
     * sliding-window fallback finds something after the returned promise
     * already resolved — see `performSegmentedSearch`.
     */
    async addText(
        text: string,
        excludedRanges: ExcludedRange[] = [],
        onUpgrade?: (matches: SemanticVerseMatch[]) => void,
    ): Promise<SemanticVerseMatch[] | null> {
        if (!this.initialized || !this.config.enabled) {
            return null
        }

        if (text.length < this.lastProcessedLength) {
            this.lastProcessedLength = 0
            this.textBuffer = ''
            console.log('[SemanticDetector] Transcript reset detected')
        }

        const newPart = text.slice(this.lastProcessedLength)
        if (newPart) {
            this.textBuffer = (this.textBuffer + ' ' + newPart).trim()
            this.lastProcessedLength = text.length
        }

        const now = Date.now()
        const timeSinceLastSearch = now - this.lastSearchTime
        const bufferLongEnough = this.textBuffer.length >= this.config.minTextLength

        if (!bufferLongEnough || timeSinceLastSearch < this.config.throttleMs) {
            return null
        }

        if (this.pendingSearch) {
            return null
        }

        return this.triggerSearch(excludedRanges, onUpgrade)
    }

    async searchNow(onUpgrade?: (matches: SemanticVerseMatch[]) => void): Promise<SemanticVerseMatch[]> {
        if (!this.initialized) {
            return []
        }
        return this.triggerSearch([], onUpgrade)
    }

    private async triggerSearch(
        excludedRanges: ExcludedRange[] = [],
        onUpgrade?: (matches: SemanticVerseMatch[]) => void,
    ): Promise<SemanticVerseMatch[]> {
        if (!this.initialized || this.pendingSearch) {
            return []
        }

        this.lastSearchTime = Date.now()
        const searchText = this.textBuffer.slice(-MAX_TEXT_LENGTH)

        this.pendingSearch = this.performSegmentedSearch(searchText, excludedRanges, onUpgrade)
        const results = await this.pendingSearch
        this.pendingSearch = null

        if (results.length > 0 || this.textBuffer.length > MAX_TEXT_LENGTH * 2) {
            this.textBuffer = ''
        }

        return results
    }

    /**
     * Perform segmented search using sentence splitting, offloaded to a Web
     * Worker for text preparation. Returns as soon as the (fast) sentence
     * pass completes; if it found nothing confident, the (slower) sliding
     * window fallback is kicked off in the background instead of being
     * awaited here — see `runWindowFallback`. This means a caller sees a
     * result several embedding round-trips sooner in the common case where
     * the fast pass already succeeds, and never waits on the fallback even
     * when it does run.
     */
    private async performSegmentedSearch(
        text: string,
        excludedRanges: ExcludedRange[] = [],
        onUpgrade?: (matches: SemanticVerseMatch[]) => void,
    ): Promise<SemanticVerseMatch[]> {
        const allMatches: SemanticVerseMatch[] = []
        const matchedReferences = new Set<string>()

        // Offload text preparation to the worker
        let prep: Awaited<ReturnType<typeof postToTextWorker>>
        try {
            prep = await postToTextWorker(text, excludedRanges)
        } catch (error) {
            console.error('[SemanticDetector] Text preparation worker failed:', error)
            return []
        }

        const { dedupedSentences, windows } = prep

        console.log(
            '[SemanticDetector] Worker returned',
            dedupedSentences.length,
            'deduped sentences and',
            windows.length,
            'windows',
        )

        if (dedupedSentences.length > 0) {
            try {
                // Build progressive enrichment attempts per sentence
                const searchItems: Array<{
                    text: string
                    sentenceIdx: number
                    attempt: number
                    wordCount: number
                }> = []

                for (let i = 0; i < dedupedSentences.length; i++) {
                    const sentence = dedupedSentences[i]
                    const wordCount = sentence.split(/\s+/).length

                    searchItems.push({ text: sentence, sentenceIdx: i, attempt: 0, wordCount })

                    if (wordCount <= SHORT_SENTENCE_WORD_LIMIT && MAX_PROGRESSIVE_RETRIES >= 1) {
                        const prev = i > 0 ? dedupedSentences[i - 1] : ''
                        if (prev) {
                            searchItems.push({
                                text: `${prev} ${sentence}`,
                                sentenceIdx: i,
                                attempt: 1,
                                wordCount: wordCount + prev.split(/\s+/).length,
                            })
                        }
                        const next = i < dedupedSentences.length - 1 ? dedupedSentences[i + 1] : ''
                        if (next && MAX_PROGRESSIVE_RETRIES >= 2) {
                            searchItems.push({
                                text: `${sentence} ${next}`,
                                sentenceIdx: i,
                                attempt: 2,
                                wordCount: wordCount + next.split(/\s+/).length,
                            })
                        }
                    }
                }

                const textsToEmbed = searchItems.map((item) => item.text)
                const embeddingResults = await embedBatch(textsToEmbed)

                const thresholds = searchItems.map((item) => getDynamicThreshold(item.wordCount))

                const searchMethod = this.useLocalFallback
                    ? (emb: number[], t: number) => this.searchLocally(emb, t)
                    : this.convexClient
                      ? (emb: number[], t: number) => this.searchWithConvex(emb, t)
                      : () => Promise.resolve([])

                const searchPromises = embeddingResults.map((res, idx) =>
                    searchMethod(res.embedding, thresholds[idx]),
                )
                const searchResults = await Promise.allSettled(searchPromises)

                const bestPerSentence = new Map<number, SemanticVerseMatch | null>()

                for (let idx = 0; idx < searchResults.length; idx++) {
                    const result = searchResults[idx]
                    if (result.status !== 'fulfilled') continue
                    const item = searchItems[idx]
                    const sentenceIdx = item.sentenceIdx
                    const wordCount = item.wordCount
                    const dynamicThreshold = getDynamicThreshold(wordCount)
                    const matches = result.value as SemanticVerseMatch[]

                    const currentBest = bestPerSentence.get(sentenceIdx)
                    if (currentBest !== undefined && currentBest !== null && item.attempt > 0) {
                        continue
                    }

                    const validatedMatch = matches.find((m) =>
                        m.score >= dynamicThreshold && validateSemanticMatch(item.text, m.text, wordCount),
                    )

                    // A validated match that only barely beats a different-verse
                    // runner-up is ambiguous — the embedding isn't confidently
                    // distinguishing between two distinct meanings, so we'd
                    // rather miss than risk showing the wrong one.
                    if (validatedMatch && isAmbiguousMatch(validatedMatch, matches)) {
                        continue
                    }

                    if (validatedMatch) {
                        if (!bestPerSentence.has(sentenceIdx) || bestPerSentence.get(sentenceIdx) === null) {
                            bestPerSentence.set(sentenceIdx, validatedMatch)
                        }
                    }
                }

                for (const match of bestPerSentence.values()) {
                    if (match && !matchedReferences.has(match.reference)) {
                        matchedReferences.add(match.reference)
                        allMatches.push(match)
                    }
                }
            } catch (error) {
                console.error('[SemanticDetector] Batch search failed:', error)
            }
        }

        const results = allMatches
            .sort((a, b) => b.score - a.score)
            .slice(0, this.config.limit)

        if (results.length > 0) {
            console.log(
                '[SemanticDetector] Found',
                results.length,
                'semantic match(es):',
                results.map((m) => `${m.reference} (${m.score.toFixed(3)})`).join(', '),
            )
        }

        // Sliding-window fallback: only worth trying when the sentence pass
        // found nothing confident (score >= 0.62 — a stronger bar than
        // normal, since this prevents accidental short-phrase matches like
        // voice-command residue from leaking through). Rather than making the
        // caller wait for this second, more expensive embedding pass, it runs
        // in the background; `onUpgrade` delivers a better result set a
        // moment later if it finds one. At most one fallback runs at a time.
        const hasGoodMatch = allMatches.some((m) => m.score >= 0.62)
        if (!hasGoodMatch && windows.length > 0 && !this.deferredFallback) {
            this.deferredFallback = this.runWindowFallback(windows, matchedReferences, allMatches, onUpgrade)
                .finally(() => {
                    this.deferredFallback = null
                })
        }

        return results
    }

    /**
     * The sliding-window fallback pass, run in the background (not awaited by
     * `performSegmentedSearch`). If it finds anything, merges it with the
     * matches the fast pass already found and reports the combined,
     * re-sorted result via `onUpgrade`.
     */
    private async runWindowFallback(
        windows: string[],
        matchedReferences: Set<string>,
        priorMatches: SemanticVerseMatch[],
        onUpgrade?: (matches: SemanticVerseMatch[]) => void,
    ): Promise<void> {
        console.log('[SemanticDetector] Trying sliding window fallback (background)...')
        const newMatches: SemanticVerseMatch[] = []
        try {
            const windowEmbeddings = await embedBatch(windows)
            const windowThresholds = windows.map((w) => getDynamicThreshold(w.split(/\s+/).length, 'window'))
            const searchMethod = this.useLocalFallback
                ? (emb: number[], t: number) => this.searchLocally(emb, t)
                : this.convexClient
                  ? (emb: number[], t: number) => this.searchWithConvex(emb, t)
                  : () => Promise.resolve([])

            const windowSearchPromises = windowEmbeddings.map((res, idx) =>
                searchMethod(res.embedding, windowThresholds[idx]),
            )
            const windowSearchResults = await Promise.allSettled(windowSearchPromises)

            for (let idx = 0; idx < windowSearchResults.length; idx++) {
                const result = windowSearchResults[idx]
                if (result.status !== 'fulfilled') continue
                const windowThreshold = windowThresholds[idx]
                const windowText = windows[idx]
                const windowWordCount = windowText.split(/\s+/).length
                const matches = result.value as SemanticVerseMatch[]
                for (const match of matches) {
                    if (
                        !matchedReferences.has(match.reference) &&
                        match.score >= windowThreshold &&
                        validateSemanticMatch(windowText, match.text, windowWordCount)
                    ) {
                        matchedReferences.add(match.reference)
                        newMatches.push(match)
                    }
                }
            }
        } catch (error) {
            console.error('[SemanticDetector] Sliding window batch search failed:', error)
            return
        }

        if (newMatches.length === 0) {
            return
        }

        // Mirror triggerSearch's clear-on-match behavior: when the fast pass
        // found nothing, it couldn't have cleared the buffer itself (it had
        // no results yet to base that decision on). Without this, buffered
        // text that already produced a match here would linger and get
        // redundantly re-embedded on the next cycle.
        this.textBuffer = ''

        const merged = [...priorMatches, ...newMatches]
            .sort((a, b) => b.score - a.score)
            .slice(0, this.config.limit)

        console.log(
            '[SemanticDetector] Background fallback upgrade:',
            merged.map((m) => `${m.reference} (${m.score.toFixed(3)})`).join(', '),
        )
        onUpgrade?.(merged)
    }

    /**
     * Search using Convex vector search.
     */
    private async searchWithConvex(embedding: number[], threshold?: number): Promise<SemanticVerseMatch[]> {
        if (!this.convexClient) {
            return []
        }

        try {
            const results = await this.convexClient.action(api.verseEmbeddings.findSimilarVerses, {
                queryEmbedding: embedding,
                threshold: threshold ?? 0.32,
                limit: this.config.limit,
                version: this.config.version,
            })

            return results.map((r) => ({
                reference: r.reference,
                book: r.book,
                chapter: r.chapter,
                verse: r.verse,
                text: r.text,
                score: r.score,
                detectionType: 'semantic' as const,
            }))
        } catch (error) {
            console.error('[SemanticDetector] Convex search failed, switching to local:', error)
            this.useLocalFallback = true
            return this.searchLocally(embedding, threshold)
        }
    }

    /**
     * Search using local similarity calculation. Uses the packed Float32Array
     * worker store; the first call for a given version loads embeddings from
     * IndexedDB and hands a transferred buffer to the worker, after which
     * subsequent searches are zero-allocation message round-trips.
     */
    private async searchLocally(embedding: number[], threshold?: number): Promise<SemanticVerseMatch[]> {
        const version = this.config.version || 'ANY'

        // Check what's loaded in the worker (handles both normal state and
        // HMR re-evaluation where the module-level `loaded` variable resets).
        let loaded = getLoadedIndex()
        if (!loaded) {
            try {
                const ping = await pingWorker()
                if (ping.ready && ping.version) {
                    loaded = { version: ping.version, count: ping.count, dim: ping.dim, hasFragments: false }
                }
            } catch {
                // ping failed — worker may not exist
            }
        }

        // If the worker already has a usable index (exact version, or the
        // universal prebuilt pack that serves any version), search directly.
        const packVersion = await resolveSemanticPackVersion()
        const workerHasExact = loaded && loaded.version === version
        const workerHasPack = !!packVersion && loaded?.version === packVersion
        const needPackFallback = !workerHasExact && workerHasPack && version !== packVersion

        if (needPackFallback) {
            // Confirm the requested version isn't cached locally before falling back
            const hasRequested = await hasCachedEmbeddings(version)
            if (!hasRequested) {
                console.log(
                    `[SemanticDetector] ${version} not cached; searching the ${packVersion} pack instead`,
                )
                const matches = await searchVerseEmbeddings(
                    embedding,
                    threshold ?? 0.32,
                    this.config.limit,
                )
                return matches.map((m) => ({
                    reference: m.reference,
                    book: m.book,
                    chapter: m.chapter,
                    verse: m.verse,
                    text: m.text,
                    score: m.score,
                    detectionType: 'semantic' as const,
                }))
            }
        }

        if (!workerHasExact) {
            console.log('[SemanticDetector] Loading local embeddings for version:', version)
            let cached = await getCachedVerseEmbeddings(this.config.version)

            if (cached.length === 0) {
                // Nothing generated for this version. Load the universal pack
                // — it covers every version, so this is the normal path, not a
                // degraded one. Only if there's no pack at all do we go
                // rummaging for some other version's generated rows.
                if (packVersion) {
                    const { ok } = await loadSemanticPack()
                    if (ok) {
                        const packMatches = await searchVerseEmbeddings(
                            embedding,
                            threshold ?? 0.32,
                            this.config.limit,
                        )
                        return packMatches.map((m) => ({
                            reference: m.reference,
                            book: m.book,
                            chapter: m.chapter,
                            verse: m.verse,
                            text: m.text,
                            score: m.score,
                            detectionType: 'semantic' as const,
                        }))
                    }
                }

                if (version !== 'ANY') {
                    cached = await getCachedVerseEmbeddings()
                }

                if (cached.length === 0) {
                    console.warn('[SemanticDetector] No cached embeddings found in IndexedDB at all')
                    return []
                }
            }

            const ok = loadVerseStore(version, cached)
            // Allow the entire `cached` array (and its 95 MB of inner number[]
            // buffers) to be garbage-collected. The worker now owns the data.
            cached = []
            if (!ok) {
                console.warn('[SemanticDetector] Failed to load embeddings into worker store')
                return []
            }
        }

        const matches = await searchVerseEmbeddings(
            embedding,
            threshold ?? 0.32,
            this.config.limit,
        )

        return matches.map((m) => ({
            reference: m.reference,
            book: m.book,
            chapter: m.chapter,
            verse: m.verse,
            text: m.text,
            score: m.score,
            detectionType: 'semantic' as const,
        }))
    }

    updateConfig(config: Partial<SemanticDetectionConfig>): void {
        this.config = { ...this.config, ...config }
    }

    isReady(): boolean {
        return this.initialized && isEmbedderReady()
    }

    clearBuffer(): void {
        this.textBuffer = ''
        this.lastProcessedLength = 0
    }

    getBufferLength(): number {
        return this.textBuffer.length
    }
}

// Singleton instance
let detectorInstance: SemanticVerseDetector | null = null

export function getSemanticDetector(config?: Partial<SemanticDetectionConfig>): SemanticVerseDetector {
    if (!detectorInstance) {
        detectorInstance = new SemanticVerseDetector(config)
    } else if (config) {
        detectorInstance.updateConfig(config)
    }
    return detectorInstance
}

export function resetSemanticDetector(): void {
    detectorInstance = null
}

export default SemanticVerseDetector
