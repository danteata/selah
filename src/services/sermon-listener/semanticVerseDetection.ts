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
    isEmbedderReady,
    getCachedVerseEmbeddings,
    cacheVerseEmbeddings,
    hasCachedEmbeddings,
    findSimilarLocally,
    type CachedVerseEmbedding,
} from './localEmbeddings';

// Configuration
const SEMANTIC_DETECTION_THRESHOLD = 0.55; // Minimum similarity score (lowered for better detection)
const SEMANTIC_DETECTION_LIMIT = 3; // Max results per search (per query)
const MIN_TEXT_LENGTH = 50; // Minimum characters before attempting detection
const MIN_SENTENCE_LENGTH = 20; // Minimum characters for a sentence to search
const MAX_TEXT_LENGTH = 500; // Maximum characters to embed (truncated)
const THROTTLE_MS = 3000; // Throttle semantic searches to 5 seconds (lowered for testing)
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
    threshold: number;
    limit: number;
    minTextLength: number;
    throttleMs: number;
    version?: string; // Bible version to search
}

/**
 * Represents a text range to exclude from semantic detection.
 * Used to skip explicit verse references that regex already detected.
 */
export interface ExcludedRange {
    startIndex: number;
    endIndex: number;
}

const DEFAULT_CONFIG: SemanticDetectionConfig = {
    enabled: true,
    threshold: SEMANTIC_DETECTION_THRESHOLD,
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
    // Pattern for book name followed by numbers (e.g., "John 3 16", "Matthew 7:7")
    const bookVersePattern = /\b(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1?\s?Samuel|2?\s?Samuel|1?\s?Kings|2?\s?Kings|1?\s?Chronicles|2?\s?Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Psalm|Proverbs|Ecclesiastes|Song\s?of\s?Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1?\s?Corinthians|2?\s?Corinthians|Galatians|Ephesians|Philippians|Colossians|1?\s?Thessalonians|2?\s?Thessalonians|1?\s?Timothy|2?\s?Timothy|Titus|Philemon|Hebrews|James|1?\s?Peter|2?\s?Peter|1?\s?John|2?\s?John|3?\s?John|Jude|Revelation)\s+\d{1,3}[:\s]\d{1,3}/i;

    // Pattern for "chapter X verse Y" (with or without book name)
    const chapterVersePattern = /\bchapter\s+\d{1,3}\s+(?:verse\s+)?\d{1,3}/i;

    // Pattern for "X chapter Y" or "X verse Y" with book names
    const bookChapterPattern = /\b(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Psalm|Proverbs|Ecclesiastes|Song|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\s+(?:chapter\s+)?\d{1,3}/i;

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
    // Titles: St., Dr., Mr., Mrs., Ms., Rev., Prof., Sr., Jr.
    // Biblical: Gen., Exod., Lev., Num., Deut., Ps., Prov., Eccl., Isa., Jer., Ezek., Matt., Mark., Luke., John., Acts., Rom., Cor., Gal., Eph., Phil., Col., Thess., Tim., Tit., Phlm., Heb., Jas., Pet., Jude., Rev.
    // Other: vs., etc., e.g., i.e., cf., v., vv., ch., chs.
    const abbreviations = [
        // Titles
        'St', 'Dr', 'Mr', 'Mrs', 'Ms', 'Rev', 'Prof', 'Sr', 'Jr',
        // Old Testament books
        'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', 'Sam', 'Kgs', 'Chron', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Pss', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
        // New Testament books
        'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', 'Cor', 'Gal', 'Eph', 'Phil', 'Col', 'Thess', 'Tim', 'Tit', 'Phlm', 'Heb', 'Jas', 'Pet', 'Jude', 'Rev',
        // Other common abbreviations
        'vs', 'etc', 'e', 'i', 'cf', 'v', 'vv', 'ch', 'chs', 'chap', 'chaps'
    ];

    // Build regex pattern that avoids splitting on abbreviations
    // Pattern: split on . ! ? only when NOT preceded by an abbreviation
    // and NOT preceded by a digit (like 3:16)
    const abbrevPattern = abbreviations.join('|');

    for (const part of doubleSpaceParts) {
        // Split on sentence boundaries with negative lookbehind for:
        // 1. Abbreviations (St., Dr., etc.)
        // 2. Digits (to avoid splitting 3:16)
        // 3. Single capital letters (to avoid splitting "A. " or "B. ")
        const sentencePattern = new RegExp(
            `(?<!\\b(?:${abbrevPattern}))` + // Not after abbreviation
            `(?<!\\d)` +                      // Not after digit
            `(?<!\\s[A-Z])` +                 // Not after single capital letter
            `[.!?]` +                         // Sentence-ending punctuation
            `(?=\\s+[A-Z]|\\s*$)`             // Followed by space + capital or end
        );

        const sentenceParts = part.split(sentencePattern);

        for (const sentence of sentenceParts) {
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
export class SemanticVerseDetector {
    private convexClient: ConvexHttpClient | null = null;
    private config: SemanticDetectionConfig;
    private lastSearchTime = 0;
    private pendingSearch: Promise<SemanticVerseMatch[]> | null = null;
    private textBuffer = '';
    private initialized = false;
    private useLocalFallback = false;
    private inMemoryEmbeddings = new Map<string, CachedVerseEmbedding[]>();
    private emptyVersions = new Set<string>();
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
                    const stats = await this.convexClient.query(api.verseEmbeddings.getEmbeddingStats, {
                        version: this.config.version,
                    });
                    hasEmbeddings = stats.hasEmbeddings;
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

    /**
     * Internal method to trigger a semantic search.
     * Uses sentence-based segmentation for better accuracy.
     * 
     * @param excludedRanges - Ranges to exclude from semantic detection (explicit verse references)
     */
    private async triggerSearch(excludedRanges: ExcludedRange[] = []): Promise<SemanticVerseMatch[]> {
        if (!this.initialized || this.pendingSearch) {
            return [];
        }

        // Check if we even have any embeddings to search through
        if (this.useLocalFallback && this.emptyVersions.has(this.config.version || 'ANY')) {
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

        // Filter out text segments that contain explicit verse references
        const textWithoutReferences = this.excludeRangesFromText(text, excludedRanges);
        console.log('[SemanticDetector] Text after excluding explicit references:', textWithoutReferences.substring(0, 150));

        // Strategy 1: Split into sentences and search each
        const sentences = splitIntoSentences(textWithoutReferences);
        console.log('[SemanticDetector] Split into sentences:', sentences.length, sentences);

        // Deduplicate sentences to avoid redundant searches
        const uniqueSentences = Array.from(new Set(sentences))

        const searchPromises = uniqueSentences
            .filter(sentence => sentence.length >= MIN_SENTENCE_LENGTH && !containsExplicitVerseReference(sentence))
            .map(sentence => this.performSearch(sentence))

        const searchResults = await Promise.allSettled(searchPromises)

        for (const result of searchResults) {
            if (result.status !== 'fulfilled') continue
            const matches = result.value
            for (const match of matches) {
                if (!matchedReferences.has(match.reference)) {
                    matchedReferences.add(match.reference)
                    allMatches.push(match)
                }
            }
        }

        // Early termination: if we found high-confidence matches, skip sliding windows
        const hasGoodMatch = allMatches.some(m => m.score >= 0.75)
        if (!hasGoodMatch) {
            console.log('[SemanticDetector] Trying sliding window fallback...');
            const windows = generateSlidingWindows(textWithoutReferences);

            for (const window of windows) {
                if (containsExplicitVerseReference(window)) {
                    continue
                }

                const matches = await this.performSearch(window);

                for (const match of matches) {
                    if (!matchedReferences.has(match.reference) && match.score >= 0.55) {
                        matchedReferences.add(match.reference);
                        allMatches.push(match);
                    }
                }
            }
        }

        // Sort by score and return top matches
        return allMatches
            .sort((a, b) => b.score - a.score)
            .slice(0, this.config.limit);
    }

    /**
     * Perform the actual semantic search on a single text segment.
     */
    private async performSearch(text: string): Promise<SemanticVerseMatch[]> {
        try {
            // Generate embedding locally
            const { embedding } = await embedText(text);

            let matches: SemanticVerseMatch[] = [];

            if (this.useLocalFallback) {
                // Check if we already know this version is empty
                if (this.emptyVersions.has(this.config.version || 'ANY')) {
                    return [];
                }
                // Use local similarity search with cached embeddings
                matches = await this.searchLocally(embedding);
            } else if (this.convexClient) {
                // Use Convex vector search
                matches = await this.searchWithConvex(embedding);
            }

            return matches;
        } catch (error) {
            // Only log search errors occasionally to avoid spam
            if (Math.random() < 0.1) {
                console.error('[SemanticDetector] Search failed:', error);
            }
            return [];
        }
    }

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
    private async searchWithConvex(embedding: number[]): Promise<SemanticVerseMatch[]> {
        if (!this.convexClient) {
            return [];
        }

        try {
            const results = await this.convexClient.action(api.verseEmbeddings.findSimilarVerses, {
                queryEmbedding: embedding,
                threshold: this.config.threshold,
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
            return this.searchLocally(embedding);
        }
    }

    /**
     * Search using local similarity calculation.
     * Falls back to any available embeddings if the specific version has none.
     */
    private async searchLocally(embedding: number[]): Promise<SemanticVerseMatch[]> {
        const version = this.config.version || 'ANY';

        // 1. Try In-Memory Cache first
        let cached = this.inMemoryEmbeddings.get(version);

        // 2. Load from IndexedDB if not in memory
        if (!cached) {
            // Check if we already tried this version and it was empty
            if (this.emptyVersions.has(version)) {
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
                    this.emptyVersions.add(version);
                    return [];
                }
            }

            // Store in memory for next time
            this.inMemoryEmbeddings.set(version, cached);
        }

        // Perform similarity matching using the cached list
        const matches = findSimilarLocally(embedding, cached, this.config.threshold, this.config.limit);

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