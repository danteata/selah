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
export { desktopWhisperTranscriptionService } from './desktopWhisperTranscription'
export type { DesktopWhisperTranscriptionConfig, DesktopWhisperTranscriptionResult } from './desktopWhisperTranscription'
export { unifiedTranscriptionService } from './unifiedTranscription'
export type { TranscriptionProvider, UnifiedTranscriptionOptions, TranscriptionStatus } from './unifiedTranscription'

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
