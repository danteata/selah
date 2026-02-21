export { speechRecognitionService, SpeechRecognitionService } from './speechRecognition'
export {
    detectVerses,
    verseToLabel,
    hasVerseReference,
    extractVerseFromContext,
    formatVerseForDisplay,
    BOOK_TO_NUMBER,
    NUMBER_TO_BOOK,
} from './verseDetection'
export type { DetectedVerse } from './verseDetection'
export { whisperTranscriptionService } from './whisperTranscription'
export type { WhisperConfig, WhisperTranscriptionResult } from './whisperTranscription'
export { whisperCppTranscriptionService } from './whisperCppTranscription'
export type { WhisperCppConfig, WhisperCppTranscriptionResult } from './whisperCppTranscription'
export { fasterWhisperTranscriptionService } from './fasterWhisperTranscription'
export type { FasterWhisperConfig, FasterWhisperTranscriptionResult } from './fasterWhisperTranscription'
export { elevenLabsTranscriptionService } from './elevenLabsTranscription'
export type { ElevenLabsConfig, ElevenLabsTranscriptionResult } from './elevenLabsTranscription'
export { vadTranscriptionService } from './vadTranscriptionService'
export type { VADTranscriptionConfig, VADUtterance } from './vadTranscriptionService'
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
export type { SemanticVerseMatch, SemanticDetectionConfig, ExcludedRange } from './semanticVerseDetection'
