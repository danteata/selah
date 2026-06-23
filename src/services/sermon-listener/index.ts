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
export { fasterWhisperTranscriptionService } from './fasterWhisperTranscription'
export { unifiedTranscriptionService } from './unifiedTranscription'
export type { TranscriptionProvider, UnifiedTranscriptionOptions, TranscriptionStatus, WhisperSegmentTiming } from './unifiedTranscription'

// Local embeddings for semantic verse detection
export {
    initializeEmbedder,
    isEmbedderReady,
    embedText,
    embedBatch,
    cosineSimilarity,
    getCachedVerseEmbeddings,
    cacheVerseEmbeddings,
    clearCachedVerseEmbeddings as clearCachedEmbeddings,
    hasCachedEmbeddings,
    getLocalCachedVersions,
} from './localEmbeddings'
export type { EmbeddingResult, VerseMatch, CachedVerseEmbedding, SyncProgressRecord } from './localEmbeddings'

// Packed Float32Array verse embedding store + worker-backed similarity search
export {
    loadFromCached as loadVerseEmbeddingStore,
    loadFromPackedBuffer as loadVerseEmbeddingPack,
    searchVerseEmbeddings,
    getLoadedIndex as getLoadedVerseIndex,
    clearIndex as clearVerseEmbeddingIndex,
    pingWorker as pingVerseEmbeddingWorker,
} from './verseEmbeddingStore'
export type { VerseMeta as VerseEmbeddingMeta } from './verseEmbeddingStore'

// Semantic verse detection
export {
    getSemanticDetector,
    resetSemanticDetector,
    SemanticVerseDetector,
} from './semanticVerseDetection'
export type { SemanticVerseMatch, SemanticDetectionConfig, ExcludedRange } from './semanticVerseDetection'

export {
    detectVoiceCommands,
    stripCommandsFromTranscript,
    getVersionDisplayName,
} from './voiceCommandDetection'
export type { VoiceCommand } from './voiceCommandDetection'

export { filterHallucinations } from './hallucinationFilter'
export type { HallucinationFilterResult } from './hallucinationFilter'

// Active reference context (resolves bare "verse 6" from prior book+chapter)
export {
    resolveBareReferences,
    updateContextFromVerse,
    isContextValid,
    createContext,
} from './referenceContext'
export type { ActiveReferenceContext } from './referenceContext'

// Keep-awake during recording (prevents OS sleep)
export {
    startKeepAwake,
    stopKeepAwake,
    isKeepAwakeActive,
    setupVisibilityKeepAwake,
} from './keepAwake'

// Structured transcription error codes
export {
    transcriptionErrorCodes,
    isUserError,
    isRetryableError,
    getMaxRetries,
    getUserAction,
    TranscriptionError,
    RetryableTranscriptionError,
    UserTranscriptionError,
    classifyTranscriptionError,
} from './transcriptionErrors'
export type { TranscriptionErrorCode, UserErrorCode, RetryableErrorCode } from './transcriptionErrors'

// Transcript export formats
export {
    exportAsText,
    exportAsSrt,
    exportAsVtt,
    exportAsJson,
    exportTranscript,
    downloadTranscript,
} from './transcriptExport'
export type { ExportFormat, TranscriptMeta } from './transcriptExport'

// Audio preprocessing (highpass filter + gain)
export {
    applyPreprocessing,
    createPreprocessingNodes,
    connectPreprocessingChain,
} from './audioPreprocessing'

// Sermon notes generation (embedding-based extraction + heuristic fallback)
export {
    generateSermonNotes,
    summarizeText,
    setupSummarizer,
    isSummarizerReady,
} from './sermonNotes'
export type { SummarizeOptions } from './sermonNotes'

// Desktop summarization service
// Local abstractive summarization (Transformers.js Web Worker)
export {
    isAbstractiveSummarizerReady,
    summarizeAbstractive,
    setupAbstractiveSummarizer,
    cleanupAbstractiveSummarizer,
} from './abstractiveSummarization'

// Structured logging bridge (desktop: Rust file logs, web: console)
export {
    logger,
    getLogs,
    checkPreviousCrash,
} from '../logging'
