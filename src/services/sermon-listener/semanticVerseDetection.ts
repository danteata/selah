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
        }
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

        // Add to buffer
        this.textBuffer = (this.textBuffer + ' ' + text).trim();

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

        this.lastSearchTime = Date.now();
        const searchText = this.textBuffer.slice(-MAX_TEXT_LENGTH);

        // Don't clear buffer immediately - we'll clear only matched portions
        this.pendingSearch = this.performSegmentedSearch(searchText, excludedRanges);
        const results = await this.pendingSearch;
        this.pendingSearch = null;

        // If we found matches, clear the buffer. Otherwise keep it for next search.
        if (results.length > 0) {
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
        console.log('[SemanticDetector] ========== PERFORM SEGMENTED SEARCH ==========')
        console.log('[SemanticDetector] Original text:', text.substring(0, 150))
        console.log('[SemanticDetector] Excluded ranges:', excludedRanges)

        const allMatches: SemanticVerseMatch[] = [];
        const matchedReferences = new Set<string>();

        // Filter out text segments that contain explicit verse references
        const textWithoutReferences = this.excludeRangesFromText(text, excludedRanges);
        console.log('[SemanticDetector] Text after excluding explicit references:', textWithoutReferences.substring(0, 150));

        // Strategy 1: Split into sentences and search each
        const sentences = splitIntoSentences(textWithoutReferences);
        console.log('[SemanticDetector] Split into sentences:', sentences.length, sentences);

        for (const sentence of sentences) {
            if (sentence.length < MIN_SENTENCE_LENGTH) {
                console.log('[SemanticDetector] Skipping sentence (too short):', sentence.substring(0, 50))
                continue
            };

            // Skip sentences that contain explicit verse references
            // These should be caught by regex, not semantic detection
            if (containsExplicitVerseReference(sentence)) {
                console.log('[SemanticDetector] Skipping sentence (contains explicit verse reference):', sentence.substring(0, 100))
                continue
            }

            console.log('[SemanticDetector] Searching sentence:', sentence.substring(0, 100))
            const matches = await this.performSearch(sentence);
            console.log('[SemanticDetector] Matches for sentence:', matches.map(m => ({ reference: m.reference, score: m.score })))

            // Add unique matches
            for (const match of matches) {
                if (!matchedReferences.has(match.reference)) {
                    matchedReferences.add(match.reference);
                    allMatches.push(match);
                }
            }

            // If we found good matches, stop searching more sentences
            if (matches.some(m => m.score >= 0.75)) {
                console.log('[SemanticDetector] Found good match, stopping sentence search')
                break;
            }
        }

        // Strategy 2: If no good matches from sentences, try sliding windows
        if (allMatches.length === 0 || !allMatches.some(m => m.score >= 0.65)) {
            console.log('[SemanticDetector] Trying sliding window fallback...');
            const windows = generateSlidingWindows(textWithoutReferences);

            for (const window of windows) {
                // Skip windows that contain explicit verse references
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

        console.log('[SemanticDetector] Final matches:', allMatches.map(m => ({ reference: m.reference, score: m.score })))

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
                // Use local similarity search with cached embeddings
                matches = await this.searchLocally(embedding);
            } else if (this.convexClient) {
                // Use Convex vector search
                matches = await this.searchWithConvex(embedding);
            }

            return matches;
        } catch (error) {
            console.error('[SemanticDetector] Search failed:', error);
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
        console.log('[SemanticDetector] excludeRangesFromText - input text length:', text.length, 'ranges:', ranges.length)
        if (ranges.length === 0) {
            console.log('[SemanticDetector] No ranges to exclude, returning original text')
            return text;
        }

        // Sort ranges by start index (descending) to replace from end to start
        const sortedRanges = [...ranges].sort((a, b) => b.startIndex - a.startIndex);
        console.log('[SemanticDetector] Sorted ranges:', sortedRanges)

        let result = text;
        for (const range of sortedRanges) {
            console.log('[SemanticDetector] Processing range:', range, 'text length:', text.length)
            // Only process valid ranges within text bounds
            if (range.startIndex >= 0 && range.endIndex <= text.length && range.startIndex < range.endIndex) {
                const textToExclude = text.slice(range.startIndex, range.endIndex)
                console.log('[SemanticDetector] Excluding text:', textToExclude)
                // Replace the range with spaces to preserve character positions
                const spaces = ' '.repeat(range.endIndex - range.startIndex);
                result = result.slice(0, range.startIndex) + spaces + result.slice(range.endIndex);
            } else {
                console.log('[SemanticDetector] Range out of bounds, skipping')
            }
        }

        console.log('[SemanticDetector] excludeRangesFromText - result:', result.substring(0, 150))
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
        console.log('[SemanticDetector] Searching locally with version:', this.config.version);
        let cached = await getCachedVerseEmbeddings(this.config.version);

        // If no embeddings found for specific version, try to get any available embeddings
        if (cached.length === 0) {
            console.warn('[SemanticDetector] No cached embeddings for version:', this.config.version, '- trying fallback...');

            // Try KJV as fallback (most commonly seeded)
            cached = await getCachedVerseEmbeddings('KJV');

            if (cached.length === 0) {
                // Try getting all embeddings without version filter
                cached = await getCachedVerseEmbeddings();
            }

            if (cached.length === 0) {
                console.warn('[SemanticDetector] No cached embeddings found in IndexedDB at all');
                return [];
            }

            console.log('[SemanticDetector] Using fallback embeddings, found:', cached.length);
        } else {
            console.log('[SemanticDetector] Found', cached.length, 'cached embeddings for version:', this.config.version);
        }

        const matches = findSimilarLocally(embedding, cached, this.config.threshold, this.config.limit);

        console.log('[SemanticDetector] Semantic matches found:', matches.length, 'Top match:', matches[0]);

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