// Export all hooks
export { useEmitter, useEvent, useGlobalEmit, initGlobalEmitter } from './useEmitter'
export { useIndexedDB, getIndexedDB } from './useIndexedDB'
export {
    useSlideCreation,
    generateObjectId,
    generateSlideName,
    generateSlideContent,
    calculateScreenFontSize
} from './useSlideCreation'
export { useScripture } from './useScripture'
export { useHymn } from './useHymn'
export { useSong } from './useSong'
export { useSongs } from './useSongs'
export { useChurch } from './useChurch'
export { useLibrary } from './useLibrary'
export { useQuickActionHandlers } from './useQuickActionHandlers'
export {
    useKeyboardShortcut,
    useKeyboardShortcuts,
    useSlideNavigationShortcuts,
    useNumberShortcuts,
    useCtrlOrMetaActive
} from './useKeyboardShortcuts'
export { useMultiMonitor } from './useMultiMonitor'
export { useLiveSync } from './useLiveSync'
export { useSermonListener } from './useSermonListener'
export type { UseSermonListenerReturn, SermonListenerOptions, SermonListenerState, SermonListenerActions } from './useSermonListener'
export { useTemplates, useFileUrl } from './useTemplates'
export type { TemplateItem, UseTemplatesReturn } from './useTemplates'
export { useSemanticVerseSearch } from './useSemanticVerseSearch'
export type { SemanticVerseResult } from './useSemanticVerseSearch'
export { useTranscripts } from './useTranscripts'
export type { Transcript, TranscriptVerse, UseTranscriptsReturn } from './useTranscripts'
export { useGlobalAppSettings, useTranscriptionConfig, useGlobalSermonListenerSettings } from './useGlobalAppSettings'
export type { GlobalAppSettings, TranscriptionConfig, UseGlobalAppSettingsReturn, GlobalSermonListenerSettings, UseGlobalSermonListenerSettingsReturn } from './useGlobalAppSettings'
