/**
 * useSermonListener Hook
 * Combines speech recognition with Bible verse detection for real-time sermon listening
 * 
 * Supports both Web Speech API and Whisper.cpp transcription providers
 * Includes semantic verse detection using local embeddings (Transformers.js)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useScripture } from './useScripture'
import { useSlideCreation } from './useSlideCreation'
import { useAppStore } from '../store/appStore'
import { unifiedTranscriptionService } from '../services/sermon-listener'
import type { TranscriptionProvider, TranscriptionStatus } from '../services/sermon-listener'
import {
    detectVerses,
    extractVerseFromContext,
    verseToLabel,
    getSemanticDetector,
    resetSemanticDetector,
    NUMBER_TO_BOOK,
} from '../services/sermon-listener'
import type { DetectedVerse, SemanticVerseMatch } from '../services/sermon-listener'
import type { Slide, Scripture, BibleVersion } from '../types'

const SERMON_TRANSCRIPT_STORAGE_KEY = 'sermon-listener:saved-transcripts'
const MAX_DETECTED_VERSES = 3

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

    const language = languageOverride || sermonSettings?.language || 'en-US'
    const autoLookup = autoLookupOverride ?? sermonSettings?.autoLookup ?? true
    const autoDisplay = autoDisplayOverride ?? sermonSettings?.autoDisplay ?? false
    const minConfidence = minConfidenceOverride ?? 'high'
    const enableSemanticDetection = options.enableSemanticDetection ?? true

    // Determine provider from settings or override
    const getInitialProvider = (): TranscriptionProvider => {
        if (providerOverride) return providerOverride
        return sermonSettings?.transcriptionProvider || 'web-speech'
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

    // Refs for callback stability
    const optionsRef = useRef(options)
    optionsRef.current = options

    // Track processed verses to avoid duplicates
    const processedVersesRef = useRef<Set<string>>(new Set())
    const transcriptBufferRef = useRef('')

    // Semantic detector ref
    const semanticDetectorRef = useRef<ReturnType<typeof getSemanticDetector> | null>(null)

    // Check support on mount and when settings change
    useEffect(() => {
        const checkSupport = async () => {
            // Get the current provider from settings
            const settingsProvider = sermonSettings?.transcriptionProvider || 'web-speech'
            const targetProvider = providerOverride || settingsProvider

            console.log('[useSermonListener] Checking provider availability:', {
                targetProvider,
                settingsProvider,
                providerOverride,
                currentProvider: provider,
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
    }, [provider, providerOverride, sermonSettings?.transcriptionProvider])

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
     */
    const lookupVerse = useCallback(async (verse: DetectedVerse): Promise<Scripture | null> => {
        const label = verseToLabel(verse)
        if (!label) {
            console.warn('Could not convert verse to label:', verse)
            return null
        }

        setIsLoading(true)
        // Set the current verse immediately so the reference updates
        setCurrentVerse(verse)
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

        // Regex-based verse detection
        const verses = detectVerses(text)
        const contextVerse = extractVerseFromContext(text, 300)
        const candidateVerses = contextVerse
            ? [...verses, contextVerse]
            : verses

        // Filter by confidence and check for new verses
        const confidenceOrder = { high: 3, medium: 2, low: 1 }
        const minConfidenceLevel = confidenceOrder[minConfidence]

        for (const verse of candidateVerses) {
            const verseConfidence = confidenceOrder[verse.confidence]
            if (verseConfidence < minConfidenceLevel) continue

            // Check if already processed
            const verseKey = verse.reference
            if (processedVersesRef.current.has(verseKey)) continue

            // Mark as processed
            processedVersesRef.current.add(verseKey)

            // Add to detected verses and limit to max
            setDetectedVerses(prev => {
                // Avoid duplicates in state
                if (prev.some(v => v.reference === verse.reference)) return prev

                // Add new verse and sort by confidence (high > medium > low)
                const confidenceOrder = { high: 3, medium: 2, low: 1 }
                const updated = [...prev, verse].sort((a, b) =>
                    confidenceOrder[b.confidence] - confidenceOrder[a.confidence]
                )

                // Limit to MAX_DETECTED_VERSES
                return updated.slice(0, MAX_DETECTED_VERSES)
            })

            // Set as current verse - this will be the highest confidence verse
            // (We'll select the best matched verse after all processing)

            // Auto-lookup if enabled
            if (autoLookup) {
                lookupVerse(verse).then(scripture => {
                    optionsRef.current.onVerseDetected?.(verse, scripture)

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
                optionsRef.current.onVerseDetected?.(verse, null)
            }
        }

        // Semantic verse detection (for paraphrases)
        if (semanticDetectorReady && semanticDetectorRef.current && text.length >= 50) {
            setIsSemanticSearching(true)
            // Use addText which handles throttling internally
            semanticDetectorRef.current.addText(text).then((semanticMatches) => {
                if (!semanticMatches) return // Throttled or buffer too short

                for (const match of semanticMatches) {
                    // Check if already processed
                    if (processedVersesRef.current.has(match.reference)) continue

                    // Mark as processed
                    processedVersesRef.current.add(match.reference)

                    // Convert book number to book name if needed
                    let bookName = match.book
                    const bookNum = parseInt(match.book, 10)
                    if (!isNaN(bookNum) && bookNum >= 1 && bookNum <= 66) {
                        bookName = NUMBER_TO_BOOK[bookNum] || match.book
                    }

                    // Build proper reference with book name
                    const properReference = `${bookName} ${match.chapter}:${match.verse}`

                    // Convert to DetectedVerse format
                    const detectedVerse: DetectedVerse = {
                        raw: match.reference,
                        reference: properReference,
                        book: bookName,
                        chapter: match.chapter,
                        verseStart: match.verse,
                        confidence: match.score >= 0.85 ? 'high' : match.score >= 0.75 ? 'medium' : 'low',
                        startIndex: 0,
                        endIndex: text.length,
                    }

                    // Add to detected verses and limit to max
                    setDetectedVerses(prev => {
                        if (prev.some(v => v.reference === match.reference)) return prev

                        // Add new verse and sort by confidence (high > medium > low)
                        const confidenceOrder = { high: 3, medium: 2, low: 1 }
                        const updated = [...prev, detectedVerse].sort((a, b) =>
                            confidenceOrder[b.confidence] - confidenceOrder[a.confidence]
                        )

                        // Limit to MAX_DETECTED_VERSES
                        return updated.slice(0, MAX_DETECTED_VERSES)
                    })

                    // Current verse will be set by the effect that watches detectedVerses

                    // Auto-lookup if enabled
                    if (autoLookup) {
                        lookupVerse(detectedVerse).then(scripture => {
                            optionsRef.current.onVerseDetected?.(detectedVerse, scripture)
                        })
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
     */
    const setTranscriptionProvider = useCallback(async (newProvider: TranscriptionProvider): Promise<boolean> => {
        if (isListening) {
            await unifiedTranscriptionService.stop()
        }

        setIsModelLoading(true)
        setModelLoadingProgress(0)

        const success = await unifiedTranscriptionService.setProvider(newProvider, {
            language: language.split('-')[0],
            whisperModel: sermonSettings?.whisperModel || 'base',
            whisperEndpoint: sermonSettings?.whisperEndpoint,
            whisperApiKey: sermonSettings?.whisperApiKey,
            whisperChunkDurationMs: sermonSettings?.whisperChunkDurationMs,
            whisperCppEndpoint: sermonSettings?.whisperCppEndpoint,
            whisperCppChunkDurationMs: sermonSettings?.whisperCppChunkDurationMs,
            elevenLabsApiKey: sermonSettings?.elevenLabsApiKey,
            elevenLabsModelId: sermonSettings?.elevenLabsModelId,
            elevenLabsChunkDurationMs: sermonSettings?.elevenLabsChunkDurationMs,
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
        sermonSettings?.whisperApiKey,
        sermonSettings?.whisperChunkDurationMs,
        sermonSettings?.whisperCppChunkDurationMs,
        sermonSettings?.whisperCppEndpoint,
        sermonSettings?.whisperEndpoint,
        sermonSettings?.whisperModel,
        sermonSettings?.elevenLabsApiKey,
        sermonSettings?.elevenLabsModelId,
        sermonSettings?.elevenLabsChunkDurationMs,
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
            sermonSettingsProvider: sermonSettings?.transcriptionProvider,
            whisperCppEndpoint: sermonSettings?.whisperCppEndpoint,
        })

        // Configure transcription
        const success = await unifiedTranscriptionService.start({
            provider,
            language,
            continuous: true,
            interimResults: true,
            whisperModel: sermonSettings?.whisperModel || 'base',
            whisperEndpoint: sermonSettings?.whisperEndpoint,
            whisperApiKey: sermonSettings?.whisperApiKey,
            whisperChunkDurationMs: sermonSettings?.whisperChunkDurationMs,
            whisperCppEndpoint: sermonSettings?.whisperCppEndpoint,
            whisperCppChunkDurationMs: sermonSettings?.whisperCppChunkDurationMs,
            elevenLabsApiKey: sermonSettings?.elevenLabsApiKey,
            elevenLabsModelId: sermonSettings?.elevenLabsModelId,
            elevenLabsChunkDurationMs: sermonSettings?.elevenLabsChunkDurationMs,
            onStart: () => {
                setIsListening(true)
                setError(null)
            },
            onEnd: () => {
                setIsListening(false)
            },
            onResult: (text, isFinal) => {
                console.log('[useSermonListener] onResult called:', { text: text.substring(0, 50), isFinal })
                if (isFinal) {
                    setInterimTranscript('')
                    setTranscript((prev) => {
                        const combinedTranscript = `${prev} ${text}`.trim()
                        transcriptBufferRef.current = combinedTranscript
                        console.log('[useSermonListener] Updated transcript:', combinedTranscript.substring(0, 100))
                        processTranscript(combinedTranscript)
                        return combinedTranscript
                    })
                } else {
                    setInterimTranscript(text)
                    const rollingContext = `${transcriptBufferRef.current} ${text}`.trim()
                    processTranscript(rollingContext)
                }
                onTranscriptUpdate?.(text, !isFinal)
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
        sermonSettings?.whisperCppChunkDurationMs,
        sermonSettings?.whisperCppEndpoint,
        sermonSettings?.whisperEndpoint,
        sermonSettings?.whisperModel,
        sermonSettings?.elevenLabsApiKey,
        sermonSettings?.elevenLabsModelId,
        sermonSettings?.elevenLabsChunkDurationMs,
    ])

    /**
     * Stop listening
     */
    const stop = useCallback(() => {
        unifiedTranscriptionService.stop()
        setIsListening(false)
        setInterimTranscript('')
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
        processedVersesRef.current.clear()
        transcriptBufferRef.current = ''
        unifiedTranscriptionService.clearTranscript()
    }, [])

    /**
     * Remove a verse from the detected list
     */
    const removeVerse = useCallback((verse: DetectedVerse) => {
        setDetectedVerses(prev => prev.filter(v => v.reference !== verse.reference))
        processedVersesRef.current.delete(verse.reference)
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

    // Select the best matched verse (highest confidence) when detectedVerses changes
    useEffect(() => {
        if (detectedVerses.length > 0 && !currentVerse) {
            // The list is already sorted by confidence, so the first one is the best match
            const bestVerse = detectedVerses[0]
            setCurrentVerse(bestVerse)

            // Auto-lookup the best verse if enabled
            if (autoLookup) {
                lookupVerse(bestVerse)
            }
        }
    }, [detectedVerses, currentVerse, autoLookup, lookupVerse])

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
