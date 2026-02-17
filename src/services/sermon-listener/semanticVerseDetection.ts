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
const SEMANTIC_DETECTION_LIMIT = 5; // Max results per search
const MIN_TEXT_LENGTH = 50; // Minimum characters before attempting detection
const MAX_TEXT_LENGTH = 500; // Maximum characters to embed (truncated)
const THROTTLE_MS = 5000; // Throttle semantic searches to 5 seconds (lowered for testing)

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

const DEFAULT_CONFIG: SemanticDetectionConfig = {
    enabled: true,
    threshold: SEMANTIC_DETECTION_THRESHOLD,
    limit: SEMANTIC_DETECTION_LIMIT,
    minTextLength: MIN_TEXT_LENGTH,
    throttleMs: THROTTLE_MS,
};

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
            if (this.useLocalFallback && this.config.version) {
                hasLocalCache = await hasCachedEmbeddings(this.config.version);
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
     */
    async addText(text: string): Promise<SemanticVerseMatch[] | null> {
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

        // Trigger search
        return this.triggerSearch();
    }

    /**
     * Force a semantic search on the current buffer.
     */
    async searchNow(): Promise<SemanticVerseMatch[]> {
        if (!this.initialized) {
            return [];
        }
        return this.triggerSearch();
    }

    /**
     * Internal method to trigger a semantic search.
     */
    private async triggerSearch(): Promise<SemanticVerseMatch[]> {
        if (!this.initialized || this.pendingSearch) {
            return [];
        }

        this.lastSearchTime = Date.now();
        const searchText = this.textBuffer.slice(-MAX_TEXT_LENGTH);
        this.textBuffer = ''; // Clear buffer after search

        this.pendingSearch = this.performSearch(searchText);
        const results = await this.pendingSearch;
        this.pendingSearch = null;

        return results;
    }

    /**
     * Perform the actual semantic search.
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
     */
    private async searchLocally(embedding: number[]): Promise<SemanticVerseMatch[]> {
        console.log('[SemanticDetector] Searching locally with version:', this.config.version);
        const cached = await getCachedVerseEmbeddings(this.config.version);

        if (cached.length === 0) {
            console.warn('[SemanticDetector] No cached embeddings for local search, version:', this.config.version);
            return [];
        }

        console.log('[SemanticDetector] Found', cached.length, 'cached embeddings for version:', this.config.version);

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