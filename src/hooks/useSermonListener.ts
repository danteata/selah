/**
 * useSermonListener Hook
 * Combines speech recognition with Bible verse detection for real-time sermon listening
 * 
 * Supports both Web Speech API and Whisper.cpp transcription providers
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useEmitter } from './useEmitter'
import { useScripture } from './useScripture'
import { useAppStore } from '../store/appStore'
import { unifiedTranscriptionService } from '../services/sermon-listener'
import type { TranscriptionProvider, TranscriptionStatus } from '../services/sermon-listener'
import {
    detectVerses,
    verseToLabel,
} from '../services/sermon-listener/verseDetection'
import type { DetectedVerse } from '../services/sermon-listener/verseDetection'
import type { Slide, Scripture, BibleVerse } from '../types'

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
}

export type UseSermonListenerReturn = SermonListenerState & SermonListenerActions

/**
 * Hook for listening to sermons and detecting Bible verse references
 */
export function useSermonListener(options: SermonListenerOptions = {}): UseSermonListenerReturn {
    const {
        language = 'en-US',
        autoLookup = true,
        autoDisplay = false,
        minConfidence = 'high',
        provider: providerOverride,
        onVerseDetected,
        onTranscriptUpdate,
        onError,
    } = options

    const emitter = useEmitter()
    const { fetchScripture } = useScripture()
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const sermonSettings = useAppStore((state) => state.settings.sermonListener)

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

    // Refs for callback stability
    const optionsRef = useRef(options)
    optionsRef.current = options

    // Track processed verses to avoid duplicates
    const processedVersesRef = useRef<Set<string>>(new Set())

    // Check support on mount
    useEffect(() => {
        const checkSupport = async () => {
            const available = await unifiedTranscriptionService.isProviderAvailable(provider)
            setIsSupported(available)
        }
        checkSupport()
    }, [provider])

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

        // Create a slide from the scripture
        const slide: Slide = {
            id: `sermon-verse-${Date.now()}`,
            index: 0,
            name: currentScripture.label,
            type: 'bible',
            layout: 'default',
            userId: '',
            churchId: '',
            scheduleId: '',
            contents: Array.isArray(currentScripture.content)
                ? currentScripture.content.map((v: BibleVerse) => v.scripture || '')
                : [],
            background: '',
            backgroundType: 'color',
        }

        // Emit event to display on live view
        emitter.emit('new-bible', slide)
    }, [currentScripture, emitter])

    /**
     * Process transcript for verse detection
     */
    const processTranscript = useCallback((text: string, _isFinal: boolean) => {
        if (!text) return

        // Detect verses in the transcript
        const verses = detectVerses(text)

        // Filter by confidence and check for new verses
        const confidenceOrder = { high: 3, medium: 2, low: 1 }
        const minConfidenceLevel = confidenceOrder[minConfidence]

        for (const verse of verses) {
            const verseConfidence = confidenceOrder[verse.confidence]
            if (verseConfidence < minConfidenceLevel) continue

            // Check if already processed
            const verseKey = verse.reference
            if (processedVersesRef.current.has(verseKey)) continue

            // Mark as processed
            processedVersesRef.current.add(verseKey)

            // Add to detected verses
            setDetectedVerses(prev => {
                // Avoid duplicates in state
                if (prev.some(v => v.reference === verse.reference)) return prev
                return [...prev, verse]
            })

            // Set as current verse
            setCurrentVerse(verse)

            // Auto-lookup if enabled
            if (autoLookup) {
                lookupVerse(verse).then(scripture => {
                    optionsRef.current.onVerseDetected?.(verse, scripture)

                    // Auto-display if enabled
                    if (autoDisplay && scripture) {
                        const slide: Slide = {
                            id: `sermon-verse-${Date.now()}`,
                            index: 0,
                            name: scripture.label,
                            type: 'bible',
                            layout: 'default',
                            userId: '',
                            churchId: '',
                            scheduleId: '',
                            contents: Array.isArray(scripture.content)
                                ? scripture.content.map((v: BibleVerse) => v.scripture || '')
                                : [],
                            background: '',
                            backgroundType: 'color',
                        }
                        emitter.emit('new-bible', slide)
                    }
                })
            } else {
                optionsRef.current.onVerseDetected?.(verse, null)
            }
        }
    }, [minConfidence, autoLookup, autoDisplay, lookupVerse, emitter])

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
    }, [isListening, language, sermonSettings?.whisperModel])

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

        // Configure transcription
        const success = await unifiedTranscriptionService.start({
            provider,
            language,
            continuous: true,
            interimResults: true,
            onStart: () => {
                setIsListening(true)
                setError(null)
            },
            onEnd: () => {
                setIsListening(false)
            },
            onResult: (text, isFinal) => {
                if (isFinal) {
                    setTranscript(prev => prev + ' ' + text)
                    processTranscript(text, true)
                } else {
                    setInterimTranscript(text)
                }
                onTranscriptUpdate?.(text, !isFinal)
            },
            onError: (err) => {
                setError(err)
                setIsListening(false)
                onError?.(err)
            },
            onStatusChange: (status: TranscriptionStatus) => {
                setIsListening(status.isListening)
            },
        })

        return success
    }, [isSupported, isListening, provider, language, processTranscript, onTranscriptUpdate, onError])

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
        unifiedTranscriptionService.clearTranscript()
    }, [])

    /**
     * Remove a verse from the detected list
     */
    const removeVerse = useCallback((verse: DetectedVerse) => {
        setDetectedVerses(prev => prev.filter(v => v.reference !== verse.reference))
        processedVersesRef.current.delete(verse.reference)
    }, [])

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
        // Actions
        start,
        stop,
        reset,
        lookupVerse,
        displayCurrentVerse,
        removeVerse,
        setProvider: setTranscriptionProvider,
    }
}

export default useSermonListener