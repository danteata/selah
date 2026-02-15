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
