/**
 * useSermonListener Hook
 * Combines speech recognition with Bible verse detection for real-time sermon listening
 * 
 * Supports both Web Speech API and Whisper.cpp transcription providers
 * Includes semantic verse detection using local embeddings (Transformers.js)
 * 
 * Provider settings are now managed globally by super admins via Convex.
 * User-specific settings (autoLookup, autoDisplay, language override) are stored locally.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAnalytics } from './useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'
import { isDesktop } from '../platform'
import { useScripture } from './useScripture'
import { useSlideCreation, firstVerseOnly } from './useSlideCreation'
import { useAppStore } from '../store/appStore'
import { useGlobalSermonListenerSettings } from './useGlobalAppSettings'
import { unifiedTranscriptionService } from '../services/sermon-listener'
import { audioFeatures } from '../services/visualizer/audioFeatures'
import { startNativeAudioFeatures } from '../services/visualizer/nativeAudioFeatures'
import type { TranscriptionProvider, TranscriptionStatus, WhisperSegmentTiming } from '../services/sermon-listener'
import { detectVerses,
    verseToLabel,
    getSemanticDetector,
    resetSemanticDetector,
    NUMBER_TO_BOOK,
    resolveBareReferences,
    resolveStandaloneNumberContinuation,
    updateContextFromVerse,
} from '../services/sermon-listener'
import {
    detectVoiceCommands,
    stripCommandsFromTranscript,
} from '../services/sermon-listener/voiceCommandDetection'
import type { VoiceCommand } from '../services/sermon-listener/voiceCommandDetection'
import type { DetectedVerse } from '../services/sermon-listener'
import type { ActiveReferenceContext } from '../services/sermon-listener'
import type { Scripture, BibleVersion } from '../types'
import type { TranscriptSegment } from '../types/sermon-listener'
import { filterHallucinations, correctAccentMishearings } from '../services/sermon-listener/hallucinationFilter'
import { filterFillers } from '../services/sermon-listener/fillerFilter'
import { applyCustomWords, SERMON_PROPER_NOUNS } from '../services/sermon-listener/customWords'
import { buildBibleInitialPrompt } from '../services/sermon-listener/bibleInitialPrompt'
import { audioFeedbackService } from '../services/sermon-listener/audioFeedback'
import { extractVersesWithLLM } from '../services/sermon-listener/llmVerseExtraction'
import { isLlmConfigured } from '../services/sermon-listener/llmClient'
import { startKeepAwake, stopKeepAwake, setupVisibilityKeepAwake } from '../services/sermon-listener/keepAwake'
import { getNextChapter, getPreviousChapter } from '../utils/bibleReference'
import {
    getLiveSermonState,
    saveLiveSermonState,
    clearLiveSermonState,
    getSavedSermonTranscripts,
    saveSermonTranscript,
    deleteSavedSermonTranscript as deleteSavedTranscriptFromIDB,
    clearSavedSermonTranscripts as clearSavedTranscriptsInIDB,
    migrateLegacySermonStorage,
} from './useIndexedDB'

const MAX_DETECTED_VERSES_PER_QUERY = 3 // Max verses per semantic search query
const LLM_EXTRACTION_DEBOUNCE_MS = 3500 // Wait for speech to settle before an LLM pass

// Voice-command types that change what's on the shared live screen — gated on
// confidence before executing. stop/start_listening are excluded since they
// don't touch the screen.
const SCREEN_AFFECTING_COMMAND_TYPES = new Set<VoiceCommand['type']>([
    'change_version', 'next_verse', 'previous_verse', 'next_chapter',
    'previous_chapter', 'go_to_verse', 'go_to_reference', 'display',
])
const COMMAND_CONFIDENCE_ORDER = { high: 3, medium: 2, low: 1 } as const

export interface SavedSermonTranscript {
    id: string
    title: string
    transcript: string
    segments: TranscriptSegment[]
    provider: TranscriptionProvider
    createdAt: string
}

export interface SermonListenerOptions {
    /** Language for speech recognition */
    language?: string
    /** Whether to automatically look up detected verses */
    autoLookup?: boolean
    /** Whether to automatically display verses on live view */
    autoDisplay?: boolean
    /** Minimum confidence threshold for verse detection */
    minConfidence?: 'high' | 'medium' | 'low'
    /** Transcription provider override */
    provider?: TranscriptionProvider
    /** Enable semantic verse detection (paraphrases) */
    enableSemanticDetection?: boolean
    /** Enable voice command detection */
    enableVoiceCommands?: boolean
    /** Callback when a verse is detected */
    onVerseDetected?: (verse: DetectedVerse, scripture: Scripture | null) => void
    /** Callback when transcription updates */
    onTranscriptUpdate?: (transcript: string, isInterim: boolean) => void
    /** Callback on error */
    onError?: (error: string) => void
    /** Callback when a voice command is detected */
    onVoiceCommand?: (command: VoiceCommand) => void
}

export interface SermonListenerState {
    /** Whether the listener is active */
    isListening: boolean
    /** Whether a session is starting (clicked Start, provider spinning up) */
    isStarting: boolean
    /** Whether speech recognition is supported */
    isSupported: boolean
    /** Current full transcript */
    transcript: string
    /** Timestamped transcript segments */
    transcriptSegments: TranscriptSegment[]
    /** Current interim (partial) transcript */
    interimTranscript: string
    /** List of detected verses */
    detectedVerses: DetectedVerse[]
    /** Currently focused verse (most recent) */
    currentVerse: DetectedVerse | null
    /** Scripture content for current verse */
    currentScripture: Scripture | null
    /** Any error that occurred */
    error: string | null
    /** Whether a verse lookup is in progress */
    isLoading: boolean
    /** Current transcription provider */
    provider: TranscriptionProvider
    /** Whether Whisper model is loading */
    isModelLoading: boolean
    /** Model loading progress (0-100) */
    modelLoadingProgress: number
    /** Provider is currently being eagerly initialized in the background */
    isInitializingProvider: boolean
    /** Whether the provider has been eagerly initialized and is ready */
    providerReady: boolean
    /** Saved transcripts */
    savedTranscripts: SavedSermonTranscript[]
    /** Whether semantic detection is enabled */
    semanticDetectionEnabled: boolean
    /** Whether semantic detector is ready */
    semanticDetectorReady: boolean
    /** Whether semantic search is in progress */
    isSemanticSearching: boolean
    /** Whether speech is currently being detected (audio activity) */
    isSpeechDetected: boolean
    /** Real-time audio level (0-1) for waveform visualization */
    audioLevel: number
    /** Active Bible version for lookups (tracks voice command changes) */
    activeBibleVersion: string
    /** Last detected voice command */
    lastVoiceCommand: VoiceCommand | null
    /** List of recent voice commands */
    voiceCommands: VoiceCommand[]
    /** Raw ASR utterances for learning */
    rawUtterances: Array<{ text: string; timestamp: number; confidence?: number }>
    /** Active capture source */
    captureSource: 'microphone' | 'system' | null
}

export interface SermonListenerActions {
    /** Start listening to the sermon */
    start: () => Promise<boolean>
    /** Stop listening */
    stop: () => void
    /** Clear the transcript and detected verses */
    reset: () => void
    /** Manually look up a specific verse */
    lookupVerse: (verse: DetectedVerse, versionOverride?: string) => Promise<Scripture | null>
    /** Display the current verse on live view */
    displayCurrentVerse: () => void
    /** Remove a detected verse from the list */
    removeVerse: (verse: DetectedVerse) => void
    /** Switch transcription provider */
    setProvider: (provider: TranscriptionProvider) => Promise<boolean>
    /** Save the current transcript */
    saveCurrentTranscript: (title?: string) => SavedSermonTranscript | null
    /** Delete a saved transcript */
    deleteSavedTranscript: (id: string) => void
    /** Clear all saved transcripts */
    clearSavedTranscripts: () => void
    /** Export current transcript as a file */
    exportCurrentTranscript: () => boolean
    /** Navigate to next verse relative to current */
    nextVerse: () => void
    /** Navigate to previous verse relative to current */
    previousVerse: () => void
    /** Change the active Bible version */
    changeBibleVersion: (versionId: string) => void
    /** Manually set one detected verse as current */
    setCurrentDetectedVerse: (verse: DetectedVerse) => Promise<void>
}

export type UseSermonListenerReturn = SermonListenerState & SermonListenerActions

/**
 * Hook for listening to sermons and detecting Bible verse references
 */
export function useSermonListener(options: SermonListenerOptions = {}): UseSermonListenerReturn {
    const {
        language: languageOverride,
        autoLookup: autoLookupOverride,
        autoDisplay: autoDisplayOverride,
        minConfidence: minConfidenceOverride,
        provider: providerOverride,
        onTranscriptUpdate,
        onError,
        enableVoiceCommands = true,
        onVoiceCommand,
    } = options

    const { fetchScripture } = useScripture()
    const { createBibleSlide } = useSlideCreation()
    // Auto-detected multi-verse ranges default to showing just the first
    // verse — a full range crammed onto one slide is illegible. The full
    // range is still preserved on the Scripture/slide data for the verse
    // navigator, which lets the user add more verses via shift-click/drag.
    const createAutoDetectBibleSlide = useCallback(
        (scripture: Scripture) => createBibleSlide(scripture, { displayVerseNumbers: firstVerseOnly(scripture) }),
        [createBibleSlide]
    )
    const { trackEvent } = useAnalytics()
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const bibleVersions = useAppStore((state) => state.bibleVersions)
    const sermonSettings = useAppStore((state) => state.settings.sermonListener)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
    const updateActiveSlide = useAppStore((state) => state.updateActiveSlide)

    // Get global settings (system-wide, no churchId needed)
    const { settings: globalSettings, isLoading: isGlobalSettingsLoading } = useGlobalSermonListenerSettings()

    // User-specific settings from local store
    const autoLookup = autoLookupOverride ?? sermonSettings?.autoLookup ?? true
    const autoDisplay = autoDisplayOverride ?? sermonSettings?.autoDisplay ?? false
    const minConfidence = minConfidenceOverride ?? 'medium'
    const enableSemanticDetection = options.enableSemanticDetection ?? true

    // Language: user override > user setting > global default
    const language = languageOverride || sermonSettings?.language || globalSettings?.sermonListener_defaultLanguage || 'en-US'

    // Provider from global settings (managed by super admin)
    // Default to the native in-process engine on Tauri, web-speech on browser
    const defaultProvider: TranscriptionProvider = typeof window !== 'undefined' && '__TAURI__' in window ? 'native' : 'web-speech'
    const globalProvider = (globalSettings?.sermonListener_transcriptionProvider as TranscriptionProvider) || defaultProvider
    const targetProvider = providerOverride || globalProvider

    // Determine provider from settings or override
    const getInitialProvider = (): TranscriptionProvider => {
        return targetProvider
    }

    // State
    const [isListening, setIsListening] = useState(false)
    // True between clicking Start and the provider's onStart firing (native
    // capture spins up a model + Rust stream first). Without this the button
    // reads "Start" during that window even though a session is launching.
    const [isStarting, setIsStarting] = useState(false)
    const [isSupported, setIsSupported] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([])
    const [interimTranscript, setInterimTranscript] = useState('')
    const [detectedVerses, setDetectedVerses] = useState<DetectedVerse[]>([])
    const detectedVersesRef = useRef<DetectedVerse[]>(detectedVerses)
    const [currentVerse, setCurrentVerse] = useState<DetectedVerse | null>(null)
    const [currentScripture, setCurrentScripture] = useState<Scripture | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [provider, setProvider] = useState<TranscriptionProvider>(getInitialProvider)
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [modelLoadingProgress, setModelLoadingProgress] = useState(0)
    const [savedTranscripts, setSavedTranscripts] = useState<SavedSermonTranscript[]>([])
    // Becomes true once we've finished hydrating from IndexedDB. Used to
    // gate the persistence useEffect so we don't write back what we just read.
    const [hydrated, setHydrated] = useState(false)

    // Provider initialization state
    const [isInitializingProvider, setIsInitializingProvider] = useState(false)
    const [providerReady, setProviderReady] = useState(false)

    // Semantic detection state
    const [semanticDetectorReady, setSemanticDetectorReady] = useState(false)
    const [isSemanticSearching, setIsSemanticSearching] = useState(false)

    // Speech detection state (for visual feedback)
    const [isSpeechDetected, setIsSpeechDetected] = useState(false)

    // Real-time audio level (0-1) for waveform visualization
    const [audioLevel, setAudioLevel] = useState(0)
    const [captureSource, setCaptureSource] = useState<'microphone' | 'system' | null>(null)
    const audioAnalyserRef = useRef<AnalyserNode | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const audioStreamRef = useRef<MediaStream | null>(null)
    const audioLevelRafRef = useRef<number | null>(null)
    // Cleanup for the desktop native audio-features subscription (visualizer + meter).
    const nativeFeaturesUnlistenRef = useRef<(() => void) | null>(null)

    // Voice command state
    const [activeBibleVersion, setActiveBibleVersion] = useState(defaultBibleVersion)
    const activeBibleVersionRef = useRef(activeBibleVersion)
    const currentVerseRef = useRef<DetectedVerse | null>(currentVerse)
    const currentScriptureRef = useRef<Scripture | null>(null)
    const providerReadyRef = useRef(false)
    const [lastVoiceCommand, setLastVoiceCommand] = useState<VoiceCommand | null>(null)
    const [voiceCommands, setVoiceCommands] = useState<VoiceCommand[]>([])
    const [rawUtterances, setRawUtterances] = useState<Array<{ text: string; timestamp: number; confidence?: number }>>([])

    // Optional LLM verse-extraction pass (debounced; only runs when configured)
    const llmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const llmAbortRef = useRef<AbortController | null>(null)

    // Debounce timestamp for SERMON_LISTENER_TRANSCRIPTION — fires at most
    // once every 5s while the listener is active.
    const lastTranscriptEventRef = useRef<number>(0)

    // Refs for callback stability
    const optionsRef = useRef(options)
    optionsRef.current = options

    // Track transcript buffer for context
    const transcriptBufferRef = useRef('')

    // Session-relative timer for segment timestamps
    const sessionStartTimeRef = useRef<number>(0)
    const chunkStartTimeRef = useRef<number>(0)

    // Track recent chunks for deduplication
    const recentChunksRef = useRef<string[]>([])
    const MAX_RECENT_CHUNKS = 5

    // Track detected verse references to prevent duplicates in the list
    const detectedRefsRef = useRef<Set<string>>(new Set())

    // Cooldown map for re-triggering already-detected verses (reference → last activated timestamp)
    const reactivationCooldownRef = useRef<Map<string, number>>(new Map())
    const REACTIVATION_COOLDOWN_MS = 30_000 // 30 seconds

    // Per-verse "last time the rolling transcript window matched this verse" timestamp.
    // Used to distinguish a genuine re-reference (the verse stopped matching for a
    // while, then re-appeared) from rolling-window noise (the verse is matching on
    // every chunk because its keywords are still in the window). A genuine re-reference
    // re-shows the verse; rolling-window noise only bumps the retriggerCount.
    const lastMatchTimeRef = useRef<Map<string, number>>(new Map())
    const REACTIVATE_AFTER_SILENCE_MS = 60_000 // 60 seconds of silence before a re-match is treated as a re-reference

    // Per-verse score of the most recent match. Regex matches are recorded as
    // 1.0 (the preacher said the reference explicitly). Semantic matches are
    // recorded as the cosine score. Used by the chapter-level dedup to
    // decide whether a new semantic match is strong enough to override an
    // existing chapter sibling.
    const lastScoreByReferenceRef = useRef<Map<string, number>>(new Map())
    const CHAPTER_DEDUP_DELTA = 0.10 // A new semantic match must beat the existing chapter sibling by this much

    // Scripture-marker words. If the matched query contains one of these, the
    // match is more likely a real Bible reference and we accept lower scores.
    // If none are present, we require a higher score to compensate for the
    // lack of an explicit reference signal.
    const SCRIPTURE_MARKER_RE = /\b(verse|verses|chapter|chapters|scripture|scriptures|the bible|the word|it is written|the lord said|god said|according to)\b/i
    const SCRIPTURE_MARKER_MIN_SCORE = 0.75 // Below this AND no marker → likely incidental match

    // Debounce timer for interim transcript processing
    const interimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const INTERIM_DEBOUNCE_MS = 300

    // Read current live Bible slide as fallback when currentVerseRef is null
    // (e.g. user opened the verse via Bible tab instead of sermon detection)
    const getCurrentVerseFromLiveSlide = useCallback((): DetectedVerse | null => {
        const state = useAppStore.getState()
        const liveSlide = state.activeSlides.find(s => s.id === state.liveSlideId)
        if (liveSlide?.type === 'bible' && liveSlide.data) {
            const scripture = liveSlide.data as Scripture
            const verses = Array.isArray(scripture.content) ? scripture.content : null
            if (verses && verses.length > 0) {
                const first = verses[0]
                const last = verses[verses.length - 1]
                // `first.book` is the raw numeric book id from the Bible JSON
                // (e.g. "43"), not a canonical name — verseToLabel() and every
                // other DetectedVerse consumer expect the name (e.g. "John").
                const bookName = NUMBER_TO_BOOK[first.book]
                if (!bookName) return null
                return {
                    book: bookName,
                    chapter: parseInt(first.chapter, 10),
                    verseStart: parseInt(first.verse, 10),
                    verseEnd: verses.length > 1 ? parseInt(last.verse, 10) : undefined,
                    raw: scripture.label,
                    reference: scripture.label,
                    confidence: 'high',
                    startIndex: 0,
                    endIndex: 0,
                }
            }
        }
        return null
    }, [])

    const dedupeVerses = useCallback((items: DetectedVerse[]): DetectedVerse[] => {
        const map = new Map<string, DetectedVerse>()
        for (const verse of items) {
            const existing = map.get(verse.reference)
            if (!existing) {
                map.set(verse.reference, verse)
                continue
            }
            if ((verse.isBestMatch && !existing.isBestMatch) || verse.startIndex > existing.startIndex) {
                map.set(verse.reference, { ...existing, ...verse, isBestMatch: existing.isBestMatch || verse.isBestMatch })
            }
        }
        return Array.from(map.values())
    }, [])

    // Counter that increments only when regex detects NEW verses — used to determine
    // if semantic results should become the "current" verse. Semantic results that
    // arrive after a newer regex detection should not overwrite the current verse.
    const regexVerseDetectionRef = useRef(0)

    // Track recent command execution timestamps to avoid instant repeats while still
    // allowing the same command later in the sermon.
    const processedCommandTimesRef = useRef<Map<string, number>>(new Map())

    // Ref for start function to avoid TDZ issues (start is defined after processTranscript)
    const startRef = useRef<() => Promise<boolean>>(async () => false)
    const stopRef = useRef<() => void>(() => {})
    const versionChangeRequestIdRef = useRef(0)
    const verseLookupRequestIdRef = useRef(0)
    const activeLookupCountRef = useRef(0)
    const versionSwitchCooldownUntilRef = useRef(0)
    const navigationCooldownUntilRef = useRef(0)

    // Active reference context for resolving bare "verse 6" from prior book+chapter
    const activeReferenceContextRef = useRef<ActiveReferenceContext | null>(null)
    const CONTEXT_TTL_MS = 120_000

    // Real-time audio level analysis via Web Audio API AnalyserNode
    // Reuses the transcription service's media stream to avoid duplicate getUserMedia calls.
    // If the primary stream isn't ready yet (VAD still initializing), retries for up to 3s
    // before falling back to opening a separate stream.
    const startAudioAnalyser = useCallback(async () => {
        try {
            const userCaptureSource = sermonSettings?.captureSource || 'microphone'

            // Desktop with Rust capture: the native engine captures BOTH the
            // microphone and system loopback in Rust and emits `audio-features`
            // (Phase 5). Drive the meter + visualizer from that event rather
            // than a WebView getUserMedia stream. This (a) works for system
            // loopback, which getUserMedia can't reach, (b) avoids a duplicate
            // mic device open, and (c) means `tauri dev` never touches a
            // privacy-sensitive WebView API, so it won't hit the macOS TCC
            // hard-crash. `system` always goes here because only Rust can
            // capture speaker output.
            if (isDesktop() && (provider === 'native' || userCaptureSource === 'system')) {
                setCaptureSource(userCaptureSource === 'system' ? 'system' : 'microphone')
                const unlisten = await startNativeAudioFeatures((rms) => setAudioLevel(rms))
                nativeFeaturesUnlistenRef.current = unlisten
                return
            }

            // Web, or a desktop sidecar/cloud provider using a browser stream:
            // use a getUserMedia AnalyserNode (feeds both the level meter and
            // the visualizer bus — see the analyser poll below).
            let stream = unifiedTranscriptionService.getMediaStream()

            if (!stream) {
                if (userCaptureSource === 'system') {
                    setCaptureSource('system')
                    console.log('[useSermonListener] System audio active — mic analyser disabled')
                    return
                }

                // Retry for up to 3s waiting for the primary stream to appear
                // (VAD/web-audio capture initializes asynchronously)
                const retryDelay = 200
                const maxRetries = 15
                for (let i = 0; i < maxRetries; i++) {
                    await new Promise(r => setTimeout(r, retryDelay))
                    stream = unifiedTranscriptionService.getMediaStream()
                    if (stream) break
                }
            }

            if (!stream) {
                // Still no stream after retries — fall back to a separate getUserMedia.
                // This is the lightweight path that just reads frequency data.
                const audioConstraints: boolean | MediaTrackConstraints = sermonSettings?.selectedMicrophoneId
                    ? { deviceId: { exact: sermonSettings.selectedMicrophoneId }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true } }
                    : true
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
                    audioStreamRef.current = stream
                } catch (err) {
                    if (err instanceof OverconstrainedError && sermonSettings?.selectedMicrophoneId) {
                        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                        audioStreamRef.current = stream
                    } else {
                        console.warn('[useSermonListener] Could not acquire audio stream for analyser')
                        return
                    }
                }
            }

            setCaptureSource(userCaptureSource)
            const ctx = new AudioContext()
            if (ctx.state === 'suspended') {
                await ctx.resume()
            }
            audioContextRef.current = ctx
            const source = ctx.createMediaStreamSource(stream)
            const analyser = ctx.createAnalyser()
            analyser.fftSize = 256
            analyser.smoothingTimeConstant = 0.8
            source.connect(analyser)
            audioAnalyserRef.current = analyser

            const dataArray = new Uint8Array(analyser.frequencyBinCount)

            const poll = () => {
                if (!audioAnalyserRef.current) return
                analyser.getByteFrequencyData(dataArray)
                const sum = dataArray.reduce((a, b) => a + b, 0)
                const avg = sum / dataArray.length
                const level = Math.min(avg / 128, 1)
                setAudioLevel(level)
                // Feed the audio-reactive visualizer from this same analyser so
                // we don't open a second audio stream (Phase 4).
                audioFeatures.publish(dataArray)
                audioLevelRafRef.current = requestAnimationFrame(poll)
            }
            poll()
        } catch (e) {
            console.warn('[useSermonListener] Could not start audio analyser:', e)
        }
    }, [sermonSettings?.selectedMicrophoneId, sermonSettings?.captureSource, provider])

    const stopAudioAnalyser = useCallback(() => {
        if (audioLevelRafRef.current != null) {
            cancelAnimationFrame(audioLevelRafRef.current)
            audioLevelRafRef.current = null
        }
        audioAnalyserRef.current = null
        audioFeatures.reset()
        if (nativeFeaturesUnlistenRef.current) {
            nativeFeaturesUnlistenRef.current()
            nativeFeaturesUnlistenRef.current = null
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => {})
            audioContextRef.current = null
        }
        if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(t => t.stop())
            audioStreamRef.current = null
        }
        setAudioLevel(0)
        setCaptureSource(null)
    }, [])

    useEffect(() => {
        if (isListening) {
            startAudioAnalyser()
            return () => {} // cleanup is handled by stopAudioAnalyser on !isListening
        } else {
            stopAudioAnalyser()
        }
    }, [isListening, startAudioAnalyser, stopAudioAnalyser])

    /**
     * Check if text is a duplicate or near-duplicate of recent chunks
     * Returns true if the text should be skipped (is a duplicate)
     */
    const isDuplicateText = useCallback((newText: string): boolean => {
        if (!newText || newText.length < 5) return false

        const normalizedNew = newText.toLowerCase().trim()

        for (const recent of recentChunksRef.current) {
            const normalizedRecent = recent.toLowerCase().trim()

            // Exact match
            if (normalizedNew === normalizedRecent) return true

            // Check containment: only block if the new text is mostly contained in recent
            // (indicating it's a subset, not new content extending it)
            if (normalizedRecent.includes(normalizedNew)) {
                // New text is entirely contained in a recent chunk — skip
                const lengthRatio = normalizedNew.length / normalizedRecent.length
                if (lengthRatio > 0.85) return true
            }

            // Check for repeated patterns (e.g., "Okay. Okay. Okay.")
            const words = normalizedNew.split(/\s+/)
            if (words.length >= 3) {
                const phrase = words.slice(0, 3).join(' ')
                const repeatedPattern = new RegExp(`(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*){2,}`, 'i')
                if (repeatedPattern.test(normalizedNew)) {
                    return true
                }
            }
        }

        return false
    }, [])

    /**
     * Clean up repeated phrases in text
     * E.g., "Okay. Okay. Okay." -> "Okay."
     */
    const cleanRepeatedPhrases = useCallback((text: string): string => {
        if (!text) return text

        // Remove immediate repetitions of short phrases (1-5 words)
        // Pattern: "word. word. word." or "word, word, word,"
        const patterns = [
            /(\b[\w']+(?:\s+[\w']+){0,4}?[.,!?]?\s*)\1{2,}/gi,
            /(\b[\w']+\b\s*)\1{3,}/gi,
        ]

        let cleaned = text
        for (const pattern of patterns) {
            cleaned = cleaned.replace(pattern, '$1')
        }

        return cleaned
    }, [])

    /**
     * Remove overlap between a new chunk and recent context
     * E.g., recent="For God so", new="God so loved" -> "loved"
     */
    const stripOverlap = useCallback((newText: string, recentText: string): string => {
        if (!newText || !recentText) return newText

        const newWords = newText.split(/\s+/)
        const recentWords = recentText.split(/\s+/)

        for (let len = Math.min(newWords.length, recentWords.length, 10); len >= 3; len--) {
            const suffix = recentWords.slice(-len).join(' ').toLowerCase().replace(/[^\w\s]/g, '')
            const prefix = newWords.slice(0, len).join(' ').toLowerCase().replace(/[^\w\s]/g, '')

            if (suffix === prefix) {
                const remaining = newWords.slice(len).join(' ')
                return remaining || newText
            }
        }

        return newText
    }, [])

    // Semantic detector ref
    const semanticDetectorRef = useRef<ReturnType<typeof getSemanticDetector> | null>(null)

    // Hydrate live state + saved transcripts from IndexedDB on mount.
    // One-shot, runs once per hook instance. Triggers the legacy localStorage
    // → IDB migration on first ever invocation. ~50–200 ms in practice.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                await migrateLegacySermonStorage()

                const [live, saved] = await Promise.all([
                    getLiveSermonState(),
                    getSavedSermonTranscripts(),
                ])

                if (cancelled) return

                if (live) {
                    if (typeof live.transcript === 'string') setTranscript(live.transcript)
                    if (Array.isArray(live.segments)) setTranscriptSegments(live.segments as TranscriptSegment[])
                    if (Array.isArray(live.detectedVerses)) setDetectedVerses(live.detectedVerses as DetectedVerse[])
                    if (live.currentVerse) setCurrentVerse(live.currentVerse as DetectedVerse)
                    if (typeof live.activeBibleVersion === 'string' && live.activeBibleVersion) {
                        setActiveBibleVersion(live.activeBibleVersion)
                    }
                    transcriptBufferRef.current = live.transcript || ''
                }

                if (saved.length > 0) {
                    setSavedTranscripts(saved as SavedSermonTranscript[])
                }
            } catch (err) {
                console.warn('[useSermonListener] Hydration from IDB failed:', err)
            } finally {
                if (!cancelled) setHydrated(true)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    // Persist live state to IndexedDB so a refresh restores the sermon in
    // progress. Debounced because transcript updates fire on every token —
    // serializing 30+ KB of JSON on every keystroke pegs the main thread.
    // Gated on `hydrated` so we don't echo back what we just loaded.
    useEffect(() => {
        if (!hydrated) return
        const timer = setTimeout(() => {
            saveLiveSermonState({
                transcript,
                segments: transcriptSegments,
                detectedVerses,
                currentVerse,
                activeBibleVersion,
            }).catch((err) => {
                console.warn('[useSermonListener] IDB live state write failed:', err)
            })
        }, 400)
        return () => clearTimeout(timer)
    }, [hydrated, transcript, transcriptSegments, detectedVerses, currentVerse, activeBibleVersion])

    useEffect(() => {
        activeBibleVersionRef.current = activeBibleVersion
    }, [activeBibleVersion])

    useEffect(() => {
        currentVerseRef.current = currentVerse
    }, [currentVerse])

    useEffect(() => {
        currentScriptureRef.current = currentScripture
    }, [currentScripture])

    useEffect(() => {
        detectedVersesRef.current = detectedVerses
    }, [detectedVerses])

    useEffect(() => {
        providerReadyRef.current = providerReady
    }, [providerReady])

    // Re-acquire Screen Wake Lock when tab becomes visible again.
    // The browser releases the lock when the tab is hidden; this
    // listener re-requests it so recording isn't interrupted by sleep.
    useEffect(() => {
        const cleanup = setupVisibilityKeepAwake()
        return cleanup
    }, [])

    // Check provider availability and configure the unified service. The heavy
    // model load is no longer staggered behind an 8s timer; instead we listen
    // to the Tauri `whisper-server://ready` event emitted by the Rust
    // prewarm task. If the sidecar is already hot when we mount (very common
    // on warm boots) the event replay marks `providerReady` instantly.
    //
    // We proceed even while global settings are loading so the UI doesn't
    // hang forever if Convex is unreachable. The provider defaults are safe.
    useEffect(() => {
        let cancelled = false

        const initialize = async () => {
            const available = await unifiedTranscriptionService.isProviderAvailable(targetProvider)
            if (cancelled) return

            // Cross-platform fallback to web-speech if the chosen native provider
            // isn't available. Desktop-whisper only exists in the Tauri app, so
            // the web build always lands here — that's the expected path and we
            // don't surface a "falling back" banner for it. On desktop, only
            // flag the fallback if the sidecar genuinely failed (dev without
            // whisper.cpp running, for example).
            if (!available && targetProvider === 'native') {
                const webSpeechAvailable = await unifiedTranscriptionService.isProviderAvailable('web-speech')
                if (cancelled) return
                if (webSpeechAvailable) {
                    setProvider('web-speech')
                    setIsSupported(true)
                    setProviderReady(true)
                    if (isDesktop()) {
                        setError('Native transcription unavailable. Falling back to Web Speech API.')
                    }
                    return
                }
            }

            setProvider(targetProvider)
            setIsSupported(available)

            if (!available) {
                setProviderReady(false)
                return
            }

            // Neither web-speech nor the native engine needs a server warm-up:
            // web-speech is built-in, and the native engine loads its model
            // lazily when listening starts. Mark ready immediately.
            if (targetProvider === 'web-speech' || targetProvider === 'native') {
                setProviderReady(true)
                return
            }

            // Configure the unified transcription service with the chosen provider.
            // For desktop-whisper this resolves quickly because the Rust prewarm
            // already spawned the sidecar; we just hand it the endpoint.
            setIsInitializingProvider(true)
            try {
                await unifiedTranscriptionService.setProvider(targetProvider, {
                    language: language.split('-')[0],
                    useVAD: globalSettings?.sermonListener_useVAD,
                    onProgress: (progress: number) => {
                        if (!cancelled) setModelLoadingProgress(progress)
                    },
                    onStatusChange: (_status: TranscriptionStatus) => {
                        /* no-op; readiness comes from the Tauri event */
                    },
                })
                // For desktop-whisper we wait for the Rust readiness event
                // (subscribed below) before flipping providerReady. The
                // web-speech branch returned earlier and never reaches here.
            } catch (err) {
                if (!cancelled) console.error('[useSermonListener] provider init failed:', err)
            } finally {
                if (!cancelled) setIsInitializingProvider(false)
            }
        }

        initialize()

        return () => {
            cancelled = true
        }
    }, [
        targetProvider,
        language,
        globalSettings?.sermonListener_useVAD,
    ])

    // Initialize semantic detector lazily — only when the user starts listening.
    // This avoids blocking the UI on mount with Convex queries and embedder loading.
    const initSemanticDetector = useCallback(async () => {
        if (!enableSemanticDetection) return

        const convexUrl = import.meta.env.VITE_CONVEX_URL
        if (!convexUrl) {
            console.warn('[SemanticDetector] No Convex URL found, semantic detection disabled')
            return
        }

        const versions = bibleVersions as BibleVersion[]
        const versionEntry = versions?.find(
            (v) => v.name === defaultBibleVersion || v.id === defaultBibleVersion
        )
        const versionId = versionEntry?.id || defaultBibleVersion

        console.log('[SemanticDetector] Using version:', versionId, '(default:', defaultBibleVersion, ')')

        const detector = getSemanticDetector({
            enabled: true,
            version: versionId,
        })

        const result = await detector.initialize(convexUrl)

        if (result.ready) {
            semanticDetectorRef.current = detector
            setSemanticDetectorReady(true)
            console.log('[SemanticDetector] Initialized successfully')
        } else {
            console.warn('[SemanticDetector] Initialization failed:', result.error)
        }
    }, [enableSemanticDetection, defaultBibleVersion, bibleVersions])

    /**
     * Look up a verse and get its content
     * Does NOT change currentVerse - just fetches scripture for display
     */
    const lookupVerse = useCallback(async (verse: DetectedVerse, versionOverride?: string): Promise<Scripture | null> => {
        const label = verseToLabel(verse)
        if (!label) {
            console.warn('Could not convert verse to label:', verse)
            return null
        }
        const versionToUse = versionOverride || activeBibleVersionRef.current
        const requestId = ++verseLookupRequestIdRef.current
        const count = ++activeLookupCountRef.current

        setIsLoading(true)
        try {
            const scripture = await fetchScripture(label, versionToUse)
            if (scripture && requestId === verseLookupRequestIdRef.current) {
                setCurrentScripture(scripture)
            }
            return scripture
        } catch (err) {
            console.error('Failed to look up verse:', err)
            return null
        } finally {
            if (--activeLookupCountRef.current === 0) {
                setIsLoading(false)
            }
        }
    }, [fetchScripture])

    /**
     * Display the current verse on live view
     */
    const displayCurrentVerse = useCallback(() => {
        if (!currentScripture) return

        // Create a slide from the scripture using the proper function
        // This applies the default bible verse template and includes the verse reference
        const slide = createAutoDetectBibleSlide(currentScripture)

        // Add slide to active slides and set as live
        appendActiveSlide(slide)
        setLiveSlide(slide.id)
    }, [currentScripture, createAutoDetectBibleSlide, appendActiveSlide, setLiveSlide])

    /**
     * Navigate to the next verse relative to the current verse
     */
    const nextVerse = useCallback(() => {
        if (!currentVerse) return
        const next: DetectedVerse = {
            ...currentVerse,
            verseStart: currentVerse.verseEnd ?? currentVerse.verseStart + 1,
            verseEnd: undefined,
            raw: `${currentVerse.book} ${currentVerse.chapter}:${(currentVerse.verseEnd ?? currentVerse.verseStart) + 1}`,
            reference: `${currentVerse.book} ${currentVerse.chapter}:${(currentVerse.verseEnd ?? currentVerse.verseStart) + 1}`,
            startIndex: 0,
            endIndex: 0,
        }
        setCurrentVerse(next)
        lookupVerse(next)
    }, [currentVerse, lookupVerse])

    /**
     * Navigate to the previous verse relative to the current verse
     */
    const previousVerse = useCallback(() => {
        if (!currentVerse) return
        const prevVerse = Math.max(1, currentVerse.verseStart - 1)
        const prev: DetectedVerse = {
            ...currentVerse,
            verseStart: prevVerse,
            verseEnd: undefined,
            raw: `${currentVerse.book} ${currentVerse.chapter}:${prevVerse}`,
            reference: `${currentVerse.book} ${currentVerse.chapter}:${prevVerse}`,
            startIndex: 0,
            endIndex: 0,
        }
        setCurrentVerse(prev)
        lookupVerse(prev)
    }, [currentVerse, lookupVerse])

    /**
     * Change the active Bible version and re-look up the current verse
     */
    const changeBibleVersion = useCallback((versionId: string) => {
        setActiveBibleVersion(versionId)
        if (currentVerse) {
            const verse = currentVerse
            lookupVerse(verse)
        }
    }, [currentVerse, lookupVerse])

    const setCurrentDetectedVerse = useCallback(async (verse: DetectedVerse): Promise<void> => {
        setCurrentVerse(verse)
        await lookupVerse(verse)
    }, [lookupVerse])

    const resolveBibleVersionId = useCallback((requested: string): string | null => {
        const normalized = requested.trim().toLowerCase()
        const versions = bibleVersions as BibleVersion[]
        const exact = versions.find(v => v.id.toLowerCase() === normalized || v.name.toLowerCase() === normalized)
        if (exact) return exact.id
        const partial = versions.find(v => v.id.toLowerCase().includes(normalized) || v.name.toLowerCase().includes(normalized))
        return partial?.id || null
    }, [bibleVersions])

    /**
     * Update the current live Bible slide in-place instead of appending a new one.
     * Keeps the slide queue clean while still refreshing the live output.
     *
     * @param scripture - The scripture to display
     * @param skipQueueAppend - When true (voice command navigation), never creates
     *   a new slide or appends to queue. Only updates an existing bible slide.
     */
    const refreshLiveSlide = useCallback((scripture: Scripture, skipQueueAppend = false) => {
        const state = useAppStore.getState()
        const liveSlideId = state.liveSlideId
        const existingSlide = state.activeSlides.find(s => s.id === liveSlideId)

        if (existingSlide && existingSlide.type === 'bible') {
            const newSlide = createAutoDetectBibleSlide(scripture)
            const updatedSlide = {
                ...existingSlide,
                contents: newSlide.contents,
                data: newSlide.data,
                title: newSlide.title,
                name: newSlide.name,
                slideStyle: newSlide.slideStyle,
            }
            updateActiveSlide(updatedSlide)
            setLiveSlide(existingSlide.id)

            // Also broadcast to live window / multi-monitor so the update is pushed
            if (typeof window !== 'undefined' && '__TAURI__' in window) {
                window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updatedSlide }))
            }
        } else if (!skipQueueAppend) {
            // No existing bible slide — fall back to creating one (only for auto-detect, not voice nav)
            const slide = createAutoDetectBibleSlide(scripture)
            appendActiveSlide(slide)
            setLiveSlide(slide.id)
        }
        // When skipQueueAppend=true and no existing bible slide, do nothing.
        // The user explicitly wants voice navigation to never spam the queue.
    }, [createAutoDetectBibleSlide, updateActiveSlide, appendActiveSlide, setLiveSlide])

    const applyBibleVersionChange = useCallback(async (requestedVersionId: string): Promise<boolean> => {
        const resolvedVersionId = resolveBibleVersionId(requestedVersionId) || requestedVersionId
        const requestId = ++versionChangeRequestIdRef.current
        const verseToSwitch = currentVerseRef.current

        setError(null)
        activeBibleVersionRef.current = resolvedVersionId
        setActiveBibleVersion(resolvedVersionId)

        if (!verseToSwitch) {
            return true
        }

        if (!verseToLabel(verseToSwitch)) {
            setError('Could not resolve current verse label for version switch.')
            return false
        }

        const scripture = await lookupVerse(verseToSwitch, resolvedVersionId)
        if (requestId !== versionChangeRequestIdRef.current) {
            return false
        }

        if (!scripture) {
            setError(`Could not load ${resolvedVersionId} for ${verseToSwitch.reference}.`)
            return false
        }

        setCurrentScripture(scripture)

        // Reflect version switch immediately on output and current selected verse UI.
        // Always refresh the currently selected verse text by updating currentVerse
        // with a fresh object so consumers keyed by object identity re-render.
        setCurrentVerse({
            ...verseToSwitch,
            raw: scripture.label,
            reference: scripture.label,
        })

        // Force deterministic refresh by publishing a fresh Bible slide from the switched scripture.
        const slide = createAutoDetectBibleSlide(scripture)
        appendActiveSlide(slide)
        setLiveSlide(slide.id)

        console.log('[SermonListener] Version switch applied:', {
            requestedVersionId,
            resolvedVersionId,
            verse: verseToSwitch.reference,
            scriptureVersion: scripture.version,
        })
        return true
    }, [resolveBibleVersionId, lookupVerse, createAutoDetectBibleSlide, appendActiveSlide, setLiveSlide])

    /**
     * Activate verses surfaced by the optional LLM pass. Mirrors the regex
     * activation branch but is kept separate so the fast local path is never
     * affected by the LLM augmentation. Only ever ADDS verses.
     */
    const activateLlmVerses = useCallback((newVerses: DetectedVerse[], regexGenerationAtSchedule: number) => {
        // The LLM path is the least corroborated of the three detectors (no
        // lexical-overlap validation the way semantic matches get) — it must
        // respect the same minConfidence bar the regex/semantic paths do,
        // not bypass it.
        const confidenceOrder = { high: 3, medium: 2, low: 1 } as const
        const minConfidenceLevel = confidenceOrder[minConfidence]
        const fresh = newVerses.filter((v) =>
            !detectedRefsRef.current.has(v.reference) && confidenceOrder[v.confidence] >= minConfidenceLevel,
        )
        if (fresh.length === 0) return

        // Stale if a newer regex detection has landed since this LLM call was
        // scheduled — the LLM's multi-second round-trip means it can resolve
        // well after speech has moved on. Still record the verses (useful for
        // operator review / later re-activation) but don't let a stale result
        // knock a newer, correct verse off the live screen.
        const isStale = regexGenerationAtSchedule !== regexVerseDetectionRef.current

        const now = Date.now()
        const stamped = fresh.map((v) => ({
            ...v,
            isBestMatch: true,
            detectionType: 'llm' as const,
            lastActivatedAt: now,
            retriggerCount: 0,
        }))
        for (const v of stamped) {
            detectedRefsRef.current.add(v.reference)
            reactivationCooldownRef.current.set(v.reference, now)
            lastMatchTimeRef.current.set(v.reference, now)
            // Slightly below an explicit regex hit (1.0) so a later regex match
            // in the same chapter still wins chapter-dedup comparisons.
            lastScoreByReferenceRef.current.set(v.reference, 0.9)
        }

        setDetectedVerses((prev) => dedupeVerses([...prev, ...stamped]))

        if (isStale) return

        const latest = stamped[stamped.length - 1]
        setCurrentVerse(latest)
        activeReferenceContextRef.current = updateContextFromVerse(latest)

        trackEvent(AnalyticsEventType.SERMON_LISTENER_VERSE_DETECTED, {
            reference: latest.reference,
            confidence: latest.confidence,
            detection_type: 'llm',
            verse_count: stamped.length,
        })

        // Respect the same in-progress-navigation/version-switch cooldowns the
        // regex/semantic paths already respect before auto-projecting.
        const inVersionSwitchCooldown = Date.now() < versionSwitchCooldownUntilRef.current
        const inNavigationCooldown = Date.now() < navigationCooldownUntilRef.current

        if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
            lookupVerse(latest).then((scripture) => {
                optionsRef.current.onVerseDetected?.(latest, scripture)
                if (autoDisplay && scripture && latest.confidence !== 'low') {
                    const slide = createAutoDetectBibleSlide(scripture)
                    appendActiveSlide(slide)
                    setLiveSlide(slide.id)
                }
            })
        } else {
            optionsRef.current.onVerseDetected?.(latest, null)
        }
    }, [dedupeVerses, lookupVerse, autoLookup, autoDisplay, createAutoDetectBibleSlide, appendActiveSlide, setLiveSlide, minConfidence])

    /**
     * Debounced, optional LLM extraction pass over the latest transcript text.
     * No-op unless the user configured an OpenAI-compatible endpoint, so the
     * default experience stays fully offline.
     */
    const scheduleLlmExtraction = useCallback((text: string) => {
        const llm = useAppStore.getState().settings.llm
        if (!isLlmConfigured(llm)) return

        if (llmDebounceRef.current) clearTimeout(llmDebounceRef.current)
        llmDebounceRef.current = setTimeout(() => {
            llmDebounceRef.current = null
            llmAbortRef.current?.abort()
            const controller = new AbortController()
            llmAbortRef.current = controller
            const alreadyDetected = Array.from(detectedRefsRef.current)
            const regexGenerationAtSchedule = regexVerseDetectionRef.current
            extractVersesWithLLM(text, llm, alreadyDetected, controller.signal)
                .then((result) => activateLlmVerses(result.newVerses, regexGenerationAtSchedule))
                .catch(() => { /* best-effort augmentation */ })
        }, LLM_EXTRACTION_DEBOUNCE_MS)
    }, [activateLlmVerses])

    /**
     * Process transcript for verse detection
     */
    const processTranscript = useCallback((text: string, latestChunkForCommands?: string) => {
        if (!text) return

        // Detect and handle voice commands
        if (enableVoiceCommands) {
            // Commands must come from the latest utterance chunk only.
            // Never fall back to full transcript history, which can replay stale commands.
            const commandSource = latestChunkForCommands?.trim() || ''
            if (commandSource.length > 0) {
            const correctedCommands = correctAccentMishearings(commandSource)
            const commands = detectVoiceCommands(correctedCommands)
            if (commands.length > 0) {
                console.log('[SermonListener] Voice commands detected:', {
                    source: commandSource,
                    corrected: correctedCommands,
                    commands: commands.map(c => ({ type: c.type, raw: c.raw, conf: c.confidence })),
                })
            }
            let handledVersionSwitch = false
            let handledNavigationCommand = false
            for (const cmd of commands) {
                const commandKey = (() => {
                    switch (cmd.type) {
                        case 'go_to_reference': return `${cmd.type}:${cmd.book || ''}:${cmd.chapter || ''}`
                        case 'go_to_verse': return `${cmd.type}::${cmd.targetVerse || ''}`
                        case 'change_version': return `${cmd.type}:${cmd.versionId || ''}:`
                        default: return `${cmd.type}::`
                    }
                })()
                const now = Date.now()
                const lastRunAt = processedCommandTimesRef.current.get(commandKey) || 0
                if (now - lastRunAt < 1800) continue

                // Confidence gate. Verse detection has always respected
                // minConfidence before touching the live screen; voice
                // commands never did, so any command that cleared the regex
                // (however loose) executed immediately regardless of how
                // ambiguous the match was. Version switches are the most
                // disruptive — they change the wording of everything
                // currently displayed — so they require 'high'. Other
                // screen-affecting commands require at least 'medium'.
                // stop/start_listening don't touch the screen, so they're
                // exempt.
                if (SCREEN_AFFECTING_COMMAND_TYPES.has(cmd.type)) {
                    const requiredConfidence = cmd.type === 'change_version' ? 'high' : 'medium'
                    if (COMMAND_CONFIDENCE_ORDER[cmd.confidence] < COMMAND_CONFIDENCE_ORDER[requiredConfidence]) {
                        continue
                    }
                }

                processedCommandTimesRef.current.set(commandKey, now)

                switch (cmd.type) {
                    case 'change_version':
                        if (cmd.versionId) {
                            void applyBibleVersionChange(cmd.versionId).then((ok) => {
                                if (ok) {
                                    versionSwitchCooldownUntilRef.current = Date.now() + 3000
                                    setLastVoiceCommand(cmd)
                                    setVoiceCommands(prev => [...prev, cmd])
                                }
                            })
                            handledVersionSwitch = true
                        }
                        break
                    case 'next_verse': {
                        handledNavigationCommand = true
                        const cur = currentVerseRef.current || getCurrentVerseFromLiveSlide()
                        if (cur) {
                            const next: DetectedVerse = {
                                ...cur,
                                verseStart: (cur.verseEnd ?? cur.verseStart) + 1,
                                verseEnd: undefined,
                                raw: `${cur.book} ${cur.chapter}:${(cur.verseEnd ?? cur.verseStart) + 1}`,
                                reference: `${cur.book} ${cur.chapter}:${(cur.verseEnd ?? cur.verseStart) + 1}`,
                                startIndex: 0,
                                endIndex: 0,
                            }
                            setCurrentVerse(next)
                            activeReferenceContextRef.current = updateContextFromVerse(next)
                            navigationCooldownUntilRef.current = Date.now() + 3000
                            lookupVerse(next).then(scripture => {
                                if (scripture) {
                                    setCurrentScripture(scripture)
                                    refreshLiveSlide(scripture, true)
                                }
                            })
                        }
                        break
                    }
                    case 'previous_verse': {
                        handledNavigationCommand = true
                        const cur = currentVerseRef.current || getCurrentVerseFromLiveSlide()
                        if (cur) {
                            const prevVerse = Math.max(1, cur.verseStart - 1)
                            const prev: DetectedVerse = {
                                ...cur,
                                verseStart: prevVerse,
                                verseEnd: undefined,
                                raw: `${cur.book} ${cur.chapter}:${prevVerse}`,
                                reference: `${cur.book} ${cur.chapter}:${prevVerse}`,
                                startIndex: 0,
                                endIndex: 0,
                            }
                            setCurrentVerse(prev)
                            activeReferenceContextRef.current = updateContextFromVerse(prev)
                            navigationCooldownUntilRef.current = Date.now() + 3000
                            lookupVerse(prev).then(scripture => {
                                if (scripture) {
                                    setCurrentScripture(scripture)
                                    refreshLiveSlide(scripture, true)
                                }
                            })
                        }
                        break
                    }
                    case 'go_to_verse': {
                        handledNavigationCommand = true
                        const cur = currentVerseRef.current || getCurrentVerseFromLiveSlide()
                        const target = cmd.targetVerse
                        if (cur && target && target >= 1) {
                            const goto: DetectedVerse = {
                                ...cur,
                                verseStart: target,
                                verseEnd: undefined,
                                raw: `${cur.book} ${cur.chapter}:${target}`,
                                reference: `${cur.book} ${cur.chapter}:${target}`,
                                startIndex: 0,
                                endIndex: 0,
                            }
                            setCurrentVerse(goto)
                            activeReferenceContextRef.current = updateContextFromVerse(goto)
                            navigationCooldownUntilRef.current = Date.now() + 3000
                            lookupVerse(goto).then(scripture => {
                                if (scripture) {
                                    setCurrentScripture(scripture)
                                    refreshLiveSlide(scripture, true)
                                }
                            })
                        }
                        break
                    }
                    case 'go_to_reference': {
                        handledNavigationCommand = true
                        const { book, chapter, verse } = cmd
                        if (book && chapter && chapter >= 1) {
                            const goto: DetectedVerse = {
                                book,
                                chapter,
                                verseStart: verse || 1,
                                verseEnd: undefined,
                                raw: `${book} ${chapter}:${verse || 1}`,
                                reference: `${book} ${chapter}:${verse || 1}`,
                                confidence: 'high',
                                startIndex: 0,
                                endIndex: 0,
                            }
                            setCurrentVerse(goto)
                            activeReferenceContextRef.current = updateContextFromVerse(goto)
                            navigationCooldownUntilRef.current = Date.now() + 3000
                            lookupVerse(goto).then(scripture => {
                                if (scripture) {
                                    setCurrentScripture(scripture)
                                    refreshLiveSlide(scripture, true)
                                }
                            })
                        }
                        break
                    }
                    case 'next_chapter': {
                        handledNavigationCommand = true
                        const cur = currentVerseRef.current || getCurrentVerseFromLiveSlide()
                        if (cur) {
                            const next = getNextChapter(cur.book, cur.chapter)
                            if (next) {
                                const nextVerse: DetectedVerse = {
                                    ...cur,
                                    chapter: next.chapter,
                                    verseStart: 1,
                                    verseEnd: undefined,
                                    raw: `${next.book} ${next.chapter}:1`,
                                    reference: `${next.book} ${next.chapter}:1`,
                                    startIndex: 0,
                                    endIndex: 0,
                                }
                                setCurrentVerse(nextVerse)
                                activeReferenceContextRef.current = updateContextFromVerse(nextVerse)
                                navigationCooldownUntilRef.current = Date.now() + 3000
                                lookupVerse(nextVerse).then(scripture => {
                                    if (scripture) {
                                        setCurrentScripture(scripture)
                                        refreshLiveSlide(scripture, true)
                                    }
                                })
                            }
                        }
                        break
                    }
                    case 'previous_chapter': {
                        handledNavigationCommand = true
                        const cur = currentVerseRef.current || getCurrentVerseFromLiveSlide()
                        if (cur) {
                            const prev = getPreviousChapter(cur.book, cur.chapter)
                            if (prev) {
                                const prevVerse: DetectedVerse = {
                                    ...cur,
                                    chapter: prev.chapter,
                                    verseStart: 1,
                                    verseEnd: undefined,
                                    raw: `${prev.book} ${prev.chapter}:1`,
                                    reference: `${prev.book} ${prev.chapter}:1`,
                                    startIndex: 0,
                                    endIndex: 0,
                                }
                                setCurrentVerse(prevVerse)
                                activeReferenceContextRef.current = updateContextFromVerse(prevVerse)
                                navigationCooldownUntilRef.current = Date.now() + 3000
                                lookupVerse(prevVerse).then(scripture => {
                                    if (scripture) {
                                        setCurrentScripture(scripture)
                                        refreshLiveSlide(scripture, true)
                                    }
                                })
                            }
                        }
                        break
                    }
                    case 'display': {
                        const scripture = currentScriptureRef.current
                        if (scripture) {
                            const slide = createAutoDetectBibleSlide(scripture)
                            appendActiveSlide(slide)
                            setLiveSlide(slide.id)
                        }
                        break
                    }
                    case 'stop_listening':
                        unifiedTranscriptionService.stop()
                        setIsListening(false)
                        break
                    case 'start_listening':
                        startRef.current()
                        break
                }

                if (cmd.type !== 'change_version') {
                    setLastVoiceCommand(cmd)
                    setVoiceCommands(prev => [...prev, cmd])
                }
                onVoiceCommand?.(cmd)
            }

            // Prevent same-chunk verse detection/redisplay from overwriting a just-requested command.
            if (handledVersionSwitch || handledNavigationCommand) {
                return
            }
            }
        }

        // Strip voice commands from transcript before running verse detection
        const commandsForStripping = enableVoiceCommands ? detectVoiceCommands(text) : []
        let cleanText = commandsForStripping.length > 0
            ? stripCommandsFromTranscript(text, commandsForStripping)
            : text

        // Filter hallucination patterns before verse detection
        const hallucinationResult = filterHallucinations(cleanText)
        if (hallucinationResult.hadHallucination) {
            console.log('[SermonListener] Filtered hallucination:', {
                repetitionsRemoved: hallucinationResult.repetitionsRemoved,
                fillersRemoved: hallucinationResult.fillersRemoved,
                profanityRemoved: hallucinationResult.profanityRemoved,
                confidence: hallucinationResult.confidence,
            })
            cleanText = hallucinationResult.cleanedText
        }

        // Post-process in the order: raw → hallucination → filler → custom-words
        // (each layer assumes a clean input from the previous one — see fillerFilter.ts).
        // Filler/stutter removal is language-aware; custom-word correction fixes
        // distinctive proper nouns Whisper mangles (e.g. "Nebuchadnezzar").
        cleanText = filterFillers(cleanText, { lang: language })
        // Safe profile for an always-on vocabulary: single-token matching only
        // (no n-gram word-eating) and no phonetic boost (no cross-word
        // collisions). The length pre-filter + tight Levenshtein threshold keep
        // it from touching short common words.
        cleanText = applyCustomWords(cleanText, [...SERMON_PROPER_NOUNS], 0.25, {
            maxNgram: 1,
            usePhonetic: false,
        })

        // Optional LLM augmentation: debounced pass that catches references the
        // local detector missed. No-op unless the user configured an endpoint.
        scheduleLlmExtraction(cleanText)

        const regexDetectionIdAtStart = regexVerseDetectionRef.current
        const inVersionSwitchCooldown = Date.now() < versionSwitchCooldownUntilRef.current
        const inNavigationCooldown = Date.now() < navigationCooldownUntilRef.current

        let verses = detectVerses(cleanText)

        // Resolve bare references (e.g. "verse 6") from active sermon context.
        // Only runs when no full book+chapter reference was found in this chunk,
        // and the context has not expired (default 120 s TTL).
        if (verses.length === 0) {
            const bareRefs = resolveBareReferences(cleanText, activeReferenceContextRef.current, CONTEXT_TTL_MS)
            if (bareRefs.length > 0) {
                verses = [...verses, ...bareRefs]
            }
        }

        // A preacher often announces "Book chapter N" and gives just the
        // verse number in its OWN separate utterance moments later, with no
        // "verse"/"versus" keyword at all ("Hebrews 13" ... "Five.") — the
        // keyword gets clipped by the ASR's pause-based chunking. Checked
        // against latestChunkForCommands specifically (not cleanText, which
        // can be the full accumulated transcript) so this only ever fires
        // when the ENTIRE latest utterance is nothing but a bare number.
        if (verses.length === 0 && latestChunkForCommands) {
            const standaloneRefs = resolveStandaloneNumberContinuation(latestChunkForCommands, activeReferenceContextRef.current)
            if (standaloneRefs.length > 0) {
                verses = [...verses, ...standaloneRefs]
            }
        }

        const confidenceOrder = { high: 3, medium: 2, low: 1 }
        const minConfidenceLevel = confidenceOrder[minConfidence]

        // Collect all valid verses from this query, filtering duplicates from the list
        const queryVerses: DetectedVerse[] = []
        const reActivatedRefs: string[] = []
        for (const verse of verses) {
            const verseConfidence = confidenceOrder[verse.confidence]
            if (verseConfidence < minConfidenceLevel) {
                continue
            }

            if (detectedRefsRef.current.has(verse.reference)) {
                reActivatedRefs.push(verse.reference)
                continue
            }

            queryVerses.push({
                ...verse,
                detectionType: 'regex' as const,
            })
        }

        // Sort by position in text (latest first) to get the most recently mentioned verse
        queryVerses.sort((a, b) => b.startIndex - a.startIndex)
        const limitedQueryVerses = queryVerses.slice(0, MAX_DETECTED_VERSES_PER_QUERY)

        // Mark ALL regex-detected verses as best matches (they are explicit references)
        for (const verse of limitedQueryVerses) {
            verse.isBestMatch = true
            detectedRefsRef.current.add(verse.reference)
        }

        const hasRegexVerses = limitedQueryVerses.length > 0
        const hasReActivated = reActivatedRefs.length > 0

        // Increment the regex detection counter so semantic results know a regex
        // verse was found more recently than when they started searching
        if (hasRegexVerses) {
            regexVerseDetectionRef.current++
        }

        // If we found new regex verses, also re-activate any previously detected verses
        // that were mentioned again — the most recently mentioned verse becomes current
        if (hasRegexVerses) {
            const now = Date.now()
            const versesWithTimestamp = limitedQueryVerses.map(v => ({
                ...v,
                lastActivatedAt: now,
                retriggerCount: 0,
            }))
            for (const v of versesWithTimestamp) {
                reactivationCooldownRef.current.set(v.reference, now)
                lastMatchTimeRef.current.set(v.reference, now)
                // Regex matches are explicit references — treat as 1.0 for
                // chapter-dedup comparison purposes so semantic matches in the
                // same chapter never override an explicit regex hit.
                lastScoreByReferenceRef.current.set(v.reference, 1.0)
            }
            setDetectedVerses(prev => dedupeVerses([...prev, ...versesWithTimestamp]))
            const latestVerse = versesWithTimestamp[0]
            setCurrentVerse(latestVerse)

            trackEvent(AnalyticsEventType.SERMON_LISTENER_VERSE_DETECTED, {
                reference: latestVerse.reference,
                confidence: latestVerse.confidence,
                detection_type: 'regex',
                verse_count: versesWithTimestamp.length,
            })

            // A voice command (e.g. bare "Hebrews 13") sets navigationCooldownUntilRef
            // so a stale, in-flight regex/semantic detection can't immediately
            // hijack the navigation it just performed. But a verse that CONTINUES
            // that same book+chapter — resolveBareReferences("verse 5") or
            // resolveStandaloneNumberContinuation("Five.") completing the exact
            // reference the command just set — isn't a competing navigation, it's
            // the rest of the same one. Without this check, "Hebrews 13" (voice
            // command, sets the cooldown) followed moments later by "Five." (its
            // own utterance, resolved against that context) got added to
            // detectedVerses/currentVerse correctly, but the live slide silently
            // stayed on the command's verse 1 because the cooldown blocked the
            // auto-display step below.
            const priorContext = activeReferenceContextRef.current
            const continuesSameReference = !!priorContext &&
                priorContext.book === latestVerse.book &&
                priorContext.chapter === latestVerse.chapter

            // Refresh active reference context so later bare references resolve correctly
            activeReferenceContextRef.current = updateContextFromVerse(latestVerse)

            // Auto-lookup if enabled
            if (autoLookup && !inVersionSwitchCooldown && (!inNavigationCooldown || continuesSameReference)) {
                lookupVerse(latestVerse).then(scripture => {
                    optionsRef.current.onVerseDetected?.(latestVerse, scripture)

                    // Auto-display if enabled
                    if (autoDisplay && scripture) {
                        // Create a slide using the proper function to apply template
                        const slide = createAutoDetectBibleSlide(scripture)

                        // Add slide to active slides and set as live
                        appendActiveSlide(slide)
                        setLiveSlide(slide.id)
                    }
                })
            } else {
                optionsRef.current.onVerseDetected?.(latestVerse, null)
            }
        } else if (hasReActivated) {
            // The previously-detected verse re-matched. Decide whether this is a
            // genuine re-reference (verse was silent for >= REACTIVATE_AFTER_SILENCE_MS)
            // or rolling-window noise (verse is still matching every chunk because
            // its keywords are in the sliding transcript).
            const reActivatedRef = reActivatedRefs[0]
            const existing = detectedVersesRef.current.find(v => v.reference === reActivatedRef)
            if (existing) {
                const now = Date.now()
                const lastMatch = lastMatchTimeRef.current.get(reActivatedRef) || 0
                const hasBeenSilent = lastMatch > 0 && (now - lastMatch) >= REACTIVATE_AFTER_SILENCE_MS
                lastMatchTimeRef.current.set(reActivatedRef, now)

                if (hasBeenSilent) {
                    // Genuine re-reference — the speaker has moved on and come back.
                    // Re-show: set LIVE, re-fetch scripture, re-append the slide.
                    setCurrentVerse({
                        ...existing,
                        retriggerCount: (existing.retriggerCount || 0) + 1,
                        lastActivatedAt: now,
                    })
                    reactivationCooldownRef.current.set(reActivatedRef, now)
                    if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                        lookupVerse(existing).then(scripture => {
                            optionsRef.current.onVerseDetected?.(existing, scripture)
                            if (autoDisplay && scripture) {
                                const slide = createAutoDetectBibleSlide(scripture)
                                appendActiveSlide(slide)
                                setLiveSlide(slide.id)
                            }
                        })
                    }
                } else {
                    // Rolling-window noise — the verse keywords are still in the
                    // sliding transcript. Just bump the retriggerCount so the
                    // operator can see the verse is still being discussed; do
                    // NOT touch the LIVE display or the slide queue.
                    detectedVersesRef.current = detectedVersesRef.current.map(v =>
                        v.reference === reActivatedRef
                            ? {
                                  ...v,
                                  retriggerCount: (v.retriggerCount || 0) + 1,
                                  lastActivatedAt: now,
                              }
                            : v,
                    )
                    reactivationCooldownRef.current.set(reActivatedRef, now)

                    if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                        // Fire the lookup callback for analytics / external integrations.
                        lookupVerse(existing).then(scripture => {
                            optionsRef.current.onVerseDetected?.(existing, scripture)
                        })
                    }
                }
            }
        }

        // Semantic verse detection (for paraphrases)
        // Use the ref (not state) to avoid a stale closure: the detector may
        // finish initialising *after* the onResult callback was registered.
        //
        // CRITICAL: Feed cleanText (voice commands stripped + hallucinations
        // filtered) — NOT raw text. Raw voice commands like "next verse" or
        // "previous verse" accumulate in the semantic buffer and cause false
        // positives (e.g. "previous this" matching Judges 18:6).
        const semanticReady = semanticDetectorRef.current && cleanText.length >= 30
        if (semanticReady) {
            setIsSemanticSearching(true)

            // Pass the regex-detected verse ranges to exclude them from semantic detection
            // This prevents semantic from matching explicit references like "John 3 16"
            const excludedRanges = limitedQueryVerses.map(v => ({
                startIndex: v.startIndex,
                endIndex: v.endIndex,
            }))

            // Use addText which handles throttling internally
            semanticDetectorRef.current!.addText(cleanText, excludedRanges).then((semanticMatches) => {
                // Stale means a regex verse was found AFTER this semantic search started.
                // In that case, skip updating currentVerse (regex takes priority) but still
                // add new verses to the detected list.
                const isStale = regexDetectionIdAtStart !== regexVerseDetectionRef.current

                if (!semanticMatches) {
                    return
                }

                // Convert semantic matches to DetectedVerse format
                const semanticVerses: DetectedVerse[] = []
                const semanticReActivatedRefs: Array<{ reference: string; confidence: DetectedVerse['confidence'] }> = []
                for (const match of semanticMatches) {
                    let bookName = match.book
                    const bookNum = parseInt(match.book, 10)
                    if (!isNaN(bookNum) && bookNum >= 1 && bookNum <= 66 && /^\d+$/.test(match.book)) {
                        bookName = NUMBER_TO_BOOK[bookNum] || match.book
                    }

                    const properReference = `${bookName} ${match.chapter}:${match.verse}`

                    // Real verse paraphrases against KJV with all-MiniLM-L6-v2
                    // score in the 0.70-0.85 range. Anything below 0.65 is almost
                    // always surface overlap on common theological words, which
                    // produced false positives like "finished" → John 19:30.
                    const confidence =
                        match.score >= 0.78 ? 'high' :
                        match.score >= 0.65 ? 'medium' :
                        'low'
                    const matchConfidenceLevel = confidenceOrder[confidence]

                    if (matchConfidenceLevel < minConfidenceLevel) {
                        continue
                    }

                    // Scripture-marker check. If the matched query has no marker
                    // word (verse, chapter, scripture, etc.) and the score is
                    // below SCRIPTURE_MARKER_MIN_SCORE, it's likely an
                    // incidental embedding match — the embedding model can hit
                    // a verse that uses a similar idiom or topic without the
                    // preacher actually quoting it. Reject unless the score is
                    // convincingly high. This runs BEFORE the reactivation check
                    // below so a weak, marker-free coincidental re-match can't
                    // silently re-trigger an already-detected (and possibly
                    // long-stale) verse — reactivation must clear the same bar a
                    // brand-new match would.
                    if (!SCRIPTURE_MARKER_RE.test(match.text) && match.score < SCRIPTURE_MARKER_MIN_SCORE) {
                        continue
                    }

                    // Re-activate if already detected, don't add duplicate to list.
                    // Carry the CURRENT match's confidence through — reactivation
                    // display must be gated on how good this fresh match is, not
                    // on whatever confidence the verse happened to have the first
                    // time it was detected (possibly minutes ago, at a different
                    // score).
                    if (detectedRefsRef.current.has(properReference)) {
                        semanticReActivatedRefs.push({ reference: properReference, confidence })
                        continue
                    }

                    // Chapter-level dedup. If a verse in the same book+chapter is
                    // already in the detected list (from a regex or a previous
                    // semantic match), suppress this new match unless its score
                    // beats the existing one by CHAPTER_DEDUP_DELTA. The 384-dim
                    // embedding model flags every nearby verse in a chapter
                    // above threshold, and we only want to surface one verse per
                    // chapter (the strongest one) unless a later paraphrase is
                    // much stronger.
                    const sameChapterExisting = detectedVersesRef.current.find(v =>
                        v.book === bookName && v.chapter === match.chapter
                    )
                    if (sameChapterExisting) {
                        const existingScore = lastScoreByReferenceRef.current.get(sameChapterExisting.reference) ?? 0
                        if (match.score < existingScore + CHAPTER_DEDUP_DELTA) {
                            // Skip — the existing chapter sibling is strong enough.
                            // We still record the score so a future much-stronger
                            // match can override, but we don't add this match.
                            lastScoreByReferenceRef.current.set(properReference, match.score)
                            continue
                        }
                    }

                    const detectedVerse: DetectedVerse = {
                        raw: match.reference,
                        reference: properReference,
                        book: bookName,
                        chapter: match.chapter,
                        verseStart: match.verse,
                        confidence: confidence,
                        startIndex: 0,
                        endIndex: text.length,
                        detectionType: 'semantic' as const,
                    }
                    semanticVerses.push(detectedVerse)
                }

                // Sort by score (highest first) and limit to max per query
                semanticVerses.sort((a, b) => {
                    const confOrder = { high: 3, medium: 2, low: 1 }
                    return confOrder[b.confidence] - confOrder[a.confidence]
                })
                const limitedSemanticVerses = semanticVerses.slice(0, MAX_DETECTED_VERSES_PER_QUERY)

                // Mark the best semantic match as isBestMatch and add to ref
                // Only add to detectedRefsRef if NOT stale — stale results should not
                // block future detections of the same verse by a fresher semantic search
                if (limitedSemanticVerses.length > 0) {
                    limitedSemanticVerses[0].isBestMatch = true
                    if (!isStale) {
                        for (const v of limitedSemanticVerses) {
                            detectedRefsRef.current.add(v.reference)
                        }
                    }
                }

                if (limitedSemanticVerses.length > 0) {
                    const now = Date.now()
                    const versesWithTimestamp = limitedSemanticVerses.map(v => ({
                        ...v,
                        lastActivatedAt: now,
                        retriggerCount: 0,
                    }))
                    for (const v of versesWithTimestamp) {
                        reactivationCooldownRef.current.set(v.reference, now)
                        lastMatchTimeRef.current.set(v.reference, now)
                        // Record the original cosine score for the chapter-dedup
                        // comparison. confidence is a bucketed label; the score
                        // itself is what matters for "is this a stronger match
                        // than what's already in the chapter".
                        const originalScore = (semanticMatches ?? []).find(m => {
                            const bn = (() => {
                                const n = parseInt(m.book, 10)
                                return !isNaN(n) && n >= 1 && n <= 66 && /^\d+$/.test(m.book)
                                    ? (NUMBER_TO_BOOK[n] || m.book)
                                    : m.book
                            })()
                            return bn === v.book && m.chapter === v.chapter && m.verse === v.verseStart
                        })?.score ?? 0
                        lastScoreByReferenceRef.current.set(v.reference, originalScore)
                    }
                    setDetectedVerses(prev => dedupeVerses([...prev, ...versesWithTimestamp]))

                    // Only update current verse if no regex verses were found AND
                    // no newer regex detection has happened since this search started
                    if (!hasRegexVerses && !isStale) {
                        const bestSemanticVerse = versesWithTimestamp[0]
                        setCurrentVerse(bestSemanticVerse)

                        trackEvent(AnalyticsEventType.SERMON_LISTENER_VERSE_DETECTED, {
                            reference: bestSemanticVerse.reference,
                            confidence: bestSemanticVerse.confidence,
                            detection_type: 'semantic',
                            verse_count: versesWithTimestamp.length,
                        })

                        if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                            lookupVerse(bestSemanticVerse).then(scripture => {
                                optionsRef.current.onVerseDetected?.(bestSemanticVerse, scripture)
                                // Only auto-project if the match cleared the medium
                                // confidence bar. Low-confidence matches (e.g. score
                                // 0.55-0.65 with only theological-common overlap) stay
                                // in the detected list for operator review.
                                if (autoDisplay && scripture && bestSemanticVerse.confidence !== 'low') {
                                    const slide = createAutoDetectBibleSlide(scripture)
                                    appendActiveSlide(slide)
                                    setLiveSlide(slide.id)
                                }
                            })
                        } else {
                            optionsRef.current.onVerseDetected?.(bestSemanticVerse, null)
                        }
                    }
                }

                // Re-activation of a previously-detected semantic verse. Same
                // silence-threshold rule as the regex path: if the verse has
                // been absent from the rolling window for at least
                // REACTIVATE_AFTER_SILENCE_MS, treat this as a genuine
                // re-reference and re-show. Otherwise it's rolling-window noise —
                // bump metadata only.
                if (semanticReActivatedRefs.length > 0 && !hasRegexVerses && !hasReActivated && limitedSemanticVerses.length === 0 && !isStale) {
                    const { reference: reActivatedRef, confidence: freshConfidence } = semanticReActivatedRefs[0]
                    const existing = detectedVersesRef.current.find(v => v.reference === reActivatedRef)
                    if (existing) {
                        const now = Date.now()
                        const lastMatch = lastMatchTimeRef.current.get(reActivatedRef) || 0
                        const hasBeenSilent = lastMatch > 0 && (now - lastMatch) >= REACTIVATE_AFTER_SILENCE_MS
                        lastMatchTimeRef.current.set(reActivatedRef, now)
                        reactivationCooldownRef.current.set(reActivatedRef, now)

                        if (hasBeenSilent) {
                            // Genuine re-reference. Re-show LIVE, re-fetch, re-append.
                            setCurrentVerse({
                                ...existing,
                                retriggerCount: (existing.retriggerCount || 0) + 1,
                                lastActivatedAt: now,
                            })
                            if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                                lookupVerse(existing).then(scripture => {
                                    optionsRef.current.onVerseDetected?.(existing, scripture)
                                    // Gate on the fresh re-match's confidence, not
                                    // the verse's original (possibly stale) one.
                                    if (autoDisplay && scripture && freshConfidence !== 'low') {
                                        const slide = createAutoDetectBibleSlide(scripture)
                                        appendActiveSlide(slide)
                                        setLiveSlide(slide.id)
                                    }
                                })
                            }
                        } else {
                            // Rolling-window noise. Metadata only.
                            detectedVersesRef.current = detectedVersesRef.current.map(v =>
                                v.reference === reActivatedRef
                                    ? {
                                          ...v,
                                          retriggerCount: (v.retriggerCount || 0) + 1,
                                          lastActivatedAt: now,
                                      }
                                    : v,
                            )
                            if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                                lookupVerse(existing).then(scripture => {
                                    optionsRef.current.onVerseDetected?.(existing, scripture)
                                })
                            }
                        }
                    }
                }
            }).catch((error: Error) => {
                console.error('[SemanticDetector] Search error:', error)
            }).finally(() => {
                setIsSemanticSearching(false)
            })
        }
    }, [minConfidence, autoLookup, autoDisplay, lookupVerse, createAutoDetectBibleSlide, appendActiveSlide, setLiveSlide, refreshLiveSlide, enableVoiceCommands, onVoiceCommand, dedupeVerses, applyBibleVersionChange, scheduleLlmExtraction])

    /**
     * Set transcription provider
     * Note: This is now primarily controlled by global settings.
     * This function is kept for local fallback/testing purposes.
     */
    const setTranscriptionProvider = useCallback(async (newProvider: TranscriptionProvider): Promise<boolean> => {
        if (isListening) {
            await unifiedTranscriptionService.stop()
        }

        setIsModelLoading(true)
        setModelLoadingProgress(0)

        // Use global settings for provider configuration
        const success = await unifiedTranscriptionService.setProvider(newProvider, {
            language: language.split('-')[0],
            useVAD: globalSettings?.sermonListener_useVAD,
            onProgress: setModelLoadingProgress,
        })

        setIsModelLoading(false)

        if (success) {
            setProvider(newProvider)
            setIsSupported(true)
        } else {
            setError('Failed to initialize transcription provider')
        }

        return success
    }, [
        isListening,
        language,
        globalSettings?.sermonListener_useVAD,
    ])

    /**
     * Start listening
     */
    const start = useCallback(async (): Promise<boolean> => {
        if (!isSupported) {
            const errorMsg = 'Speech recognition is not supported'
            setError(errorMsg)
            onError?.(errorMsg)
            trackEvent(AnalyticsEventType.SERMON_LISTENER_ERROR, { reason: 'unsupported' })
            return false
        }

        if (isListening) {
            console.warn('Already listening')
            return false
        }

        // Lazily initialize the provider when the user starts listening.
        // This avoids blocking the UI for 60s on app startup.
        if (!providerReady && provider !== 'web-speech') {
            setIsInitializingProvider(true)
            try {
                console.log('[useSermonListener] Provider not ready yet, checking via Rust:', provider)
                // Use Rust-side health check which CAN reach localhost even when
                // the browser can't (macOS WKWebView limitation).
                const { invoke } = await import('@tauri-apps/api/core')
                const result = await invoke<{ ready: boolean }>('check_whisper_ready')
                if (result.ready) {
                    console.log('[useSermonListener] Whisper server is available (Rust check), marking ready')
                    setProviderReady(true)
                    setError(null)
                } else {
                    console.log('[useSermonListener] Whisper server not ready yet, will auto-detect')
                    setIsInitializingProvider(false)
                    return false
                }
            } catch (err) {
                console.error('[useSermonListener] Provider availability check error:', err)
                setIsInitializingProvider(false)
                return false
            } finally {
                setIsInitializingProvider(false)
            }
        }

        // NOTE: model loading is moving to the in-process native engine
        // (transcribe-rs, Phase 3b). The selected model is configured in
        // Sermon Listener settings and downloaded there; the engine loads it on
        // demand. The current desktop-whisper sidecar auto-loads its bundled
        // base.en, so no per-start model switch is needed here during migration.

        // Initialize semantic detector on first use if not already ready
        if (!semanticDetectorReady) {
            initSemanticDetector().catch(err => {
                console.warn('[useSermonListener] Semantic detector init failed:', err)
            })
        }

        console.log('[useSermonListener] Starting transcription with provider:', provider)
        setIsStarting(true)

        // Prevent device from sleeping during sermon recording
        startKeepAwake().catch(err => {
            console.warn('[useSermonListener] Keep-awake failed (non-fatal):', err)
        })


        // Unlock AudioContext early so the VAD's internal AudioContext can resume
        try {
            const unlockCtx = new AudioContext()
            if (unlockCtx.state === 'suspended') {
                await unlockCtx.resume()
                console.log('[useSermonListener] AudioContext unlocked for transcription')
            }
            await unlockCtx.close()
        } catch (e) {
            console.warn('[useSermonListener] AudioContext unlock failed:', e)
        }

        // `unifiedTranscriptionService` is a module-level singleton, so its
        // internal `isListening` can outlive our React state (e.g. after this
        // provider remounts on navigation). When that happens our state resets
        // to false but the service still thinks it's running, so start() would
        // no-op with "Already listening" and the button would stay on "Start".
        // Reconcile by stopping the stale session before starting fresh.
        if (unifiedTranscriptionService.getStatus().isListening) {
            console.warn('[useSermonListener] Reconciling stale listening state before start')
            try {
                await unifiedTranscriptionService.stop()
            } catch (e) {
                console.warn('[useSermonListener] Failed to stop stale session:', e)
            }
        }

        const success = await unifiedTranscriptionService.start({
            provider,
            language,
            captureSource: sermonSettings?.captureSource,
            microphoneDeviceId: sermonSettings?.selectedMicrophoneId,
            continuous: true,
            interimResults: true,
            useVAD: globalSettings?.sermonListener_useVAD,
            // The Bible-biased prompt steers Whisper toward scripture vocabulary,
            // which garbles sung lyrics and surfaces spurious verses. When song
            // auto-detect is on (worship mode), use a neutral prompt so lyrics
            // transcribe cleanly; keep the scripture bias for sermon mode.
            initialPrompt: useAppStore.getState().songTracking.autoDetect ? '' : buildBibleInitialPrompt(),
            enableStreaming: true,
            onPartialSegment: (segment) => {
                console.log('[useSermonListener] Partial segment:', segment.text.substring(0, 50))
                setInterimTranscript(prev => {
                    const prefix = prev ? prev + ' ' : ''
                    return prefix + segment.text.trim()
                })
            },
            onStart: () => {
                setIsListening(true)
                setIsStarting(false)
                setError(null)
                audioFeedbackService.playStart()
                sessionStartTimeRef.current = Date.now()
                chunkStartTimeRef.current = 0
                trackEvent(AnalyticsEventType.SERMON_LISTENER_STARTED, {
                    provider,
                    language,
                    capture_source: sermonSettings?.captureSource,
                })
            },
            onEnd: () => {
                setIsListening(false)
            },
            onResult: (text, isFinal, _confidence, whisperSegments) => {
                console.log('[useSermonListener] onResult called:', { text: text.substring(0, 50), isFinal, hasSegments: !!whisperSegments?.length })

                // Clean up repeated phrases in the incoming text
                let cleanedText = cleanRepeatedPhrases(text)

                // Strip overlap with the very last chunk to avoid stuttering/repetitions (common in ASR)
                if (isFinal && recentChunksRef.current.length > 0) {
                    cleanedText = stripOverlap(cleanedText, recentChunksRef.current[recentChunksRef.current.length - 1])
                }

                // Skip transcript append for duplicates, but still process commands in the chunk.
                if (isDuplicateText(cleanedText)) {
                    console.log('[useSermonListener] Skipping duplicate text:', cleanedText.substring(0, 50))
                    processTranscript(transcriptBufferRef.current, cleanedText)
                    return
                }

                if (isFinal) {
                    // Add to recent chunks for deduplication
                    recentChunksRef.current.push(cleanedText)
                    if (recentChunksRef.current.length > MAX_RECENT_CHUNKS) {
                        recentChunksRef.current.shift()
                    }

                    // Track raw utterance for learning
                    setRawUtterances(prev => [...prev, { text: cleanedText, timestamp: Date.now() }].slice(-200))

                    // Cancel any pending interim debounce
                    if (interimDebounceRef.current) {
                        clearTimeout(interimDebounceRef.current)
                        interimDebounceRef.current = null
                    }

                    setInterimTranscript('')

                    // Build timestamped segment(s)
                    const now = Date.now()
                    const sessionStart = sessionStartTimeRef.current || now

                    if (whisperSegments && whisperSegments.length > 0 && provider === 'native') {
                        // Whisper returns segment timing in seconds relative to the utterance start.
                        // These are already adjusted by the desktop whisper service to be
                        // session-relative (VAD adds vadSpeechStartMs, native adds startOffsetMs).
                        // So we can use them directly — just convert seconds → milliseconds.
                        const newSegments: TranscriptSegment[] = whisperSegments.map((seg, idx) => {
                            return {
                                id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `seg-${now}-${idx}-${Math.random().toString(36).slice(2, 9)}`,
                                text: seg.text.trim(),
                                startMs: Math.max(0, Math.round(seg.start * 1000)),
                                endMs: Math.max(0, Math.round(seg.end * 1000)),
                                source: 'whisper' as const,
                            }
                        }).filter(seg => seg.text.length > 0)

                        setTranscriptSegments(prev => {
                            const next = [...prev, ...newSegments]
                            const fullText = next.map(s => s.text).join(' ').trim()
                            transcriptBufferRef.current = fullText
                            setTranscript(fullText)
                            return next
                        })
                    } else {
                        // Web Speech or no segment timing — use wall-clock offsets.
                        // chunkStartTimeRef tracks when the current chunk started (set on first
                        // interim, or falls back to sessionStart for immediate finals).
                        const segmentStart = chunkStartTimeRef.current || now
                        const segment: TranscriptSegment = {
                            id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `seg-${now}-${Math.random().toString(36).slice(2, 9)}`,
                            text: cleanedText,
                            startMs: Math.max(0, segmentStart - sessionStart),
                            endMs: Math.max(0, now - sessionStart),
                            source: provider === 'native' ? 'whisper' : 'web-speech',
                        }

                        setTranscriptSegments(prev => {
                            const next = [...prev, segment]
                            const fullText = next.map(s => s.text).join(' ').trim()
                            transcriptBufferRef.current = fullText
                            setTranscript(fullText)
                            return next
                        })
                    }

                    const newFullTranscript = `${transcriptBufferRef.current}`.trim()
                    processTranscript(newFullTranscript, cleanedText)
                    chunkStartTimeRef.current = 0
                    // Debounced transcript event — fire only on final results so
                    // we don't flood Amplitude with interim chunks.
                    if (lastTranscriptEventRef.current && Date.now() - lastTranscriptEventRef.current > 5000) {
                        trackEvent(AnalyticsEventType.SERMON_LISTENER_TRANSCRIPTION, {
                            length: newFullTranscript.length,
                            provider,
                        })
                        lastTranscriptEventRef.current = Date.now()
                    } else if (!lastTranscriptEventRef.current) {
                        lastTranscriptEventRef.current = Date.now()
                    }
                } else {
                    setInterimTranscript(cleanedText)
                    if (chunkStartTimeRef.current === 0) {
                        chunkStartTimeRef.current = Date.now()
                    }
                    const rollingContext = `${transcriptBufferRef.current} ${cleanedText}`.trim()
                    // Debounce interim verse detection to reduce processing load
                    if (interimDebounceRef.current) {
                        clearTimeout(interimDebounceRef.current)
                    }
                    interimDebounceRef.current = setTimeout(() => {
                        processTranscript(rollingContext, cleanedText)
                        interimDebounceRef.current = null
                    }, INTERIM_DEBOUNCE_MS)
                }
                onTranscriptUpdate?.(cleanedText, !isFinal)
            },
            onError: (err, message) => {
                const resolvedError = message || err
                setError(resolvedError)
                setIsListening(false)
                setIsStarting(false)
                onError?.(resolvedError)
                trackEvent(AnalyticsEventType.SERMON_LISTENER_ERROR, {
                    provider,
                    message: typeof resolvedError === 'string' ? resolvedError : 'unknown',
                })
            },
            onStatusChange: (status: TranscriptionStatus) => {
                setIsListening(status.isListening)
            },
            onSpeechStart: () => {
                setIsSpeechDetected(true)
            },
            onSpeechEnd: () => {
                setIsSpeechDetected(false)
            },
        })

        // Safety net: if the provider resolved without ever firing onStart
        // (e.g. it failed silently), don't leave the button stuck on "Starting".
        setIsStarting(false)
        return success
    }, [
        isSupported,
        isListening,
        providerReady,
        provider,
        language,
        onError,
        onTranscriptUpdate,
        processTranscript,
        cleanRepeatedPhrases,
        isDuplicateText,
        stripOverlap,
        provider,
        sermonSettings?.captureSource,
        sermonSettings?.selectedMicrophoneId,
        globalSettings?.sermonListener_transcriptionProvider,
        globalSettings?.sermonListener_useVAD,
        semanticDetectorReady,
        initSemanticDetector,
    ])

    // Keep ref in sync so processTranscript can call start without TDZ issues
    useEffect(() => {
        startRef.current = start
    }, [start])

    /**
     * Stop listening
     */
    const stop = useCallback(() => {
        if (llmDebounceRef.current) {
            clearTimeout(llmDebounceRef.current)
            llmDebounceRef.current = null
        }
        llmAbortRef.current?.abort()
        llmAbortRef.current = null
        const wasListening = isListening
        const durationMs = sessionStartTimeRef.current
            ? Date.now() - sessionStartTimeRef.current
            : 0
        if (wasListening) audioFeedbackService.playStop()
        unifiedTranscriptionService.stop()
        setIsListening(false)
        setIsStarting(false)
        setInterimTranscript('')
        setIsSpeechDetected(false)
        stopKeepAwake().catch((err: unknown) => {
            console.warn('[useSermonListener] Keep-awake release failed (non-fatal):', err)
        })
        if (wasListening) {
            trackEvent(AnalyticsEventType.SERMON_LISTENER_STOPPED, {
                duration_seconds: Math.round(durationMs / 1000),
                verses_detected: detectedVersesRef.current.length,
                provider,
            })
        }
    }, [provider, trackEvent])

    // Keep stopRef current for the watchdog (stop is defined just above).
    useEffect(() => {
        stopRef.current = stop
    }, [stop])

    // Watchdog: recover from a silently-dead capture. While listening, the
    // audio-features bus is fed continuously (Rust on desktop, the analyser on
    // web) — even during silence, since the mic still delivers buffers. If that
    // signal goes stale for a sustained window *after* we've seen it flowing,
    // the capture has died under us (the "Stop button but nothing happening"
    // case) and we restart it automatically instead of making the operator do it.
    useEffect(() => {
        if (!isListening) return
        let seenSignal = false
        let lastRecoveryMs = 0
        const STALE_MS = 9000
        const timer = setInterval(() => {
            if (!audioFeatures.isStale(2000)) {
                seenSignal = true
                return
            }
            if (!seenSignal) return // never started flowing — not a mid-session death
            if (!audioFeatures.isStale(STALE_MS)) return
            const nowMs = typeof performance !== 'undefined' ? performance.now() : 0
            if (nowMs - lastRecoveryMs < 30000) return // debounce restarts
            lastRecoveryMs = nowMs
            seenSignal = false
            console.warn('[useSermonListener] Audio signal lost mid-session — restarting capture')
            stopRef.current()
            setTimeout(() => { void startRef.current() }, 400)
        }, 2500)
        return () => clearInterval(timer)
    }, [isListening])

    /**
     * Reset state
     */
    const reset = useCallback(() => {
        setTranscript('')
        setTranscriptSegments([])
        setInterimTranscript('')
        setDetectedVerses([])
        setCurrentVerse(null)
        setCurrentScripture(null)
        setError(null)
        setIsSpeechDetected(false)
        setIsLoading(false)
        setLastVoiceCommand(null)
        setVoiceCommands([])
        setRawUtterances([])
        setActiveBibleVersion(defaultBibleVersion)
        processedCommandTimesRef.current = new Map()
        transcriptBufferRef.current = ''
        recentChunksRef.current = []
        detectedRefsRef.current = new Set()
        sessionStartTimeRef.current = 0
        chunkStartTimeRef.current = 0
        if (interimDebounceRef.current) {
            clearTimeout(interimDebounceRef.current)
            interimDebounceRef.current = null
        }
        unifiedTranscriptionService.clearTranscript()
        clearLiveSermonState().catch((err) => {
            console.warn('[useSermonListener] IDB clear live state failed:', err)
        })
    }, [defaultBibleVersion])

    /**
     * Remove a verse from the detected list
     */
    const removeVerse = useCallback((verse: DetectedVerse) => {
        setDetectedVerses(prev => prev.filter(v => v.reference !== verse.reference))
    }, [])

    /**
     * Save the current transcript
     */
    const saveCurrentTranscript = useCallback((title?: string): SavedSermonTranscript | null => {
        if (!transcript.trim()) return null

        const saved: SavedSermonTranscript = {
            id: `transcript-${Date.now()}`,
            title: title || `Sermon Transcript ${new Date().toLocaleDateString()}`,
            transcript,
            segments: transcriptSegments,
            provider,
            createdAt: new Date().toISOString(),
        }

        setSavedTranscripts(prev => [saved, ...prev])
        saveSermonTranscript({
            id: saved.id,
            title: saved.title,
            transcript: saved.transcript,
            segments: saved.segments,
            provider: saved.provider,
            createdAt: saved.createdAt,
        }).catch((err) => {
            console.warn('[useSermonListener] IDB save transcript failed:', err)
        })

        return saved
    }, [transcript, transcriptSegments, provider])

    /**
     * Delete a saved transcript
     */
    const deleteSavedTranscript = useCallback((id: string) => {
        setSavedTranscripts(prev => prev.filter(t => t.id !== id))
        deleteSavedTranscriptFromIDB(id).catch((err) => {
            console.warn('[useSermonListener] IDB delete transcript failed:', err)
        })
    }, [])

    /**
     * Clear all saved transcripts
     */
    const clearSavedTranscripts = useCallback(() => {
        setSavedTranscripts([])
        clearSavedTranscriptsInIDB().catch((err) => {
            console.warn('[useSermonListener] IDB clear transcripts failed:', err)
        })
    }, [])

    /**
     * Export current transcript as a file
     */
    const exportCurrentTranscript = useCallback((): boolean => {
        if (!transcript.trim()) return false

        try {
            const header = `=== Sermon Transcript ===\nDate: ${new Date().toISOString()}\n\n`
            const body = transcript
            const blob = new Blob([header + body], { type: 'text/plain' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `sermon-transcript-${new Date().toISOString().split('T')[0]}.txt`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            return true
        } catch (err) {
            console.error('Failed to export transcript:', err)
            return false
        }
    }, [transcript])

    // No auto-stop on unmount: panel hide/show should not reset active listener session.

    return {
        // State
        isListening,
        isStarting,
        isSupported,
        transcript,
        transcriptSegments,
        interimTranscript,
        detectedVerses,
        currentVerse,
        currentScripture,
        error,
        isLoading,
        provider,
        isModelLoading,
        modelLoadingProgress,
        isInitializingProvider,
        providerReady,
        savedTranscripts,
        semanticDetectionEnabled: enableSemanticDetection,
        semanticDetectorReady,
        isSemanticSearching,
        isSpeechDetected,
        audioLevel,
        captureSource,
        activeBibleVersion,
        lastVoiceCommand,
        voiceCommands,
        rawUtterances,
        // Actions
        start,
        stop,
        reset,
        lookupVerse,
        displayCurrentVerse,
        removeVerse,
        setProvider: setTranscriptionProvider,
        saveCurrentTranscript,
        deleteSavedTranscript,
        clearSavedTranscripts,
        exportCurrentTranscript,
        nextVerse,
        previousVerse,
        changeBibleVersion,
        setCurrentDetectedVerse,
    }
}

export default useSermonListener
