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
import { useUserRole } from './useUserRole'
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
import type { DetectedVerse, SemanticVerseMatch } from '../services/sermon-listener'
import type { Slide, Scripture, BibleVersion } from '../types'

const SERMON_TRANSCRIPT_STORAGE_KEY = 'sermon-listener:saved-transcripts'
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
    /** Callback when a verse is detected */
    onVerseDetected?: (verse: DetectedVerse, scripture: Scripture | null) => void
    /** Callback when transcription updates */
    onTranscriptUpdate?: (transcript: string, isInterim: boolean) => void
    /** Callback on error */
    onError?: (error: string) => void
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
}

export interface SermonListenerActions {
    /** Start listening to the sermon */
    start: () => Promise<boolean>
    /** Stop listening */
    stop: () => void
    /** Clear the transcript and detected verses */
    reset: () => void
    /** Manually look up a specific verse */
    lookupVerse: (verse: DetectedVerse) => Promise<Scripture | null>
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
    } = options

    const { fetchScripture } = useScripture()
    const { createBibleSlide } = useSlideCreation()
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const bibleVersions = useAppStore((state) => state.bibleVersions)
    const sermonSettings = useAppStore((state) => state.settings.sermonListener)
    const activeSchedule = useAppStore((state) => state.activeSchedule)
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
    const globalProvider = (globalSettings?.sermonListener_transcriptionProvider as TranscriptionProvider) || 'web-speech'
    const targetProvider = providerOverride || globalProvider

    // Determine provider from settings or override
    const getInitialProvider = (): TranscriptionProvider => {
        return targetProvider
    }

    // State
    const [isListening, setIsListening] = useState(false)
    const [isSupported, setIsSupported] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [interimTranscript, setInterimTranscript] = useState('')
    const [detectedVerses, setDetectedVerses] = useState<DetectedVerse[]>([])
    const [currentVerse, setCurrentVerse] = useState<DetectedVerse | null>(null)
    const [currentScripture, setCurrentScripture] = useState<Scripture | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [provider, setProvider] = useState<TranscriptionProvider>(getInitialProvider)
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [modelLoadingProgress, setModelLoadingProgress] = useState(0)
    const [savedTranscripts, setSavedTranscripts] = useState<SavedSermonTranscript[]>(() => readSavedTranscripts())

    // Semantic detection state
    const [semanticDetectorReady, setSemanticDetectorReady] = useState(false)
    const [isSemanticSearching, setIsSemanticSearching] = useState(false)

    // Speech detection state (for visual feedback)
    const [isSpeechDetected, setIsSpeechDetected] = useState(false)

    // Refs for callback stability
    const optionsRef = useRef(options)
    optionsRef.current = options

    // Track transcript buffer for context
    const transcriptBufferRef = useRef('')

    // Track recent chunks for deduplication
    const recentChunksRef = useRef<string[]>([])
    const MAX_RECENT_CHUNKS = 5

    // Track detected verse references to prevent duplicates (sync across regex and semantic)
    const detectedRefsRef = useRef<Set<string>>(new Set())

    /**
     * Check if text is a duplicate or near-duplicate of recent chunks
     * Returns true if the text should be skipped (is a duplicate)
     */
    const isDuplicateText = useCallback((newText: string): boolean => {
        if (!newText || newText.length < 5) return false

        const normalizedNew = newText.toLowerCase().trim()

        // Check against recent chunks
        for (const recent of recentChunksRef.current) {
            const normalizedRecent = recent.toLowerCase().trim()

            // Exact match
            if (normalizedNew === normalizedRecent) {
                return true
            }

            // Check if new text is contained in recent or vice versa
            if (normalizedNew.includes(normalizedRecent) || normalizedRecent.includes(normalizedNew)) {
                // If one is significantly longer, it might be an extension
                const lengthRatio = Math.min(normalizedNew.length, normalizedRecent.length) /
                    Math.max(normalizedNew.length, normalizedRecent.length)
                if (lengthRatio > 0.7) {
                    return true
                }
            }

            // Check for repeated patterns (e.g., "Okay. Okay. Okay.")
            const words = normalizedNew.split(/\s+/)
            if (words.length >= 3) {
                // Check if the same phrase is repeated
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

    // Semantic detector ref
    const semanticDetectorRef = useRef<ReturnType<typeof getSemanticDetector> | null>(null)

    // Check support on mount and when settings change
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

            if (!available && (targetProvider === 'whisper' || targetProvider === 'whisper-cpp')) {
                const webSpeechAvailable = await unifiedTranscriptionService.isProviderAvailable('web-speech')
                if (webSpeechAvailable) {
                    setProvider('web-speech')
                    setIsSupported(true)
                    const sourceProvider = targetProvider === 'whisper-cpp' ? 'Whisper.cpp' : 'Whisper'
                    setError(`${sourceProvider} is not configured. Falling back to Web Speech API.`)
                    console.warn('[useSermonListener] Falling back to Web Speech API')
                    return
                }
            }

            setProvider(targetProvider)
            setIsSupported(available)
        }
        checkSupport()
    }, [targetProvider, globalProvider, providerOverride, isGlobalSettingsLoading])

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
    const lookupVerse = useCallback(async (verse: DetectedVerse): Promise<Scripture | null> => {
        const label = verseToLabel(verse)
        if (!label) {
            console.warn('Could not convert verse to label:', verse)
            return null
        }

        setIsLoading(true)
        try {
            const scripture = await fetchScripture(label, defaultBibleVersion)
            if (scripture) {
                setCurrentScripture(scripture)
            }
            return scripture
        } catch (err) {
            console.error('Failed to look up verse:', err)
            return null
        } finally {
            setIsLoading(false)
        }
    }, [fetchScripture, defaultBibleVersion])

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
     * Process transcript for verse detection
     */
    const processTranscript = useCallback((text: string) => {
        if (!text) return

        console.log('[useSermonListener] ========== PROCESSING TRANSCRIPT ==========')
        console.log('[useSermonListener] Text:', text.substring(0, 150))
        console.log('[useSermonListener] Current detectedRefsRef:', Array.from(detectedRefsRef.current))

        // Regex-based verse detection
        const verses = detectVerses(text)
        console.log('[useSermonListener] Regex detected verses:', verses.length, verses.map(v => ({
            reference: v.reference,
            raw: v.raw,
            startIndex: v.startIndex,
            endIndex: v.endIndex,
            confidence: v.confidence
        })))

        // Note: We don't need extractVerseFromContext here because detectVerses
        // already processes the full text. Using both would create duplicates.

        // Filter by confidence
        const confidenceOrder = { high: 3, medium: 2, low: 1 }
        const minConfidenceLevel = confidenceOrder[minConfidence]

        // Collect all valid verses from this query, filtering duplicates via ref
        const queryVerses: DetectedVerse[] = []
        for (const verse of verses) {
            const verseConfidence = confidenceOrder[verse.confidence]
            if (verseConfidence < minConfidenceLevel) {
                console.log('[useSermonListener] Skipping verse (low confidence):', verse.reference, verse.confidence)
                continue
            }

            // Check if already detected (using ref for sync check)
            if (detectedRefsRef.current.has(verse.reference)) {
                console.log('[useSermonListener] Skipping verse (already in ref):', verse.reference)
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
            // Add to ref to prevent semantic from adding duplicates
            detectedRefsRef.current.add(verse.reference)
            console.log('[useSermonListener] Added to detectedRefsRef:', verse.reference)
        }

        console.log('[useSermonListener] Regex verses to add:', limitedQueryVerses.map(v => ({
            reference: v.reference,
            detectionType: v.detectionType,
            startIndex: v.startIndex,
            endIndex: v.endIndex
        })))

        // Track if we found regex verses (to prevent semantic from overwriting current)
        const hasRegexVerses = limitedQueryVerses.length > 0

        // If we found verses from regex, update state
        if (hasRegexVerses) {
            console.log('[useSermonListener] Adding regex verses to state:', limitedQueryVerses.map(v => v.reference))

            setDetectedVerses(prev => [...prev, ...limitedQueryVerses])

            // Set the LATEST verse (highest startIndex) as current
            const latestVerse = limitedQueryVerses[0] // Already sorted by position
            setCurrentVerse(latestVerse)

            // Auto-lookup if enabled
            if (autoLookup) {
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
            console.log('[useSermonListener] Excluded ranges for semantic:', excludedRanges)

            // Use addText which handles throttling internally
            semanticDetectorRef.current.addText(text, excludedRanges).then((semanticMatches) => {
                if (!semanticMatches) {
                    console.log('[useSermonListener] Semantic returned null (throttled or buffer too short)')
                    return // Throttled or buffer too short
                }

                console.log('[useSermonListener] Semantic matches returned:', semanticMatches.length, semanticMatches.map(m => ({
                    reference: m.reference,
                    book: m.book,
                    chapter: m.chapter,
                    verse: m.verse,
                    score: m.score
                })))

                // Convert semantic matches to DetectedVerse format
                const semanticVerses: DetectedVerse[] = []
                for (const match of semanticMatches) {
                    // Convert book number to book name if needed
                    let bookName = match.book
                    const bookNum = parseInt(match.book, 10)
                    if (!isNaN(bookNum) && bookNum >= 1 && bookNum <= 66) {
                        bookName = NUMBER_TO_BOOK[bookNum] || match.book
                    }

                    // Build proper reference with book name
                    const properReference = `${bookName} ${match.chapter}:${match.verse}`

                    // Calculate confidence
                    const confidence = match.score >= 0.85 ? 'high' : match.score >= 0.75 ? 'medium' : 'low'
                    const matchConfidenceLevel = confidenceOrder[confidence]

                    // Filter by minConfidence setting
                    if (matchConfidenceLevel < minConfidenceLevel) {
                        console.log('[useSermonListener] Skipping semantic verse (low confidence):', properReference, confidence, match.score)
                        continue
                    }

                    console.log('[useSermonListener] Checking semantic match:', properReference, 'already detected?', detectedRefsRef.current.has(properReference))

                    // Skip if already detected (check ref for sync)
                    if (detectedRefsRef.current.has(properReference)) {
                        console.log('[useSermonListener] Skipping semantic verse (already in ref):', properReference)
                        continue
                    }

                    // Convert to DetectedVerse format
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
                if (limitedSemanticVerses.length > 0) {
                    limitedSemanticVerses[0].isBestMatch = true
                    for (const v of limitedSemanticVerses) {
                        detectedRefsRef.current.add(v.reference)
                        console.log('[useSermonListener] Added semantic verse to detectedRefsRef:', v.reference)
                    }
                }

                console.log('[useSermonListener] Semantic verses to add:', limitedSemanticVerses.map(v => ({
                    reference: v.reference,
                    detectionType: v.detectionType,
                    confidence: v.confidence
                })))

                if (limitedSemanticVerses.length > 0) {
                    console.log('[useSermonListener] Adding semantic verses to state:', limitedSemanticVerses.map(v => v.reference))

                    setDetectedVerses(prev => [...prev, ...limitedSemanticVerses])

                    // Only update current verse if we didn't have regex verses
                    // (regex verses are explicit references and take priority)
                    if (!hasRegexVerses) {
                        const bestSemanticVerse = limitedSemanticVerses[0]
                        setCurrentVerse(bestSemanticVerse)

                        // Auto-lookup if enabled
                        if (autoLookup) {
                            lookupVerse(bestSemanticVerse).then(scripture => {
                                optionsRef.current.onVerseDetected?.(bestSemanticVerse, scripture)

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
                            optionsRef.current.onVerseDetected?.(bestSemanticVerse, null)
                        }
                    }
                }
            }).catch((error: Error) => {
                console.error('[SemanticDetector] Search error:', error)
            }).finally(() => {
                setIsSemanticSearching(false)
            })
        }
    }, [minConfidence, autoLookup, autoDisplay, lookupVerse, createBibleSlide, activeSchedule, appendActiveSlide, setLiveSlide, semanticDetectorReady])

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
                const cleanedText = cleanRepeatedPhrases(text)

                // Skip if this is a duplicate of recent content
                if (isDuplicateText(cleanedText)) {
                    console.log('[useSermonListener] Skipping duplicate text:', cleanedText.substring(0, 50))
                    return
                }

                if (isFinal) {
                    // Add to recent chunks for deduplication
                    recentChunksRef.current.push(cleanedText)
                    if (recentChunksRef.current.length > MAX_RECENT_CHUNKS) {
                        recentChunksRef.current.shift()
                    }

                    setInterimTranscript('')
                    const newFullTranscript = `${transcriptBufferRef.current} ${cleanedText}`.trim()
                    transcriptBufferRef.current = newFullTranscript
                    setTranscript(newFullTranscript)

                    console.log('[useSermonListener] Updated transcript:', newFullTranscript.substring(0, 100))
                    processTranscript(newFullTranscript)
                } else {
                    setInterimTranscript(cleanedText)
                    const rollingContext = `${transcriptBufferRef.current} ${cleanedText}`.trim()
                    processTranscript(rollingContext)
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
        provider,
        sermonSettings?.whisperApiKey,
        sermonSettings?.whisperChunkDurationMs,
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
        transcriptBufferRef.current = ''
        recentChunksRef.current = []
        detectedRefsRef.current = new Set() // Clear detected refs
        unifiedTranscriptionService.clearTranscript()
    }, [])

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

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (isListening) {
                unifiedTranscriptionService.stop()
            }
        }
    }, [isListening])

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
        savedTranscripts,
        semanticDetectionEnabled: enableSemanticDetection,
        semanticDetectorReady,
        isSemanticSearching,
        isSpeechDetected,
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
    }
}

export default useSermonListener
