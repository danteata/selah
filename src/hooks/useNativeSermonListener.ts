/**
 * useNativeSermonListener Hook
 *
 * A desktop-optimized version of the sermon listener that uses:
 * - Native audio capture (via Tauri) for lower latency
 * - System audio loopback support (capture what's playing through speakers)
 * - Local Whisper server for transcription
 *
 * Falls back to web-based capture when not in desktop app.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useScripture } from './useScripture'
import { useSlideCreation } from './useSlideCreation'
import { useAppStore } from '../store/appStore'
import {
    isTauriAvailable,
    isSystemAudioSupported,
    useNativeAudioCapture,
    type CaptureType,
    type AudioChunk,
} from '../services/sermon-listener/nativeAudioCapture'
import { fasterWhisperTranscriptionService } from '../services/sermon-listener'
import {
    detectVerses,
    verseToLabel,
} from '../services/sermon-listener'
import type { DetectedVerse } from '../services/sermon-listener'
import type { Scripture } from '../types'

export interface NativeSermonListenerOptions {
    /** Type of audio capture */
    captureType?: CaptureType
    /** Language for transcription */
    language?: string
    /** Whether to automatically look up detected verses */
    autoLookup?: boolean
    /** Whether to automatically display verses on live view */
    autoDisplay?: boolean
    /** Callback when a verse is detected */
    onVerseDetected?: (verse: DetectedVerse, scripture: Scripture | null) => void
    /** Callback when transcription updates */
    onTranscriptUpdate?: (transcript: string) => void
    /** Callback on error */
    onError?: (error: string) => void
}

export interface NativeSermonListenerState {
    /** Whether the listener is active */
    isListening: boolean
    /** Whether native capture is supported */
    isNativeSupported: boolean
    /** Whether system audio capture is supported */
    isSystemAudioSupported: boolean
    /** Current capture type */
    captureType: CaptureType
    /** Current full transcript */
    transcript: string
    /** List of detected verses */
    detectedVerses: DetectedVerse[]
    /** Currently focused verse */
    currentVerse: DetectedVerse | null
    /** Scripture content for current verse */
    currentScripture: Scripture | null
    /** Any error that occurred */
    error: string | null
    /** Whether a verse lookup is in progress */
    isLoading: boolean
    /** Whether speech is currently being detected */
    isSpeechDetected: boolean
    /** Capture status */
    status: 'idle' | 'starting' | 'capturing' | 'stopping' | 'error'
}

export interface NativeSermonListenerActions {
    /** Start listening */
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
    /** Set capture type */
    setCaptureType: (type: CaptureType) => void
}

export type UseNativeSermonListenerReturn = NativeSermonListenerState & NativeSermonListenerActions

/**
 * Hook for native sermon listening with system audio support
 */
export function useNativeSermonListener(
    options: NativeSermonListenerOptions = {}
): UseNativeSermonListenerReturn {
    const {
        captureType: initialCaptureType = 'microphone',
        language = 'en',
        autoLookup = true,
        autoDisplay = false,
        onVerseDetected,
        onTranscriptUpdate,
        onError,
    } = options

    const { fetchScripture } = useScripture()
    const { createBibleSlide } = useSlideCreation()
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)

    // Native audio capture
    const {
        isCapturing,
        status,
        error: captureError,
        isSupported: isNativeSupported,
        systemAudioSupported: isSystemAudioSupported,
        start: startCapture,
        stop: stopCapture,
        getWavChunk,
        flushWav,
    } = useNativeAudioCapture()

    // State
    const [captureType, setCaptureType] = useState<CaptureType>(initialCaptureType)
    const [transcript, setTranscript] = useState('')
    const [detectedVerses, setDetectedVerses] = useState<DetectedVerse[]>([])
    const [currentVerse, setCurrentVerse] = useState<DetectedVerse | null>(null)
    const [currentScripture, setCurrentScripture] = useState<Scripture | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [isSpeechDetected, setIsSpeechDetected] = useState(false)

    // Refs
    const transcriptBufferRef = useRef('')
    const detectedRefsRef = useRef<Set<string>>(new Set())
    const isProcessingRef = useRef(false)

    /**
     * Process transcription result
     */
    const processTranscription = useCallback(async (text: string) => {
        if (!text || text.trim().length === 0) return

        // Add to transcript
        const newTranscript = transcriptBufferRef.current
            ? `${transcriptBufferRef.current} ${text}`
            : text

        transcriptBufferRef.current = newTranscript
        setTranscript(newTranscript)
        onTranscriptUpdate?.(newTranscript)

        // Detect verses
        const verses = detectVerses(text)

        for (const verse of verses) {
            const refKey = verseToLabel(verse)

            // Skip duplicates
            if (detectedRefsRef.current.has(refKey)) continue
            detectedRefsRef.current.add(refKey)

            // Mark as best match if high confidence
            verse.isBestMatch = verse.confidence === 'high'

            // Add to detected verses
            setDetectedVerses(prev => [...prev, verse])
            setCurrentVerse(verse)

            // Auto-lookup
            if (autoLookup) {
                setIsLoading(true)
                try {
                    // Format: book:chapter:verseStart-verseEnd
                    const label = verse.verseEnd
                        ? `${verse.book}:${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`
                        : `${verse.book}:${verse.chapter}:${verse.verseStart}`

                    const scripture = await fetchScripture(label, defaultBibleVersion)

                    if (scripture) {
                        setCurrentScripture(scripture)
                        onVerseDetected?.(verse, scripture)

                        // Auto-display
                        if (autoDisplay) {
                            const slide = await createBibleSlide(scripture)
                            if (slide) {
                                setLiveSlide(slide.id)
                            }
                        }
                    }
                } catch (err) {
                    console.error('[NativeSermonListener] Verse lookup error:', err)
                } finally {
                    setIsLoading(false)
                }
            }
        }
    }, [autoLookup, autoDisplay, defaultBibleVersion, fetchScripture, createBibleSlide, setLiveSlide, onVerseDetected, onTranscriptUpdate])

    /**
     * Process audio chunk for transcription
     */
    const processAudioChunk = useCallback(async () => {
        if (isProcessingRef.current) return
        isProcessingRef.current = true

        try {
            // Get WAV data
            const wavBase64 = await getWavChunk()
            if (!wavBase64) {
                isProcessingRef.current = false
                return
            }

            // Convert base64 to blob
            const binaryString = atob(wavBase64)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }
            const wavBlob = new Blob([bytes], { type: 'audio/wav' })

            // Send to transcription service
            setIsSpeechDetected(true)
            const result = await fasterWhisperTranscriptionService.transcribeAudio(wavBlob)
            setIsSpeechDetected(false)

            if (result?.text) {
                await processTranscription(result.text)
            }
        } catch (err) {
            console.error('[NativeSermonListener] Transcription error:', err)
            setError(String(err))
            onError?.(String(err))
        } finally {
            isProcessingRef.current = false
        }
    }, [getWavChunk, processTranscription, onError])

    /**
     * Start listening
     */
    const start = useCallback(async (): Promise<boolean> => {
        setError(null)
        setTranscript('')
        setDetectedVerses([])
        setCurrentVerse(null)
        setCurrentScripture(null)
        transcriptBufferRef.current = ''
        detectedRefsRef.current.clear()

        // Start native capture
        const success = await startCapture({
            captureType,
            chunkDurationMs: 3000,
            onChunk: async (chunk) => {
                // Process chunk when it arrives
                if (chunk.samples.length > 0) {
                    await processAudioChunk()
                }
            },
        })

        if (!success) {
            setError('Failed to start audio capture')
            onError?.('Failed to start audio capture')
            return false
        }

        return true
    }, [captureType, startCapture, processAudioChunk, onError])

    /**
     * Stop listening
     */
    const stop = useCallback(async () => {
        // Process any remaining audio
        try {
            const wavBase64 = await flushWav()
            if (wavBase64) {
                const binaryString = atob(wavBase64)
                const bytes = new Uint8Array(binaryString.length)
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i)
                }
                const wavBlob = new Blob([bytes], { type: 'audio/wav' })
                const result = await fasterWhisperTranscriptionService.transcribeAudio(wavBlob)
                if (result?.text) {
                    await processTranscription(result.text)
                }
            }
        } catch (err) {
            console.error('[NativeSermonListener] Final transcription error:', err)
        }

        await stopCapture()
    }, [flushWav, stopCapture, processTranscription])

    /**
     * Reset state
     */
    const reset = useCallback(() => {
        setTranscript('')
        setDetectedVerses([])
        setCurrentVerse(null)
        setCurrentScripture(null)
        setError(null)
        transcriptBufferRef.current = ''
        detectedRefsRef.current.clear()
    }, [])

    /**
     * Look up a verse
     */
    const lookupVerse = useCallback(async (verse: DetectedVerse): Promise<Scripture | null> => {
        setIsLoading(true)
        try {
            // Format: book:chapter:verseStart-verseEnd
            const label = verse.verseEnd
                ? `${verse.book}:${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`
                : `${verse.book}:${verse.chapter}:${verse.verseStart}`

            const scripture = await fetchScripture(label, defaultBibleVersion)
            if (scripture) {
                setCurrentScripture(scripture)
            }
            return scripture
        } finally {
            setIsLoading(false)
        }
    }, [fetchScripture, defaultBibleVersion])

    /**
     * Display current verse
     */
    const displayCurrentVerse = useCallback(async () => {
        if (!currentVerse || !currentScripture) return

        const slide = await createBibleSlide(currentScripture)
        if (slide) {
            setLiveSlide(slide.id)
        }
    }, [currentVerse, currentScripture, createBibleSlide, setLiveSlide])

    /**
     * Remove a verse
     */
    const removeVerse = useCallback((verse: DetectedVerse) => {
        setDetectedVerses(prev => prev.filter(v => v.reference !== verse.reference))
        if (currentVerse?.reference === verse.reference) {
            setCurrentVerse(null)
            setCurrentScripture(null)
        }
    }, [currentVerse])

    // Update error from capture
    useEffect(() => {
        if (captureError) {
            setError(captureError)
            onError?.(captureError)
        }
    }, [captureError, onError])

    return {
        // State
        isListening: isCapturing,
        isNativeSupported,
        isSystemAudioSupported,
        captureType,
        transcript,
        detectedVerses,
        currentVerse,
        currentScripture,
        error,
        isLoading,
        isSpeechDetected,
        status,
        // Actions
        start,
        stop,
        reset,
        lookupVerse,
        displayCurrentVerse,
        removeVerse,
        setCaptureType,
    }
}
