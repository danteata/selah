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
import { useScripture } from './useScripture'
import { useSlideCreation } from './useSlideCreation'
import { useAppStore } from '../store/appStore'
import { useGlobalSermonListenerSettings } from './useGlobalAppSettings'
import { unifiedTranscriptionService } from '../services/sermon-listener'
import type { TranscriptionProvider, TranscriptionStatus } from '../services/sermon-listener'
import { subscribeWhisperReadiness } from '../services/sermon-listener/whisperReadiness'
import { detectVerses,
    verseToLabel,
    getSemanticDetector,
    resetSemanticDetector,
    NUMBER_TO_BOOK,
} from '../services/sermon-listener'
import {
    detectVoiceCommands,
    stripCommandsFromTranscript,
} from '../services/sermon-listener/voiceCommandDetection'
import type { VoiceCommand } from '../services/sermon-listener/voiceCommandDetection'
import type { DetectedVerse } from '../services/sermon-listener'
import type { Scripture, BibleVersion } from '../types'
import { filterHallucinations, correctAccentMishearings } from '../services/sermon-listener/hallucinationFilter'
import { getNextChapter, getPreviousChapter } from '../utils/bibleReference'

const SERMON_TRANSCRIPT_STORAGE_KEY = 'sermon-listener:saved-transcripts'
const SERMON_LIVE_STATE_STORAGE_KEY = 'sermon-listener:live-state'
const MAX_DETECTED_VERSES_PER_QUERY = 3 // Max verses per semantic search query

export interface SavedSermonTranscript {
    id: string
    title: string
    transcript: string
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
    /** Whether speech recognition is supported */
    isSupported: boolean
    /** Current full transcript */
    transcript: string
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
    /** User corrections for verse detection learning */
    corrections: Array<{ reference: string; originalReference?: string; timestamp: number }>
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
    /** Record a user correction for learning */
    addCorrection: (reference: string, originalReference?: string) => void
}

export type UseSermonListenerReturn = SermonListenerState & SermonListenerActions

// Helper functions for localStorage persistence
function readSavedTranscripts(): SavedSermonTranscript[] {
    if (typeof window === 'undefined') return []
    try {
        const raw = localStorage.getItem(SERMON_TRANSCRIPT_STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw) as SavedSermonTranscript[]
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function writeSavedTranscripts(items: SavedSermonTranscript[]): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(SERMON_TRANSCRIPT_STORAGE_KEY, JSON.stringify(items))
}

interface PersistedLiveState {
    transcript: string
    detectedVerses: DetectedVerse[]
    currentVerse: DetectedVerse | null
    activeBibleVersion: string
}

function readLiveState(): PersistedLiveState | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = localStorage.getItem(SERMON_LIVE_STATE_STORAGE_KEY)
        return raw ? (JSON.parse(raw) as PersistedLiveState) : null
    } catch {
        return null
    }
}

function writeLiveState(state: PersistedLiveState): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(SERMON_LIVE_STATE_STORAGE_KEY, JSON.stringify(state))
}

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
    // Default to desktop-whisper on Tauri, web-speech on browser
    const defaultProvider: TranscriptionProvider = typeof window !== 'undefined' && '__TAURI__' in window ? 'desktop-whisper' : 'web-speech'
    const globalProvider = (globalSettings?.sermonListener_transcriptionProvider as TranscriptionProvider) || defaultProvider
    const targetProvider = providerOverride || globalProvider

    // Determine provider from settings or override
    const getInitialProvider = (): TranscriptionProvider => {
        return targetProvider
    }

    // State
    const [isListening, setIsListening] = useState(false)
    const [isSupported, setIsSupported] = useState(false)
    const [transcript, setTranscript] = useState(() => readLiveState()?.transcript || '')
    const [interimTranscript, setInterimTranscript] = useState('')
    const [detectedVerses, setDetectedVerses] = useState<DetectedVerse[]>(() => readLiveState()?.detectedVerses || [])
    const detectedVersesRef = useRef<DetectedVerse[]>(detectedVerses)
    const [currentVerse, setCurrentVerse] = useState<DetectedVerse | null>(() => readLiveState()?.currentVerse || null)
    const [currentScripture, setCurrentScripture] = useState<Scripture | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [provider, setProvider] = useState<TranscriptionProvider>(getInitialProvider)
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [modelLoadingProgress, setModelLoadingProgress] = useState(0)
    const [savedTranscripts, setSavedTranscripts] = useState<SavedSermonTranscript[]>(() => readSavedTranscripts())

    // Provider initialization state
    const [isInitializingProvider, setIsInitializingProvider] = useState(false)
    const [providerReady, setProviderReady] = useState(false)

    // Semantic detection state
    const [semanticDetectorReady, setSemanticDetectorReady] = useState(false)
    const [isSemanticSearching, setIsSemanticSearching] = useState(false)

    // Speech detection state (for visual feedback)
    const [isSpeechDetected, setIsSpeechDetected] = useState(false)
    const [corrections, setCorrections] = useState<Array<{ reference: string; originalReference?: string; timestamp: number }>>([])

    // Real-time audio level (0-1) for waveform visualization
    const [audioLevel, setAudioLevel] = useState(0)
    const [captureSource, setCaptureSource] = useState<'microphone' | 'system' | null>(null)
    const audioAnalyserRef = useRef<AnalyserNode | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const audioStreamRef = useRef<MediaStream | null>(null)
    const audioLevelRafRef = useRef<number | null>(null)

    // Voice command state
    const [activeBibleVersion, setActiveBibleVersion] = useState(() => readLiveState()?.activeBibleVersion || defaultBibleVersion)
    const activeBibleVersionRef = useRef(activeBibleVersion)
    const currentVerseRef = useRef<DetectedVerse | null>(currentVerse)
    const currentScriptureRef = useRef<Scripture | null>(null)
    const providerReadyRef = useRef(false)
    const [lastVoiceCommand, setLastVoiceCommand] = useState<VoiceCommand | null>(null)
    const [voiceCommands, setVoiceCommands] = useState<VoiceCommand[]>([])
    const [rawUtterances, setRawUtterances] = useState<Array<{ text: string; timestamp: number; confidence?: number }>>([])

    // Refs for callback stability
    const optionsRef = useRef(options)
    optionsRef.current = options

    // Track transcript buffer for context
    const transcriptBufferRef = useRef(readLiveState()?.transcript || '')

    // Track recent chunks for deduplication
    const recentChunksRef = useRef<string[]>([])
    const MAX_RECENT_CHUNKS = 5

    // Track detected verse references to prevent duplicates in the list
    const detectedRefsRef = useRef<Set<string>>(new Set())

    // Cooldown map for re-triggering already-detected verses (reference → last activated timestamp)
    const reactivationCooldownRef = useRef<Map<string, number>>(new Map())
    const REACTIVATION_COOLDOWN_MS = 30_000 // 30 seconds

    // Debounce timer for interim transcript processing
    const interimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const INTERIM_DEBOUNCE_MS = 300
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
    const versionChangeRequestIdRef = useRef(0)
    const verseLookupRequestIdRef = useRef(0)
    const activeLookupCountRef = useRef(0)
    const versionSwitchCooldownUntilRef = useRef(0)
    const navigationCooldownUntilRef = useRef(0)

    // Real-time audio level analysis via Web Audio API AnalyserNode
    // Reuses the transcription service's media stream to avoid duplicate getUserMedia calls
    const startAudioAnalyser = useCallback(async () => {
        try {
            const userCaptureSource = sermonSettings?.captureSource || 'microphone'
            let stream = unifiedTranscriptionService.getMediaStream()

            if (!stream) {
                if (userCaptureSource === 'system') {
                    // Native system audio capture has no web MediaStream.
                    // Visualization would need native audio level events (not yet implemented).
                    setCaptureSource('system')
                    console.log('[useSermonListener] System audio active — mic analyser disabled')
                    return
                }

                // Microphone capture: the stream may be managed internally by VAD or
                // native Rust capture, so we open a separate getUserMedia stream for
                // the analyser. This is lightweight — the actual audio goes through the
                // transcription path; we only read frequency data here.
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
                audioLevelRafRef.current = requestAnimationFrame(poll)
            }
            poll()
        } catch (e) {
            console.warn('[useSermonListener] Could not start audio analyser:', e)
        }
    }, [sermonSettings?.selectedMicrophoneId, sermonSettings?.captureSource])

    const stopAudioAnalyser = useCallback(() => {
        if (audioLevelRafRef.current != null) {
            cancelAnimationFrame(audioLevelRafRef.current)
            audioLevelRafRef.current = null
        }
        audioAnalyserRef.current = null
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
            const timer = setTimeout(startAudioAnalyser, 300)
            return () => clearTimeout(timer)
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

    // Persist live state to localStorage so a refresh restores the sermon in
    // progress. Debounced because transcript updates fire on every token —
    // serializing 30+ KB of JSON on every keystroke pegs the main thread.
    useEffect(() => {
        const timer = setTimeout(() => {
            writeLiveState({
                transcript,
                detectedVerses,
                currentVerse,
                activeBibleVersion,
            })
        }, 400)
        return () => clearTimeout(timer)
    }, [transcript, detectedVerses, currentVerse, activeBibleVersion])

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
            // isn't available (e.g. running the desktop bundle in dev without the sidecar).
            if (!available && targetProvider === 'desktop-whisper') {
                const webSpeechAvailable = await unifiedTranscriptionService.isProviderAvailable('web-speech')
                if (cancelled) return
                if (webSpeechAvailable) {
                    setProvider('web-speech')
                    setIsSupported(true)
                    setProviderReady(true)
                    setError('Desktop Whisper unavailable. Falling back to Web Speech API.')
                    return
                }
            }

            setProvider(targetProvider)
            setIsSupported(available)

            if (!available) {
                setProviderReady(false)
                return
            }

            // Web speech needs no model load; mark ready immediately.
            if (targetProvider === 'web-speech') {
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

        // Subscribe to the Rust readiness event. The bridge replays its current
        // state synchronously, so if the sidecar is already up we flip ready
        // immediately without waiting for the next emission.
        const unsubscribe = subscribeWhisperReadiness((state) => {
            if (cancelled) return
            if (targetProvider !== 'desktop-whisper') return
            if (state.ready) {
                setProviderReady(true)
                setError(null)
            } else if (state.error) {
                setError(`Desktop Whisper: ${state.error}`)
            }
        })

        return () => {
            cancelled = true
            unsubscribe()
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
        const slide = createBibleSlide(currentScripture)

        // Add slide to active slides and set as live
        appendActiveSlide(slide)
        setLiveSlide(slide.id)
    }, [currentScripture, createBibleSlide, appendActiveSlide, setLiveSlide])

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
            const newSlide = createBibleSlide(scripture)
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
            const slide = createBibleSlide(scripture)
            appendActiveSlide(slide)
            setLiveSlide(slide.id)
        }
        // When skipQueueAppend=true and no existing bible slide, do nothing.
        // The user explicitly wants voice navigation to never spam the queue.
    }, [createBibleSlide, updateActiveSlide, appendActiveSlide, setLiveSlide])

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
        const slide = createBibleSlide(scripture)
        appendActiveSlide(slide)
        setLiveSlide(slide.id)

        console.log('[SermonListener] Version switch applied:', {
            requestedVersionId,
            resolvedVersionId,
            verse: verseToSwitch.reference,
            scriptureVersion: scripture.version,
        })
        return true
    }, [resolveBibleVersionId, lookupVerse, createBibleSlide, appendActiveSlide, setLiveSlide])

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
                        const cur = currentVerseRef.current
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
                            navigationCooldownUntilRef.current = Date.now() + 3000
                            lookupVerse(next).then(scripture => {
                                if (scripture) {
                                    setCurrentScripture(scripture)
                                    refreshLiveSlide(scripture, true)
                                }
                            })
                            handledNavigationCommand = true
                        }
                        break
                    }
                    case 'previous_verse': {
                        const cur = currentVerseRef.current
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
                            navigationCooldownUntilRef.current = Date.now() + 3000
                            lookupVerse(prev).then(scripture => {
                                if (scripture) {
                                    setCurrentScripture(scripture)
                                    refreshLiveSlide(scripture, true)
                                }
                            })
                            handledNavigationCommand = true
                        }
                        break
                    }
                    case 'go_to_verse': {
                        const cur = currentVerseRef.current
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
                            navigationCooldownUntilRef.current = Date.now() + 3000
                            lookupVerse(goto).then(scripture => {
                                if (scripture) {
                                    setCurrentScripture(scripture)
                                    refreshLiveSlide(scripture, true)
                                }
                            })
                            handledNavigationCommand = true
                        }
                        break
                    }
                    case 'go_to_reference': {
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
                            navigationCooldownUntilRef.current = Date.now() + 3000
                            lookupVerse(goto).then(scripture => {
                                if (scripture) {
                                    setCurrentScripture(scripture)
                                    refreshLiveSlide(scripture, true)
                                }
                            })
                            handledNavigationCommand = true
                        }
                        break
                    }
                    case 'next_chapter': {
                        const cur = currentVerseRef.current
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
                                navigationCooldownUntilRef.current = Date.now() + 3000
                                lookupVerse(nextVerse).then(scripture => {
                                    if (scripture) {
                                        setCurrentScripture(scripture)
                                        refreshLiveSlide(scripture, true)
                                    }
                                })
                                handledNavigationCommand = true
                            }
                        }
                        break
                    }
                    case 'previous_chapter': {
                        const cur = currentVerseRef.current
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
                                navigationCooldownUntilRef.current = Date.now() + 3000
                                lookupVerse(prevVerse).then(scripture => {
                                    if (scripture) {
                                        setCurrentScripture(scripture)
                                        refreshLiveSlide(scripture, true)
                                    }
                                })
                                handledNavigationCommand = true
                            }
                        }
                        break
                    }
                    case 'display': {
                        const scripture = currentScriptureRef.current
                        if (scripture) {
                            const slide = createBibleSlide(scripture)
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

        const regexDetectionIdAtStart = regexVerseDetectionRef.current
        const inVersionSwitchCooldown = Date.now() < versionSwitchCooldownUntilRef.current
        const inNavigationCooldown = Date.now() < navigationCooldownUntilRef.current

        const verses = detectVerses(cleanText)

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
            }
            setDetectedVerses(prev => dedupeVerses([...prev, ...versesWithTimestamp]))
            const latestVerse = versesWithTimestamp[0]
            setCurrentVerse(latestVerse)

            // Auto-lookup if enabled
            if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                lookupVerse(latestVerse).then(scripture => {
                    optionsRef.current.onVerseDetected?.(latestVerse, scripture)

                    // Auto-display if enabled
                    if (autoDisplay && scripture) {
                        // Create a slide using the proper function to apply template
                        const slide = createBibleSlide(scripture)

                        // Add slide to active slides and set as live
                        appendActiveSlide(slide)
                        setLiveSlide(slide.id)
                    }
                })
            } else {
                optionsRef.current.onVerseDetected?.(latestVerse, null)
            }
        } else if (hasReActivated) {
            // No new verses, but a previously detected verse was mentioned again — re-activate it
            const reActivatedRef = reActivatedRefs[0]
            const existing = detectedVersesRef.current.find(v => v.reference === reActivatedRef)
            if (existing) {
                const now = Date.now()
                const lastActivated = reactivationCooldownRef.current.get(reActivatedRef) || 0
                const isOffCooldown = now - lastActivated >= REACTIVATION_COOLDOWN_MS

                setCurrentVerse({
                    ...existing,
                    retriggerCount: (existing.retriggerCount || 0) + 1,
                    lastActivatedAt: now,
                })

                if (isOffCooldown) {
                    reactivationCooldownRef.current.set(reActivatedRef, now)
                    if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                        lookupVerse(existing).then(scripture => {
                            optionsRef.current.onVerseDetected?.(existing, scripture)
                            if (autoDisplay && scripture) {
                                const slide = createBibleSlide(scripture)
                                appendActiveSlide(slide)
                                setLiveSlide(slide.id)
                            }
                        })
                    } else {
                        optionsRef.current.onVerseDetected?.(existing, null)
                    }
                }
            }
        }

        // Semantic verse detection (for paraphrases)
        // Use the ref (not state) to avoid a stale closure: the detector may
        // finish initialising *after* the onResult callback was registered.
        if (semanticDetectorRef.current && text.length >= 30) {
            setIsSemanticSearching(true)

            // Pass the regex-detected verse ranges to exclude them from semantic detection
            // This prevents semantic from matching explicit references like "John 3 16"
            const excludedRanges = limitedQueryVerses.map(v => ({
                startIndex: v.startIndex,
                endIndex: v.endIndex,
            }))

            // Use addText which handles throttling internally
            semanticDetectorRef.current.addText(text, excludedRanges).then((semanticMatches) => {
                // Stale means a regex verse was found AFTER this semantic search started.
                // In that case, skip updating currentVerse (regex takes priority) but still
                // add new verses to the detected list.
                const isStale = regexDetectionIdAtStart !== regexVerseDetectionRef.current

                if (!semanticMatches) {
                    return
                }

                // Convert semantic matches to DetectedVerse format
                const semanticVerses: DetectedVerse[] = []
                const semanticReActivatedRefs: string[] = []
                for (const match of semanticMatches) {
                    let bookName = match.book
                    const bookNum = parseInt(match.book, 10)
                    if (!isNaN(bookNum) && bookNum >= 1 && bookNum <= 66 && /^\d+$/.test(match.book)) {
                        bookName = NUMBER_TO_BOOK[bookNum] || match.book
                    }

                    const properReference = `${bookName} ${match.chapter}:${match.verse}`

                    // Semantic paraphrases naturally score lower than exact regex matches;
                    // use a more forgiving scale so verses like "kingdom of heaven... ten virgins"
                    // (Matthew 25) are not discarded.
                    const confidence = match.score >= 0.70 ? 'high' : match.score >= 0.55 ? 'medium' : 'low'
                    const matchConfidenceLevel = confidenceOrder[confidence]

                    if (matchConfidenceLevel < minConfidenceLevel) {
                        continue
                    }

                    // Re-activate if already detected, don't add duplicate to list
                    if (detectedRefsRef.current.has(properReference)) {
                        semanticReActivatedRefs.push(properReference)
                        continue
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
                    }
                    setDetectedVerses(prev => dedupeVerses([...prev, ...versesWithTimestamp]))

                    // Only update current verse if no regex verses were found AND
                    // no newer regex detection has happened since this search started
                    if (!hasRegexVerses && !isStale) {
                        const bestSemanticVerse = versesWithTimestamp[0]
                        setCurrentVerse(bestSemanticVerse)

                        if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                            lookupVerse(bestSemanticVerse).then(scripture => {
                                optionsRef.current.onVerseDetected?.(bestSemanticVerse, scripture)
                                if (autoDisplay && scripture) {
                                    const slide = createBibleSlide(scripture)
                                    appendActiveSlide(slide)
                                    setLiveSlide(slide.id)
                                }
                            })
                        } else {
                            optionsRef.current.onVerseDetected?.(bestSemanticVerse, null)
                        }
                    }
                }

                // Re-activate previously detected semantic verses as current
                if (semanticReActivatedRefs.length > 0 && !hasRegexVerses && !hasReActivated && limitedSemanticVerses.length === 0 && !isStale) {
                    const reActivatedRef = semanticReActivatedRefs[0]
                    const existing = detectedVersesRef.current.find(v => v.reference === reActivatedRef)
                    if (existing) {
                        const now = Date.now()
                        const lastActivated = reactivationCooldownRef.current.get(reActivatedRef) || 0
                        const isOffCooldown = now - lastActivated >= REACTIVATION_COOLDOWN_MS

                        setCurrentVerse({
                            ...existing,
                            retriggerCount: (existing.retriggerCount || 0) + 1,
                            lastActivatedAt: now,
                        })

                        if (isOffCooldown) {
                            reactivationCooldownRef.current.set(reActivatedRef, now)
                            if (autoLookup && !inVersionSwitchCooldown && !inNavigationCooldown) {
                                lookupVerse(existing).then(scripture => {
                                    optionsRef.current.onVerseDetected?.(existing, scripture)
                                    if (autoDisplay && scripture) {
                                        const slide = createBibleSlide(scripture)
                                        appendActiveSlide(slide)
                                        setLiveSlide(slide.id)
                                    }
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
    }, [minConfidence, autoLookup, autoDisplay, lookupVerse, createBibleSlide, appendActiveSlide, setLiveSlide, refreshLiveSlide, enableVoiceCommands, onVoiceCommand, dedupeVerses, applyBibleVersionChange])

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

        // Initialize semantic detector on first use if not already ready
        if (!semanticDetectorReady) {
            initSemanticDetector().catch(err => {
                console.warn('[useSermonListener] Semantic detector init failed:', err)
            })
        }

        console.log('[useSermonListener] Starting transcription with provider:', provider)

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

        const success = await unifiedTranscriptionService.start({
            provider,
            language,
            captureSource: sermonSettings?.captureSource,
            microphoneDeviceId: sermonSettings?.selectedMicrophoneId,
            continuous: true,
            interimResults: true,
            useVAD: globalSettings?.sermonListener_useVAD,
            initialPrompt: 'Bible sermon. Books: Genesis Exodus Leviticus Numbers Deuteronomy Joshua Judges Ruth Samuel Kings Chronicles Ezra Nehemiah Esther Job Psalms Proverbs Ecclesiastes Song Isaiah Jeremiah Lamentations Ezekiel Daniel Hosea Joel Amos Obadiah Jonah Micah Nahum Habakkuk Zephaniah Haggai Zechariah Malachi Matthew Mark Luke John Acts Romans Corinthians Galatians Ephesians Philippians Colossians Thessalonians Timothy Titus Philemon Hebrews James Peter John Jude Revelation. Chapter verse.',
            onStart: () => {
                setIsListening(true)
                setError(null)
            },
            onEnd: () => {
                setIsListening(false)
            },
            onResult: (text, isFinal) => {
                console.log('[useSermonListener] onResult called:', { text: text.substring(0, 50), isFinal })

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
                    const newFullTranscript = `${transcriptBufferRef.current} ${cleanedText}`.trim()
                    transcriptBufferRef.current = newFullTranscript
                    setTranscript(newFullTranscript)

                    processTranscript(newFullTranscript, cleanedText)
                } else {
                    setInterimTranscript(cleanedText)
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
                onError?.(resolvedError)
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
        unifiedTranscriptionService.stop()
        setIsListening(false)
        setInterimTranscript('')
        setIsSpeechDetected(false)
    }, [])

    /**
     * Reset state
     */
    const reset = useCallback(() => {
        setTranscript('')
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
        if (interimDebounceRef.current) {
            clearTimeout(interimDebounceRef.current)
            interimDebounceRef.current = null
        }
        unifiedTranscriptionService.clearTranscript()
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
            provider,
            createdAt: new Date().toISOString(),
        }

        setSavedTranscripts(prev => {
            const updated = [...prev, saved]
            writeSavedTranscripts(updated)
            return updated
        })

        return saved
    }, [transcript, provider])

    /**
     * Delete a saved transcript
     */
    const deleteSavedTranscript = useCallback((id: string) => {
        setSavedTranscripts(prev => {
            const updated = prev.filter(t => t.id !== id)
            writeSavedTranscripts(updated)
            return updated
        })
    }, [])

    /**
     * Clear all saved transcripts
     */
    const clearSavedTranscripts = useCallback(() => {
        setSavedTranscripts([])
        writeSavedTranscripts([])
    }, [])

    /**
     * Record a user correction for learning. Stores locally until Convex wiring is ready.
     */
    const addCorrection = useCallback((reference: string, originalReference?: string) => {
        setCorrections(prev => [...prev, { reference, originalReference, timestamp: Date.now() }])
        console.log('[SermonListener] User correction recorded:', { reference, originalReference })
    }, [])

    /**
     * Export current transcript as a file
     */
    const exportCurrentTranscript = useCallback((): boolean => {
        if (!transcript.trim()) return false

        try {
            const header = `=== Sermon Transcript ===\nDate: ${new Date().toISOString()}\n\n`
            const body = transcript
            const footer = corrections.length > 0
                ? `\n\n--- Corrections ---\n${corrections.map(c => `- ${c.reference}${c.originalReference ? ` (was: ${c.originalReference})` : ''} at ${new Date(c.timestamp).toISOString()}`).join('\n')}`
                : ''
            const blob = new Blob([header + body + footer], { type: 'text/plain' })
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
        isSupported,
        transcript,
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
        corrections,
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
        addCorrection,
    }
}

export default useSermonListener
