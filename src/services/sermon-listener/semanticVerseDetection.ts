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

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
import {
    initializeEmbedder,
    embedText,
    embedBatch,
    isEmbedderReady,
    getCachedVerseEmbeddings,
    cacheVerseEmbeddings,
    hasCachedEmbeddings,
    findSimilarLocally,
    type CachedVerseEmbedding,
} from './localEmbeddings';
import { BOOK_PATTERN } from './verseDetection';
import { getDynamicThreshold, validateSemanticMatch } from '../../lib/semanticRetrievalPolicy';

// Configuration
const SEMANTIC_DETECTION_LIMIT = 3; // Max results per search (per query)
const MIN_TEXT_LENGTH = 50; // Minimum characters before attempting detection
const MIN_SENTENCE_LENGTH = 15; // Minimum characters for a sentence to search
const MAX_TEXT_LENGTH = 500; // Maximum characters to embed (truncated)
const THROTTLE_MS = 3000; // Throttle semantic searches to 3 seconds
const SLIDING_WINDOW_SIZE = 60; // Size of sliding window for edge cases
const SLIDING_WINDOW_STRIDE = 20; // Stride for sliding window

export interface SemanticVerseMatch {
    reference: string;
    book: string;
    chapter: number;
    verse: number;
    text: string;
    score: number;
    detectionType: 'semantic';
}

export interface SemanticDetectionConfig {
    enabled: boolean;
    limit: number;
    minTextLength: number;
    throttleMs: number;
    version?: string;
}

export interface ExcludedRange {
    startIndex: number;
    endIndex: number;
}

const DEFAULT_CONFIG: SemanticDetectionConfig = {
    enabled: true,
    limit: SEMANTIC_DETECTION_LIMIT,
    minTextLength: MIN_TEXT_LENGTH,
    throttleMs: THROTTLE_MS,
};

/**
 * Check if text contains an explicit verse reference pattern.
 * This is used to skip semantic detection on text that already has explicit references.
 * 
 * Patterns detected:
 * - "John 3:16" or "John 3 16"
 * - "John chapter 3 verse 16"
 * - "chapter 3 verse 16"
 */
function containsExplicitVerseReference(text: string): boolean {
    // Re-use the robust book pattern from verseDetection
    const bookVersePattern = new RegExp(`\\b(${BOOK_PATTERN})\\s+\\d{1,3}[:\\s]\\d{1,3}`, 'i');

    // Pattern for "chapter X verse Y" (with or without book name)
    const chapterVersePattern = /\bchapter\s+\d{1,3}\s+(?:verse\s+)?\d{1,3}/i;

    // Pattern for "X chapter Y" or "X verse Y" with book names
    const bookChapterPattern = new RegExp(`\\b(${BOOK_PATTERN})\\s+(?:chapter\\s+)?\\d{1,3}`, 'i');

    return bookVersePattern.test(text) || chapterVersePattern.test(text) || bookChapterPattern.test(text);
}

/**
 * Split text into sentences for individual searching.
 * Handles common speech patterns and Bible verse contexts.
 * Uses smart regex to avoid splitting on abbreviations and Bible references.
 */
function splitIntoSentences(text: string): string[] {
    const sentences: string[] = [];

    // First, split on double spaces (speech recognition often adds these)
    const doubleSpaceParts = text.split(/\s{2,}/);

    // Common abbreviations that shouldn't trigger sentence splits
    const abbreviations = [
        // Titles
        'St', 'Dr', 'Mr', 'Mrs', 'Ms', 'Rev', 'Prof', 'Sr', 'Jr', 'Mister', 'Madam', 'Miss',
        // Old Testament books
        'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', 'Sam', 'Kgs', 'Chron', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Pss', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
        // New Testament books
        'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', 'Cor', 'Gal', 'Eph', 'Phil', 'Col', 'Thess', 'Tim', 'Tit', 'Phlm', 'Heb', 'Jas', 'Pet', 'Jude', 'Rev',
        // Other common abbreviations
        'vs', 'etc', 'e', 'i', 'cf', 'v', 'vv', 'ch', 'chs', 'chap', 'chaps', 'Ref', 'Vol', 'Pg', 'p', 'pp'
    ];

    // Build regex pattern that avoids splitting on abbreviations
    const abbrevPattern = abbreviations.join('|');

    for (const part of doubleSpaceParts) {
        // Split on sentence boundaries with negative lookbehind for:
        // 1. Abbreviations (St., Dr., etc.)
        // 2. Digits (to avoid splitting 3:16 or "verse 1.")
        // 3. Single capital letters (to avoid splitting "A. " or "B. ")
        // 4. Common verse reference patterns
        const sentencePattern = new RegExp(
            `(?<!\\b(?:${abbrevPattern}))` + // Not after abbreviation
            `(?<!\\d)` +                      // Not after digit
            `(?<!\\s[A-Z])` +                 // Not after single capital letter
            `[.!?]` +                         // Sentence-ending punctuation
            `(?=\\s+(?:[A-Z]|["'\\(])|\\s*$)` // Followed by space + capital/quote/bracket or end (non-capturing)
        );

        const sentenceParts = part.split(sentencePattern);

        for (const sentence of sentenceParts) {
            if (typeof sentence !== 'string') continue;
            const trimmed = sentence.trim();
            if (trimmed.length >= MIN_SENTENCE_LENGTH) {
                sentences.push(trimmed);
            }
        }
    }

    return sentences;
}

/**
 * Generate sliding windows from text for edge case detection.
 * Used when sentence splitting doesn't find matches.
 */
function generateSlidingWindows(text: string): string[] {
    const windows: string[] = [];

    if (text.length <= SLIDING_WINDOW_SIZE) {
        return [text];
    }

    for (let i = 0; i <= text.length - SLIDING_WINDOW_SIZE; i += SLIDING_WINDOW_STRIDE) {
        windows.push(text.slice(i, i + SLIDING_WINDOW_SIZE));
    }

    // Always include the last window to catch text at the end
    const lastWindow = text.slice(-SLIDING_WINDOW_SIZE);
    if (!windows.includes(lastWindow)) {
        windows.push(lastWindow);
    }

    return windows;
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
/**
 * Calculate simple character-level similarity between two strings.
 * Returns a value between 0 and 1.
 */
function charSimilarity(a: string, b: string): number {
    const la = a.toLowerCase()
    const lb = b.toLowerCase()
    if (la === lb) return 1

    const shorter = la.length < lb.length ? la : lb
    const longer = la.length < lb.length ? lb : la
    if (shorter.length === 0) return 0

    let matches = 0
    let j = 0
    for (let i = 0; i < longer.length && j < shorter.length; i++) {
        if (longer[i] === shorter[j]) {
            matches++
            j++
        }
    }
    return (2 * matches) / (la.length + lb.length)
}

/**
 * Deduplicate near-identical ASR sentences.
 * ASR often produces multiple variants of the same utterance
 * (e.g. "The system has built a house" vs "Wisdom has built her house").
 * When sentences are char-similar above a threshold, keep the longest
 * (most likely the corrected/re-final version).
 */
function dedupeASRSentences(sentences: string[], similarityThreshold = 0.55): string[] {
    if (sentences.length <= 1) return sentences

    const kept: string[] = []
    const discarded = new Set<number>()

    for (let i = 0; i < sentences.length; i++) {
        if (discarded.has(i)) continue
        for (let j = i + 1; j < sentences.length; j++) {
            if (discarded.has(j)) continue
            const sim = charSimilarity(sentences[i], sentences[j])
            if (sim >= similarityThreshold) {
                const shorterIdx = sentences[i].length <= sentences[j].length ? i : j
                discarded.add(shorterIdx)
            }
        }
    }

    for (let i = 0; i < sentences.length; i++) {
        if (!discarded.has(i)) kept.push(sentences[i])
    }

    return kept
}

/**
 * Enrich short sentence fragments with surrounding context.
 * Short fragments like "Wisdom has built her house" (26 chars) embed poorly
 * against full verse text. Prepending the previous sentence gives the
 * model more semantic signal.
 */
const MAX_PROGRESSIVE_RETRIES = 2
const SHORT_SENTENCE_WORD_LIMIT = 8

export class SemanticVerseDetector {
    private convexClient: ConvexHttpClient | null = null;
    private config: SemanticDetectionConfig;
    private lastSearchTime = 0;
    private pendingSearch: Promise<SemanticVerseMatch[]> | null = null;
    private textBuffer = '';
    private initialized = false;
    private useLocalFallback = false;
    private inMemoryEmbeddings = new Map<string, CachedVerseEmbedding[]>();
    private emptyVersions = new Map<string, number>();
    private lastProcessedLength = 0;
    private initializingPromise: Promise<any> | null = null;

    constructor(config: Partial<SemanticDetectionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize the detector with Convex client and embedding model.
     */
    async initialize(convexUrl: string): Promise<{
        ready: boolean;
        modelLoaded: boolean;
        hasEmbeddings: boolean;
        error?: string;
    }> {
        if (this.initialized) {
            return {
                ready: true,
                modelLoaded: isEmbedderReady(),
                hasEmbeddings: !this.useLocalFallback,
            };
        }

        if (this.initializingPromise) {
            return this.initializingPromise;
        }

        this.initializingPromise = (async () => {
            try {
                // Initialize Convex client
                this.convexClient = new ConvexHttpClient(convexUrl);

                // Check if embeddings exist in Convex
                let hasEmbeddings = false;
                try {
                    hasEmbeddings = await this.convexClient.query(api.verseEmbeddings.hasEmbeddings, {
                        version: this.config.version,
                    });
                } catch (error) {
                    console.warn('[SemanticDetector] Could not check embedding stats, using local fallback');
                    hasEmbeddings = false;
                }

                if (!hasEmbeddings) {
                    console.warn('[SemanticDetector] No verse embeddings found in database. ' +
                        'Run seeding first or use local fallback.');
                    this.useLocalFallback = true;
                }

                // Initialize local embedding model
                const embedderStatus = await initializeEmbedder();
                this.initialized = embedderStatus.ready;

                // If using local fallback, check IndexedDB cache
                let hasLocalCache = false;
                if (this.useLocalFallback) {
                    // First check for specific version
                    if (this.config.version) {
                        hasLocalCache = await hasCachedEmbeddings(this.config.version);
                    }
                    // If not found, check for any embeddings (KJV fallback)
                    if (!hasLocalCache) {
                        hasLocalCache = await hasCachedEmbeddings('KJV');
                    }
                    // If still not found, check for any embeddings at all
                    if (!hasLocalCache) {
                        const allEmbeddings = await getCachedVerseEmbeddings();
                        hasLocalCache = allEmbeddings.length > 0;
                    }
                }

                return {
                    ready: this.initialized,
                    modelLoaded: embedderStatus.ready,
                    hasEmbeddings: hasEmbeddings || hasLocalCache,
                };
            } catch (error) {
                console.error('[SemanticDetector] Initialization failed:', error);
                return {
                    ready: false,
                    modelLoaded: false,
                    hasEmbeddings: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            } finally {
                this.initializingPromise = null;
            }
        })();

        return this.initializingPromise;
    }

    /**
     * Add text to the buffer for semantic analysis.
     * Returns detected verses if a search was triggered.
     * 
     * @param text - The text to analyze
     * @param excludedRanges - Ranges to exclude (explicit verse references already detected by regex)
     */
    async addText(text: string, excludedRanges: ExcludedRange[] = []): Promise<SemanticVerseMatch[] | null> {
        if (!this.initialized || !this.config.enabled) {
            return null;
        }

        // Detect if text was reset (e.g. new session)
        if (text.length < this.lastProcessedLength) {
            this.lastProcessedLength = 0;
            this.textBuffer = '';
            console.log('[SemanticDetector] Transcript reset detected');
        }

        // Get only the new part of the transcript
        const newPart = text.slice(this.lastProcessedLength);
        if (newPart) {
            this.textBuffer = (this.textBuffer + ' ' + newPart).trim();
            this.lastProcessedLength = text.length;
        }

        // Check if we should search
        const now = Date.now();
        const timeSinceLastSearch = now - this.lastSearchTime;
        const bufferLongEnough = this.textBuffer.length >= this.config.minTextLength;

        if (!bufferLongEnough || timeSinceLastSearch < this.config.throttleMs) {
            return null;
        }

        // Don't start a new search if one is pending
        if (this.pendingSearch) {
            return null;
        }

        // Trigger search with excluded ranges
        return this.triggerSearch(excludedRanges);
    }

    /**
     * Force a semantic search on the current buffer.
     */
    async searchNow(): Promise<SemanticVerseMatch[]> {
        if (!this.initialized) {
            return [];
        }
        return this.triggerSearch([]);
    }
    private async triggerSearch(excludedRanges: ExcludedRange[] = []): Promise<SemanticVerseMatch[]> {
        if (!this.initialized || this.pendingSearch) {
            return [];
        }

        this.lastSearchTime = Date.now();
        const searchText = this.textBuffer.slice(-MAX_TEXT_LENGTH);

        // Don't clear buffer immediately - we'll clear only matched portions
        this.pendingSearch = this.performSegmentedSearch(searchText, excludedRanges);
        const results = await this.pendingSearch;
        this.pendingSearch = null;

        // If we found matches, clear the buffer. 
        // If the buffer is getting too long without matches, clear it anyway to avoid redundant search.
        if (results.length > 0 || this.textBuffer.length > MAX_TEXT_LENGTH * 2) {
            this.textBuffer = '';
        }

        return results;
    }

    /**
     * Perform segmented search using sentence splitting and sliding windows.
     * This improves accuracy by searching individual sentences separately.
     * 
     * @param text - The text to search
     * @param excludedRanges - Ranges to exclude from semantic detection (explicit verse references)
     */
    private async performSegmentedSearch(text: string, excludedRanges: ExcludedRange[] = []): Promise<SemanticVerseMatch[]> {
        const allMatches: SemanticVerseMatch[] = [];
        const matchedReferences = new Set<string>();

        const textWithoutReferences = this.excludeRangesFromText(text, excludedRanges);
        console.log('[SemanticDetector] Text after excluding explicit references:', textWithoutReferences.substring(0, 150));

        const sentences = splitIntoSentences(textWithoutReferences);
        console.log('[SemanticDetector] Split into sentences:', sentences.length, sentences);

        const dedupedSentences = dedupeASRSentences(
            Array.from(new Set(sentences))
                .filter(sentence => sentence.length >= MIN_SENTENCE_LENGTH && !containsExplicitVerseReference(sentence))
        );

        console.log('[SemanticDetector] After dedup:', dedupedSentences.length, dedupedSentences);

        if (dedupedSentences.length > 0) {
            try {
                if (this.useLocalFallback && this.isVersionEmpty(this.config.version || 'ANY')) {
                    // Skip — no embeddings
                } else {
                    // Build progressive enrichment attempts per sentence
                    const searchItems: Array<{ text: string; sentenceIdx: number; attempt: number; wordCount: number }> = []

                    for (let i = 0; i < dedupedSentences.length; i++) {
                        const sentence = dedupedSentences[i]
                        const wordCount = sentence.split(/\s+/).length

                        // Attempt A: sentence alone (always)
                        searchItems.push({ text: sentence, sentenceIdx: i, attempt: 0, wordCount })

                        // For short sentences, prepare enrichment fallbacks (B: prev+sentence, C: sentence+next)
                        if (wordCount <= SHORT_SENTENCE_WORD_LIMIT && MAX_PROGRESSIVE_RETRIES >= 1) {
                            const prev = i > 0 ? dedupedSentences[i - 1] : ''
                            if (prev) {
                                searchItems.push({ text: `${prev} ${sentence}`, sentenceIdx: i, attempt: 1, wordCount: wordCount + prev.split(/\s+/).length })
                            }
                            const next = i < dedupedSentences.length - 1 ? dedupedSentences[i + 1] : ''
                            if (next && MAX_PROGRESSIVE_RETRIES >= 2) {
                                searchItems.push({ text: `${sentence} ${next}`, sentenceIdx: i, attempt: 2, wordCount: wordCount + next.split(/\s+/).length })
                            }
                        }
                    }

                    const textsToEmbed = searchItems.map(item => item.text)
                    const embeddingResults = await embedBatch(textsToEmbed)

                    const thresholds = searchItems.map(item => getDynamicThreshold(item.wordCount))

                    const searchMethod = this.useLocalFallback
                        ? (emb: number[], t: number) => this.searchLocally(emb, t)
                        : this.convexClient
                            ? (emb: number[], t: number) => this.searchWithConvex(emb, t)
                            : () => Promise.resolve([]);

                    const searchPromises = embeddingResults.map((res, idx) => searchMethod(res.embedding, thresholds[idx]));
                    const searchResults = await Promise.allSettled(searchPromises);

                    // Process results with progressive enrichment: for each sentence,
                    // accept the first validated hit (attempt A > B > C)
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
                            continue // Already have a validated hit for this sentence from an earlier attempt
                        }

                        const validatedMatch = matches.find(m =>
                            m.score >= dynamicThreshold &&
                            validateSemanticMatch(item.text, m.text, wordCount)
                        )

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
                }
            } catch (error) {
                console.error('[SemanticDetector] Batch search failed:', error);
            }
        }

        // Fallback: sliding window if no good matches
        const hasGoodMatch = allMatches.some(m => m.score >= 0.65)
        if (!hasGoodMatch) {
            console.log('[SemanticDetector] Trying sliding window fallback...');
            const windows = generateSlidingWindows(textWithoutReferences)
                .filter(window => !containsExplicitVerseReference(window));

            if (windows.length > 0) {
                try {
                    const windowEmbeddings = await embedBatch(windows);
                    const windowThresholds = windows.map(w => getDynamicThreshold(w.split(/\s+/).length))
                    const searchMethod = this.useLocalFallback
                        ? (emb: number[], t: number) => this.searchLocally(emb, t)
                        : this.convexClient
                            ? (emb: number[], t: number) => this.searchWithConvex(emb, t)
                            : () => Promise.resolve([]);

                    const windowSearchPromises = windowEmbeddings.map((res, idx) => searchMethod(res.embedding, windowThresholds[idx]));
                    const windowSearchResults = await Promise.allSettled(windowSearchPromises);

                    for (let idx = 0; idx < windowSearchResults.length; idx++) {
                        const result = windowSearchResults[idx]
                        if (result.status !== 'fulfilled') continue
                        const windowThreshold = windowThresholds[idx]
                        const matches = result.value as SemanticVerseMatch[]
                        for (const match of matches) {
                            if (!matchedReferences.has(match.reference) && match.score >= windowThreshold) {
                                matchedReferences.add(match.reference)
                                allMatches.push(match)
                            }
                        }
                    }
                } catch (error) {
                    console.error('[SemanticDetector] Sliding window batch search failed:', error);
                }
            }
        }

        return allMatches
            .sort((a, b) => b.score - a.score)
            .slice(0, this.config.limit);
    }

    /**
     * Perform the actual semantic search on a single text segment.
     */

    /**
     * Exclude text ranges from the text, replacing them with spaces.
     * This prevents semantic detection from matching explicit verse references.
     * 
     * @param text - The original text
     * @param ranges - Ranges to exclude (startIndex, endIndex)
     * @returns Text with excluded ranges replaced by spaces
     */
    private excludeRangesFromText(text: string, ranges: ExcludedRange[]): string {
        if (ranges.length === 0) {
            return text;
        }

        // Sort ranges by start index (descending) to replace from end to start
        const sortedRanges = [...ranges].sort((a, b) => b.startIndex - a.startIndex);
        console.log('[SemanticDetector] Sorted ranges:', sortedRanges)

        let result = text;
        for (const range of sortedRanges) {
            // Only process valid ranges within text bounds
            if (range.startIndex >= 0 && range.endIndex <= text.length && range.startIndex < range.endIndex) {
                // Replace the range with spaces to preserve character positions
                const spaces = ' '.repeat(range.endIndex - range.startIndex);
                result = result.slice(0, range.startIndex) + spaces + result.slice(range.endIndex);
            }
        }

        return result;
    }

    /**
     * Search using Convex vector search.
     */
    private async searchWithConvex(embedding: number[], threshold?: number): Promise<SemanticVerseMatch[]> {
        if (!this.convexClient) {
            return [];
        }

        try {
            const results = await this.convexClient.action(api.verseEmbeddings.findSimilarVerses, {
                queryEmbedding: embedding,
                threshold: threshold ?? 0.38,
                limit: this.config.limit,
                version: this.config.version,
            });

            return results.map((r) => ({
                reference: r.reference,
                book: r.book,
                chapter: r.chapter,
                verse: r.verse,
                text: r.text,
                score: r.score,
                detectionType: 'semantic' as const,
            }));
        } catch (error) {
            console.error('[SemanticDetector] Convex search failed:', error);
            // Fall back to local search
            return this.searchLocally(embedding, threshold);
        }
    }

    /**
     * Search using local similarity calculation.
     * Falls back to any available embeddings if the specific version has none.
     */
    private async searchLocally(embedding: number[], threshold?: number): Promise<SemanticVerseMatch[]> {
        const version = this.config.version || 'ANY';

        // 1. Try In-Memory Cache first
        let cached = this.inMemoryEmbeddings.get(version);

        // 2. Load from IndexedDB if not in memory
        if (!cached) {
            // Check if we already tried this version and it was empty
            if (this.isVersionEmpty(version)) {
                return [];
            }

            // Only log once per session per version
            console.log('[SemanticDetector] Loading local embeddings for version:', version);
            cached = await getCachedVerseEmbeddings(this.config.version);

            if (cached.length === 0) {
                // Try fallback logic only once
                if (version !== 'ANY') {
                    cached = await getCachedVerseEmbeddings('KJV');
                    if (cached.length === 0) {
                        cached = await getCachedVerseEmbeddings();
                    }
                }

                if (cached.length === 0) {
                    console.warn('[SemanticDetector] No cached embeddings found in IndexedDB at all');
                    this.emptyVersions.set(version, Date.now());
                    return [];
                }
            }

            // Store in memory for next time
            this.inMemoryEmbeddings.set(version, cached);
        }

        // Perform similarity matching using the cached list
        const matches = findSimilarLocally(embedding, cached, threshold ?? 0.38, this.config.limit);

        return matches.map((m) => ({
            reference: m.reference,
            book: m.book,
            chapter: m.chapter,
            verse: m.verse,
            text: m.text,
            score: m.score,
            detectionType: 'semantic' as const,
        }));
    }

    /**
     * Update configuration.
     */
    updateConfig(config: Partial<SemanticDetectionConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Check if a version was marked as empty. Allows retry after 30 seconds
     * so that embeddings loaded after initialization can still be found.
     */
    private isVersionEmpty(version: string): boolean {
        const timestamp = this.emptyVersions.get(version);
        if (timestamp === undefined) return false;
        // Allow retry after 30 seconds — embeddings may be seeded after init
        if (Date.now() - timestamp > 30_000) {
            this.emptyVersions.delete(version);
            return false;
        }
        return true;
    }

    /**
     * Check if the detector is ready.
     */
    isReady(): boolean {
        return this.initialized && isEmbedderReady();
    }

    /**
     * Clear the text buffer.
     */
    clearBuffer(): void {
        this.textBuffer = '';
        this.lastProcessedLength = 0;
    }

    /**
     * Get current buffer length.
     */
    getBufferLength(): number {
        return this.textBuffer.length;
    }
}

// Singleton instance
let detectorInstance: SemanticVerseDetector | null = null;

/**
 * Get or create the semantic verse detector singleton.
 */
export function getSemanticDetector(
    config?: Partial<SemanticDetectionConfig>
): SemanticVerseDetector {
    if (!detectorInstance) {
        detectorInstance = new SemanticVerseDetector(config);
    } else if (config) {
        // Update config of existing instance
        detectorInstance.updateConfig(config);
    }
    return detectorInstance;
}

/**
 * Reset the semantic detector (for testing or re-initialization).
 */
export function resetSemanticDetector(): void {
    detectorInstance = null;
}

export default SemanticVerseDetector;