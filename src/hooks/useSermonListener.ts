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
import {
    detectVerses,
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

    // Real-time audio level (0-1) for waveform visualization
    const [audioLevel, setAudioLevel] = useState(0)
    const audioAnalyserRef = useRef<AnalyserNode | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const audioStreamRef = useRef<MediaStream | null>(null)
    const audioLevelRafRef = useRef<number | null>(null)

    // Voice command state
    const [activeBibleVersion, setActiveBibleVersion] = useState(() => readLiveState()?.activeBibleVersion || defaultBibleVersion)
    const activeBibleVersionRef = useRef(activeBibleVersion)
    const currentVerseRef = useRef<DetectedVerse | null>(currentVerse)
    const currentScriptureRef = useRef<Scripture | null>(null)
    const [lastVoiceCommand, setLastVoiceCommand] = useState<VoiceCommand | null>(null)
    const [voiceCommands, setVoiceCommands] = useState<VoiceCommand[]>([])

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
            let stream = unifiedTranscriptionService.getMediaStream()

            if (!stream) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                    audioStreamRef.current = stream
                } catch {
                    console.warn('[useSermonListener] Could not acquire audio stream for analyser')
                    return
                }
            }

            const ctx = new AudioContext()
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
    }, [])

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

    useEffect(() => {
        writeLiveState({
            transcript,
            detectedVerses,
            currentVerse,
            activeBibleVersion,
        })
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

    // Check support on mount and when settings change, and eagerly init provider
    useEffect(() => {
        const checkSupport = async () => {
            // Skip if global settings are still loading
            if (isGlobalSettingsLoading) {
                console.log('[useSermonListener] Waiting for global settings to load...')
                return
            }

            console.log('[useSermonListener] Checking provider availability:', {
                targetProvider,
                globalProvider,
                providerOverride,
            })

            const available = await unifiedTranscriptionService.isProviderAvailable(targetProvider)
            console.log('[useSermonListener] Provider available:', targetProvider, available)

            if (!available && (targetProvider === 'whisper' || targetProvider === 'whisper-cpp' || targetProvider === 'desktop-whisper')) {
                const webSpeechAvailable = await unifiedTranscriptionService.isProviderAvailable('web-speech')
                if (webSpeechAvailable) {
                    setProvider('web-speech')
                    setIsSupported(true)
                    setProviderReady(true)
                    const sourceProvider = targetProvider === 'whisper-cpp' ? 'Whisper.cpp' : targetProvider === 'desktop-whisper' ? 'Desktop Whisper' : 'Whisper'
                    setError(`${sourceProvider} is not available. Falling back to Web Speech API.`)
                    console.warn('[useSermonListener] Falling back to Web Speech API')
                    return
                }
            }

            setProvider(targetProvider)
            setIsSupported(available)

            // Eagerly initialize the provider so it's ready when the user clicks Start
            if (available && (targetProvider !== 'web-speech')) {
                setIsInitializingProvider(true)
                try {
                    console.log('[useSermonListener] Eagerly initializing provider:', targetProvider)
                    const success = await unifiedTranscriptionService.setProvider(targetProvider, {
                        language: language.split('-')[0],
                        whisperModel: (globalSettings?.sermonListener_whisperModel || 'base') as 'tiny' | 'base' | 'small' | 'medium',
                        whisperEndpoint: globalSettings?.sermonListener_whisperEndpoint,
                        whisperApiKey: globalSettings?.sermonListener_whisperApiKey,
                        whisperChunkDurationMs: globalSettings?.sermonListener_whisperChunkDurationMs,
                        whisperCppEndpoint: globalSettings?.sermonListener_whisperCppEndpoint,
                        whisperCppChunkDurationMs: globalSettings?.sermonListener_whisperCppChunkDurationMs,
                        fasterWhisperEndpoint: globalSettings?.sermonListener_fasterWhisperEndpoint,
                        fasterWhisperModel: globalSettings?.sermonListener_fasterWhisperModel as 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large-v1' | 'large-v2' | 'large-v3' | 'distil-large-v3' | undefined,
                        fasterWhisperChunkDurationMs: globalSettings?.sermonListener_fasterWhisperChunkDurationMs,
                        fasterWhisperAudioCaptureMode: globalSettings?.sermonListener_fasterWhisperAudioCaptureMode as 'browser-wav' | 'server-decode' | undefined,
                        fasterWhisperDisableBrowserProcessing: globalSettings?.sermonListener_fasterWhisperDisableBrowserProcessing,
                        useVAD: globalSettings?.sermonListener_useVAD,
                        elevenLabsApiKey: globalSettings?.sermonListener_elevenLabsApiKey,
                        elevenLabsModelId: globalSettings?.sermonListener_elevenLabsModelId,
                        elevenLabsChunkDurationMs: globalSettings?.sermonListener_elevenLabsChunkDurationMs,
                        onProgress: (progress: number) => {
                            setModelLoadingProgress(progress)
                        },
                        onStatusChange: (status: TranscriptionStatus) => {
                            const statusText = typeof status?.error === 'string' ? status.error : status?.provider || ''
                            console.log('[useSermonListener] Provider init status:', statusText)
                        },
                    })
                    setProviderReady(success)
                    if (!success) {
                        console.warn('[useSermonListener] Eager provider initialization failed')
                    }
                } catch (err) {
                    console.error('[useSermonListener] Eager provider init error:', err)
                } finally {
                    setIsInitializingProvider(false)
                }
            } else if (available) {
                setProviderReady(true)
            }
        }
        checkSupport()
    }, [
        targetProvider,
        globalProvider,
        providerOverride,
        isGlobalSettingsLoading,
        language,
        globalSettings?.sermonListener_whisperModel,
        globalSettings?.sermonListener_whisperEndpoint,
        globalSettings?.sermonListener_whisperApiKey,
        globalSettings?.sermonListener_whisperChunkDurationMs,
        globalSettings?.sermonListener_whisperCppEndpoint,
        globalSettings?.sermonListener_whisperCppChunkDurationMs,
        globalSettings?.sermonListener_fasterWhisperEndpoint,
        globalSettings?.sermonListener_fasterWhisperModel,
        globalSettings?.sermonListener_fasterWhisperChunkDurationMs,
        globalSettings?.sermonListener_fasterWhisperAudioCaptureMode,
        globalSettings?.sermonListener_fasterWhisperDisableBrowserProcessing,
        globalSettings?.sermonListener_useVAD,
        globalSettings?.sermonListener_elevenLabsApiKey,
        globalSettings?.sermonListener_elevenLabsModelId,
        globalSettings?.sermonListener_elevenLabsChunkDurationMs,
    ])

    // Initialize semantic detector
    useEffect(() => {
        if (!enableSemanticDetection) return

        const initDetector = async () => {
            try {
                const convexUrl = import.meta.env.VITE_CONVEX_URL
                if (!convexUrl) {
                    console.warn('[SemanticDetector] No Convex URL found, semantic detection disabled')
                    return
                }

                // Get the actual version ID from the bible versions list
                // The defaultBibleVersion might be the name (e.g., 'KJV') but we need the ID
                const versions = bibleVersions as BibleVersion[]
                const versionEntry = versions?.find(
                    (v) => v.name === defaultBibleVersion || v.id === defaultBibleVersion
                )
                const versionId = versionEntry?.id || defaultBibleVersion

                console.log('[SemanticDetector] Bible versions in store:', versions?.map(v => v.id + '/' + v.name))
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
            } catch (error) {
                console.error('[SemanticDetector] Initialization error:', error)
            }
        }

        initDetector()

        return () => {
            resetSemanticDetector()
            semanticDetectorRef.current = null
            setSemanticDetectorReady(false)
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
            const commands = detectVoiceCommands(commandSource)
            let handledVersionSwitch = false
            let handledNavigationCommand = false
            for (const cmd of commands) {
                const commandKey = `${cmd.type}:${cmd.versionId || ''}:${cmd.offset || ''}`
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
                                    const slide = createBibleSlide(scripture)
                                    appendActiveSlide(slide)
                                    setLiveSlide(slide.id)
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
                                    const slide = createBibleSlide(scripture)
                                    appendActiveSlide(slide)
                                    setLiveSlide(slide.id)
                                }
                            })
                            handledNavigationCommand = true
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
        const cleanText = commandsForStripping.length > 0
            ? stripCommandsFromTranscript(text, commandsForStripping)
            : text

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
            setDetectedVerses(prev => dedupeVerses([...prev, ...limitedQueryVerses]))
            const latestVerse = limitedQueryVerses[0]
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
            const existing = detectedVerses.find(v => v.reference === reActivatedRef)
            if (existing) {
                setCurrentVerse(existing)
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

        // Semantic verse detection (for paraphrases)
        if (semanticDetectorReady && semanticDetectorRef.current && text.length >= 50) {
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

                    const confidence = match.score >= 0.85 ? 'high' : match.score >= 0.75 ? 'medium' : 'low'
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
                    setDetectedVerses(prev => dedupeVerses([...prev, ...limitedSemanticVerses]))

                    // Only update current verse if no regex verses were found AND
                    // no newer regex detection has happened since this search started
                    if (!hasRegexVerses && !isStale) {
                        const bestSemanticVerse = limitedSemanticVerses[0]
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
                    const existing = detectedVerses.find(v => v.reference === reActivatedRef)
                    if (existing) {
                        setCurrentVerse(existing)
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
            }).catch((error: Error) => {
                console.error('[SemanticDetector] Search error:', error)
            }).finally(() => {
                setIsSemanticSearching(false)
            })
        }
    }, [minConfidence, autoLookup, autoDisplay, lookupVerse, createBibleSlide, appendActiveSlide, setLiveSlide, semanticDetectorReady, enableVoiceCommands, currentVerse, currentScripture, onVoiceCommand, dedupeVerses, detectedVerses, applyBibleVersionChange])

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
            whisperModel: (globalSettings?.sermonListener_whisperModel || 'base') as 'tiny' | 'base' | 'small' | 'medium',
            whisperEndpoint: globalSettings?.sermonListener_whisperEndpoint,
            whisperApiKey: globalSettings?.sermonListener_whisperApiKey,
            whisperChunkDurationMs: globalSettings?.sermonListener_whisperChunkDurationMs,
            whisperCppEndpoint: globalSettings?.sermonListener_whisperCppEndpoint,
            whisperCppChunkDurationMs: globalSettings?.sermonListener_whisperCppChunkDurationMs,
            fasterWhisperEndpoint: globalSettings?.sermonListener_fasterWhisperEndpoint,
            fasterWhisperModel: globalSettings?.sermonListener_fasterWhisperModel as 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large-v1' | 'large-v2' | 'large-v3' | 'distil-large-v3' | undefined,
            fasterWhisperChunkDurationMs: globalSettings?.sermonListener_fasterWhisperChunkDurationMs,
            fasterWhisperAudioCaptureMode: globalSettings?.sermonListener_fasterWhisperAudioCaptureMode as 'browser-wav' | 'server-decode' | undefined,
            fasterWhisperDisableBrowserProcessing: globalSettings?.sermonListener_fasterWhisperDisableBrowserProcessing,
            useVAD: globalSettings?.sermonListener_useVAD,
            elevenLabsApiKey: globalSettings?.sermonListener_elevenLabsApiKey,
            elevenLabsModelId: globalSettings?.sermonListener_elevenLabsModelId,
            elevenLabsChunkDurationMs: globalSettings?.sermonListener_elevenLabsChunkDurationMs,
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
        globalSettings?.sermonListener_whisperApiKey,
        globalSettings?.sermonListener_whisperChunkDurationMs,
        globalSettings?.sermonListener_whisperCppChunkDurationMs,
        globalSettings?.sermonListener_whisperCppEndpoint,
        globalSettings?.sermonListener_whisperEndpoint,
        globalSettings?.sermonListener_whisperModel,
        globalSettings?.sermonListener_fasterWhisperEndpoint,
        globalSettings?.sermonListener_fasterWhisperModel,
        globalSettings?.sermonListener_fasterWhisperChunkDurationMs,
        globalSettings?.sermonListener_fasterWhisperAudioCaptureMode,
        globalSettings?.sermonListener_fasterWhisperDisableBrowserProcessing,
        globalSettings?.sermonListener_useVAD,
        globalSettings?.sermonListener_elevenLabsApiKey,
        globalSettings?.sermonListener_elevenLabsModelId,
        globalSettings?.sermonListener_elevenLabsChunkDurationMs,
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

        console.log('[useSermonListener] Starting transcription with provider:', provider, {
            globalProvider: globalSettings?.sermonListener_transcriptionProvider,
            whisperCppEndpoint: globalSettings?.sermonListener_whisperCppEndpoint,
        })

        // Configure transcription using global settings
        const success = await unifiedTranscriptionService.start({
            provider,
            language,
            captureSource: sermonSettings?.captureSource,
            microphoneDeviceId: sermonSettings?.selectedMicrophoneId,
            continuous: true,
            interimResults: true,
            whisperModel: (globalSettings?.sermonListener_whisperModel || 'base') as 'tiny' | 'base' | 'small' | 'medium',
            whisperEndpoint: globalSettings?.sermonListener_whisperEndpoint,
            whisperApiKey: globalSettings?.sermonListener_whisperApiKey,
            whisperChunkDurationMs: globalSettings?.sermonListener_whisperChunkDurationMs,
            whisperCppEndpoint: globalSettings?.sermonListener_whisperCppEndpoint,
            whisperCppChunkDurationMs: globalSettings?.sermonListener_whisperCppChunkDurationMs,
            fasterWhisperEndpoint: globalSettings?.sermonListener_fasterWhisperEndpoint,
            fasterWhisperModel: globalSettings?.sermonListener_fasterWhisperModel as 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large-v1' | 'large-v2' | 'large-v3' | 'distil-large-v3' | undefined,
            fasterWhisperChunkDurationMs: globalSettings?.sermonListener_fasterWhisperChunkDurationMs,
            fasterWhisperAudioCaptureMode: globalSettings?.sermonListener_fasterWhisperAudioCaptureMode as 'browser-wav' | 'server-decode' | undefined,
            fasterWhisperDisableBrowserProcessing: globalSettings?.sermonListener_fasterWhisperDisableBrowserProcessing,
            useVAD: globalSettings?.sermonListener_useVAD,
            elevenLabsApiKey: globalSettings?.sermonListener_elevenLabsApiKey,
            elevenLabsModelId: globalSettings?.sermonListener_elevenLabsModelId,
            elevenLabsChunkDurationMs: globalSettings?.sermonListener_elevenLabsChunkDurationMs,
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
        globalSettings?.sermonListener_whisperApiKey,
        globalSettings?.sermonListener_whisperChunkDurationMs,
        globalSettings?.sermonListener_whisperCppChunkDurationMs,
        globalSettings?.sermonListener_whisperCppEndpoint,
        globalSettings?.sermonListener_whisperEndpoint,
        globalSettings?.sermonListener_whisperModel,
        globalSettings?.sermonListener_fasterWhisperEndpoint,
        globalSettings?.sermonListener_fasterWhisperModel,
        globalSettings?.sermonListener_fasterWhisperChunkDurationMs,
        globalSettings?.sermonListener_fasterWhisperAudioCaptureMode,
        globalSettings?.sermonListener_fasterWhisperDisableBrowserProcessing,
        globalSettings?.sermonListener_useVAD,
        globalSettings?.sermonListener_elevenLabsApiKey,
        globalSettings?.sermonListener_elevenLabsModelId,
        globalSettings?.sermonListener_elevenLabsChunkDurationMs,
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
     * Export current transcript as a file
     */
    const exportCurrentTranscript = useCallback((): boolean => {
        if (!transcript.trim()) return false

        try {
            const blob = new Blob([transcript], { type: 'text/plain' })
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
        semanticDetectionEnabled: enableSemanticDetection,
        semanticDetectorReady,
        isSemanticSearching,
        isSpeechDetected,
        audioLevel,
        activeBibleVersion,
        lastVoiceCommand,
        voiceCommands,
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
