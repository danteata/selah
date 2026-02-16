export { speechRecognitionService, SpeechRecognitionService } from './speechRecognition'
export {
    detectVerses,
    verseToLabel,
    hasVerseReference,
    extractVerseFromContext,
    formatVerseForDisplay,
    BOOK_TO_NUMBER,
} from './verseDetection'
export type { DetectedVerse } from './verseDetection'
export { whisperTranscriptionService } from './whisperTranscription'
export type { WhisperConfig, WhisperTranscriptionResult } from './whisperTranscription'
export { whisperCppTranscriptionService } from './whisperCppTranscription'
export type { WhisperCppConfig, WhisperCppTranscriptionResult } from './whisperCppTranscription'
export { unifiedTranscriptionService } from './unifiedTranscription'
export type { TranscriptionProvider, UnifiedTranscriptionOptions, TranscriptionStatus } from './unifiedTranscription'

// Local embeddings for semantic verse detection
export {
    initializeEmbedder,
    isEmbedderReady,
    embedText,
    embedBatch,
    cosineSimilarity,
    findSimilarLocally,
    getCachedVerseEmbeddings,
    cacheVerseEmbeddings,
    clearCachedVerseEmbeddings,
    hasCachedEmbeddings,
} from './localEmbeddings'
export type { EmbeddingResult, VerseMatch } from './localEmbeddings'

// Semantic verse detection
export {
    getSemanticDetector,
    resetSemanticDetector,
    SemanticVerseDetector,
} from './semanticVerseDetection'
export type { SemanticVerseMatch, SemanticDetectionConfig } from './semanticVerseDetection'
