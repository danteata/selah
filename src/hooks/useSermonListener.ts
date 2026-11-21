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

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { useEntitlements } from '../providers/LicenseProvider'
import { useAnalytics } from './useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'
import { isDesktop } from '../platform'
import { useScripture } from './useScripture'
import { useSlideCreation, firstVerseOnly } from './useSlideCreation'
import { useAppStore } from '../store/appStore'
import { useGlobalSermonListenerSettings } from './useGlobalAppSettings'
import { unifiedTranscriptionService } from '../services/sermon-listener'
import { onCaptureStreamError } from '../services/sermon-listener/nativeAudioCapture'
import { saveSelectedDeviceLabel } from './useAudioDevices'
import { audioFeatures, bandsForSampleRate } from '../services/visualizer/audioFeatures'
import { startNativeAudioFeatures } from '../services/visualizer/nativeAudioFeatures'
import type { TranscriptionProvider, TranscriptionStatus } from '../services/sermon-listener'
import {
    verseToLabel,
    getSemanticDetector,
    initializeEmbedder,
    NUMBER_TO_BOOK,
} from '../services/sermon-listener'
import type { VoiceCommand } from '../services/sermon-listener/voiceCommandDetection'
import type { DetectedVerse } from '../services/sermon-listener'
import { findQueuedBibleSlide } from '../lib/findQueuedBibleSlide'
import type { Scripture, BibleVersion, Slide } from '../types'
import type { TranscriptSegment } from '../types/sermon-listener'
import { isDuplicateUtterance } from '../services/sermon-listener/transcriptDedup'
import { isCongregationSinging } from '../services/sermon-listener/worshipMode'
import { buildBibleInitialPrompt } from '../services/sermon-listener/bibleInitialPrompt'
import { audioFeedbackService } from '../services/sermon-listener/audioFeedback'
import {
    createScriptureFollower,
    type FollowerDecision,
    type ScriptureFollower,
} from '../services/sermon-listener/scriptureFollower'
import { extractVersesWithLLM } from '../services/sermon-listener/llmVerseExtraction'
import { isLlmConfigured } from '../services/sermon-listener/llmClient'
import { startKeepAwake, stopKeepAwake, setupVisibilityKeepAwake } from '../services/sermon-listener/keepAwake'
import { audioLevel } from '../services/sermon-listener/audioLevel'
import {
    getLiveSermonState,
    saveLiveSermonState,
    clearLiveSermonState,
    getSavedSermonTranscripts,
    saveSermonTranscript,
    deleteSavedSermonTranscript as deleteSavedTranscriptFromIDB,
    clearSavedSermonTranscripts as clearSavedTranscriptsInIDB,
    migrateLegacySermonStorage,
    setSermonRecordingTranscript,
} from './useIndexedDB'
import {
    startRecording as startSermonRecording,
    stopRecording as stopSermonRecording,
} from '../services/sermon-listener/sessionRecordings'

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
    /** Callback when transcription updates */
    onTranscriptUpdate?: (transcript: string, isInterim: boolean) => void
    /** Callback on error */
    onError?: (error: string) => void
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
    /** Active Bible version for lookups (tracks voice command changes) */
    activeBibleVersion: string
    /** Last detected voice command */
    lastVoiceCommand: VoiceCommand | null
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
    /** Manually set one detected verse as current */
    setCurrentDetectedVerse: (verse: DetectedVerse) => Promise<void>
    /** Open the OS Screen & System Audio Recording settings page (macOS desktop) */
    openScreenCaptureSettings: () => Promise<void>
}

export type UseSermonListenerReturn = SermonListenerState & SermonListenerActions

/** Free-plan cap on a single sermon session. Pro/trial is unlimited. */
const FREE_SERMON_LIMIT_MS = 40 * 60 * 1000

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
    const { isPro, startProCheckout } = useEntitlements()
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const bibleVersions = useAppStore((state) => state.bibleVersions)
    const sermonSettings = useAppStore((state) => state.settings.sermonListener)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
    const updateActiveSlide = useAppStore((state) => state.updateActiveSlide)

    // Get global settings (system-wide, no churchId needed)
    const { settings: globalSettings } = useGlobalSermonListenerSettings()

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

    // Speech detection state (for visual feedback)
    const [isSpeechDetected, setIsSpeechDetected] = useState(false)

    // Real-time audio level (0-1) for waveform visualization
    const [captureSource, setCaptureSource] = useState<'microphone' | 'system' | null>(null)
    const audioAnalyserRef = useRef<AnalyserNode | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const audioStreamRef = useRef<MediaStream | null>(null)
    const audioLevelRafRef = useRef<number | null>(null)
    // Cleanup for the desktop native audio-features subscription (visualizer + meter).
    const nativeFeaturesUnlistenRef = useRef<(() => void) | null>(null)

    const currentScriptureRef = useRef<Scripture | null>(null)
    const providerReadyRef = useRef(false)
    const [rawUtterances, setRawUtterances] = useState<Array<{ text: string; timestamp: number; confidence?: number }>>([])

    // Debounce timestamp for SERMON_LISTENER_TRANSCRIPTION — fires at most
    // once every 5s while the listener is active.
    const lastTranscriptEventRef = useRef<number>(0)

    // Refs for callback stability
    const optionsRef = useRef(options)
    optionsRef.current = options

    // Track transcript buffer for context
    const transcriptBufferRef = useRef('')

    /**
     * Append a finalized utterance to the transcript buffer and return the new
     * full transcript. Callers assign the result to transcriptBufferRef
     * themselves, synchronously, so the very next line can act on the text that
     * just arrived — see the note at the call sites.
     */
    const appendToTranscriptBuffer = useCallback((chunk: string): string => {
        const trimmed = chunk.trim()
        if (!trimmed) return transcriptBufferRef.current
        return `${transcriptBufferRef.current} ${trimmed}`.trim()
    }, [])

    // Session-relative timer for segment timestamps
    const sessionStartTimeRef = useRef<number>(0)
    const chunkStartTimeRef = useRef<number>(0)

    // Track recent chunks for deduplication
    const recentChunksRef = useRef<string[]>([])
    const MAX_RECENT_CHUNKS = 5

    // Debounce timer for interim transcript processing
    const interimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // `stop` reads this rather than the state: its identity only changes with
    // `provider`, so the captured value was the mount-time `false` forever —
    // the stop chime never played and the stop was never recorded.
    const isListeningRef = useRef(false)
    const analyserGenerationRef = useRef(0)
    const INTERIM_DEBOUNCE_MS = 300

    // The verse on the live bible slide, for relative navigation ("next verse")
    // when nothing has been heard yet
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
                const bookName = NUMBER_TO_BOOK[parseInt(first.book, 10)]
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

    // Refs for start/stop, which are defined after the code that calls them
    const startRef = useRef<() => Promise<boolean>>(async () => false)
    const stopRef = useRef<() => void>(() => {})
    // Stops capture without ending the listening session — the watchdog's
    // restart. `stop` ends the session too (see finishSessionRecording).
    const stopCaptureRef = useRef<() => void>(() => {})
    // The archive recording for this listening session, if the church keeps
    // one. Owned here rather than by the panel so that every way a session
    // ends — the panel, the tray, "stop listening", the free-plan cap — ends
    // the recording with it; the panel was only one of those.
    const recordingSessionIdRef = useRef<string | null>(null)
    // Synchronous mutex for `start()`. `isListening`/`isStarting` are React state
    // and don't commit until after several `await`s inside `start()` (provider
    // check, semantic detector warm-up, AudioContext unlock), so a second call
    // (button click, tray toggle, voice command, watchdog auto-restart — all can
    // fire concurrently) would otherwise race past those checks and reach the
    // native layer twice, surfacing as an "Already capturing" error.
    const startInFlightRef = useRef(false)
    // Each look-up takes a ticket; only the newest may change what's shown.
    const verseLookupRequestIdRef = useRef(0)
    const activeLookupCountRef = useRef(0)
    // Real-time audio level analysis via Web Audio API AnalyserNode
    // Reuses the transcription service's media stream to avoid duplicate getUserMedia calls.
    // If the primary stream isn't ready yet (VAD still initializing), retries for up to 3s
    // before falling back to opening a separate stream.
    const startAudioAnalyser = useCallback(async (generation: number) => {
        // Each run checks after every await that it is still the current one
        // and releases what it acquired if not. Without that, a mic change or a
        // fallback mid-session started a second run on top of the first, whose
        // AudioContext, stream (mic light still on) and native listener were
        // orphaned — as was anything acquired by a run a Stop overtook.
        const isStale = () => analyserGenerationRef.current !== generation
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
                const unlisten = await startNativeAudioFeatures((rms) => audioLevel.set(rms))
                if (isStale()) {
                    unlisten()
                    return
                }
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
                    if (isStale()) return
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
                } catch (err) {
                    if (err instanceof OverconstrainedError && sermonSettings?.selectedMicrophoneId) {
                        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                    } else {
                        console.warn('[useSermonListener] Could not acquire audio stream for analyser')
                        return
                    }
                }
                if (isStale()) {
                    stream.getTracks().forEach(t => t.stop())
                    return
                }
                audioStreamRef.current = stream
            }

            setCaptureSource(userCaptureSource)
            const ctx = new AudioContext()
            if (ctx.state === 'suspended') {
                await ctx.resume()
            }
            if (isStale()) {
                ctx.close().catch(() => {})
                return
            }
            audioContextRef.current = ctx
            const source = ctx.createMediaStreamSource(stream)
            const analyser = ctx.createAnalyser()
            analyser.fftSize = 256
            analyser.smoothingTimeConstant = 0.8
            source.connect(analyser)
            audioAnalyserRef.current = analyser

            // A SECOND analyser off the same source node for the visualizer.
            // Not a second audio stream — an AnalyserNode is a pass-through tap,
            // so this costs one more FFT per frame and nothing else.
            //
            // It exists because the two consumers want opposite things from the
            // same signal. The level meter above wants a heavily smoothed
            // reading (`smoothingTimeConstant = 0.8` blends 80% of the previous
            // frame) so the bar doesn't jitter. That same smoothing is a strong
            // low-pass on the *time* axis: it flattens and delays exactly the
            // transients the beat detector looks for, which is why the pulse
            // used to arrive late and mushy. The visualizer's tap therefore
            // takes the frequency data raw (`0`), with a longer FFT for enough
            // resolution to actually separate the sub-200 Hz kick region from
            // the mids at a 48 kHz sample rate.
            const visAnalyser = ctx.createAnalyser()
            visAnalyser.fftSize = 1024
            visAnalyser.smoothingTimeConstant = 0
            source.connect(visAnalyser)

            // Band edges derived from the real sample rate rather than as
            // fractions of the bin count — see `bandsForSampleRate`.
            const visBands = bandsForSampleRate(ctx.sampleRate)
            // Analyser latency is roughly half the FFT window plus a frame of
            // rAF; small, but reported so the beat pulse is compensated the
            // same way the desktop path is.
            audioFeatures.setPipelineLatency(
                (visAnalyser.fftSize / 2 / ctx.sampleRate) * 1000 + 16,
            )

            const dataArray = new Uint8Array(analyser.frequencyBinCount)
            const visArray = new Uint8Array(visAnalyser.frequencyBinCount)

            const poll = () => {
                if (isStale() || !audioAnalyserRef.current) return
                analyser.getByteFrequencyData(dataArray)
                const sum = dataArray.reduce((a, b) => a + b, 0)
                const avg = sum / dataArray.length
                const level = Math.min(avg / 128, 1)
                audioLevel.set(level)
                // Feed the audio-reactive visualizer from the unsmoothed tap on
                // the same stream, so we don't open a second audio stream
                // (Phase 4) but also don't inherit the meter's smoothing.
                visAnalyser.getByteFrequencyData(visArray)
                audioFeatures.publish(visArray, visBands)
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
        audioLevel.set(0)
        setCaptureSource(null)
    }, [])

    useEffect(() => {
        if (!isListening) {
            stopAudioAnalyser()
            return
        }
        const generation = ++analyserGenerationRef.current
        void startAudioAnalyser(generation)
        return () => {
            // Retire this run before the next one (or a Stop) takes over.
            // eslint-disable-next-line react-hooks/exhaustive-deps -- a generation counter, not a DOM ref: bumping the latest value is the point
            analyserGenerationRef.current++
            stopAudioAnalyser()
        }
    }, [isListening, startAudioAnalyser, stopAudioAnalyser])

    /**
     * Surface native capture-stream failures while listening.
     *
     * Nothing else can: the VAD thread keeps its `audio-features` heartbeat
     * running through delivery gaps on purpose, so a microphone that dropped
     * mid-service reads downstream as a room that simply went quiet. Rust
     * rebuilds the stream itself with backoff — these events are what tell the
     * operator it is happening, and when it has given up.
     */
    useEffect(() => {
        if (!isListening || !isDesktop()) return

        let unlisten: (() => void) | null = null
        let cancelled = false

        onCaptureStreamError((event) => {
            if (event.fell_back_from) {
                // Capture is already running on the default device. Forget the
                // stored choice so Settings stops naming a microphone that is
                // not the one recording — an operator checking mid-service
                // should not be told the desk feed is live when it is the
                // laptop's built-in mic.
                setError(null)
                const store = useAppStore.getState()
                const sermon = store.settings.sermonListener
                if (sermon?.selectedMicrophoneId) {
                    store.setAppSettings({
                        ...store.settings,
                        sermonListener: {
                            ...sermon,
                            selectedMicrophoneId: undefined,
                            // The channel described the old interface, not this one.
                            inputChannel: undefined,
                        },
                    })
                }
                saveSelectedDeviceLabel(null)
                toast.warning(`${event.fell_back_from} is unavailable`, {
                    description: 'Recording from the default microphone instead.',
                    duration: 10000,
                })
                return
            }
            if (event.recovered) {
                setError(null)
                toast.success('Microphone reconnected')
                return
            }
            if (event.fatal) {
                setError(`Microphone disconnected and could not be reopened: ${event.message}`)
                return
            }
            // Retryable: classifyTranscriptionError maps "input stream" to
            // CAPTURE_STREAM_LOST, which renders as the amber auto-retry banner.
            setError(`Lost the input stream (attempt ${event.attempt}): ${event.message}`)
        }).then((fn) => {
            if (cancelled) fn()
            else unlisten = fn
        })

        return () => {
            cancelled = true
            unlisten?.()
        }
    }, [isListening])

    /**
     * Check if text is a duplicate or near-duplicate of recent chunks.
     * Returns true if the text should be skipped. See transcriptDedup.ts for
     * why worship mode narrows the comparison window.
     */
    const isDuplicateText = useCallback((newText: string): boolean => {
        return isDuplicateUtterance(newText, recentChunksRef.current, {
            worshipMode: useAppStore.getState().songTracking.autoDetect,
        })
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

    // The scripture follower decides which verse the preacher is on; this hook
    // carries its decisions out (see `decide` below). One per listening
    // session: reset() replaces it, so nothing it remembered carries over.
    const followerSettingsRef = useRef({ minConfidence, autoLookup, autoDisplay, enableVoiceCommands, language })
    followerSettingsRef.current = { minConfidence, autoLookup, autoDisplay, enableVoiceCommands, language }
    const decideRef = useRef<(decision: FollowerDecision) => void>(() => {})
    const resolveVersionRef = useRef<(requested: string) => string | null>(() => null)
    const createFollower = useCallback((): ScriptureFollower => createScriptureFollower({
        settings: () => followerSettingsRef.current,
        world: {
            isSinging: () => isCongregationSinging(useAppStore.getState().songTracking),
            liveVerse: () => getCurrentVerseFromLiveSlide(),
            resolveVersion: (requested) => resolveVersionRef.current(requested),
        },
        semantic: () => semanticDetectorRef.current,
        llm: {
            isConfigured: () => isLlmConfigured(useAppStore.getState().settings.llm),
            extract: (text, alreadyDetected, signal) =>
                extractVersesWithLLM(text, useAppStore.getState().settings.llm, alreadyDetected, signal),
        },
        decide: (decision) => decideRef.current(decision),
        initialBibleVersion: useAppStore.getState().settings.defaultBibleVersion,
    }), [getCurrentVerseFromLiveSlide])
    const followerRef = useRef<ScriptureFollower | null>(null)
    if (!followerRef.current) followerRef.current = createFollower()
    const [follower, setFollower] = useState<ScriptureFollower>(followerRef.current)
    const {
        heardVerses: detectedVerses,
        currentVerse,
        activeBibleVersion,
        lastVoiceCommand,
        semanticSearching: isSemanticSearching,
    } = useSyncExternalStore(follower.subscribe, follower.getSnapshot)
    // On unmount, drop a pending LLM pass so it can't put a slide up for a
    // listener that's gone. Not dispose(): StrictMode remounts this same hook,
    // and the follower has to survive that.
    useEffect(() => () => followerRef.current?.cancelPending(), [])

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
                    followerRef.current?.restore({
                        ...(Array.isArray(live.detectedVerses) ? { heardVerses: live.detectedVerses as DetectedVerse[] } : {}),
                        ...(live.currentVerse ? { currentVerse: live.currentVerse as DetectedVerse } : {}),
                        ...(typeof live.activeBibleVersion === 'string' && live.activeBibleVersion
                            ? { activeBibleVersion: live.activeBibleVersion }
                            : {}),
                    })
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
        currentScriptureRef.current = currentScripture
    }, [currentScripture])

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
    // This avoids blocking the UI on mount with embedder loading.
    const initSemanticDetector = useCallback(async () => {
        if (!enableSemanticDetection) return

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

        const result = await detector.initialize()

        if (result.ready) {
            semanticDetectorRef.current = detector
            setSemanticDetectorReady(true)
            console.log('[SemanticDetector] Initialized successfully')
        } else {
            console.warn('[SemanticDetector] Initialization failed:', result.error)
        }
    }, [enableSemanticDetection, defaultBibleVersion, bibleVersions])

    /**
     * Fetch a verse's text and make it the current scripture.
     *
     * Each look-up takes a ticket, and one that finishes after a newer one has
     * started changes nothing — so a slow fetch for an earlier verse can't
     * replace the verse now on screen.
     */
    const lookUp = useCallback(async (
        verse: DetectedVerse,
        versionOverride?: string,
    ): Promise<{ status: 'found'; scripture: Scripture } | { status: 'missing' | 'superseded' }> => {
        const label = verseToLabel(verse)
        if (!label) {
            console.warn('Could not convert verse to label:', verse)
            return { status: 'missing' }
        }
        const version = versionOverride || followerRef.current?.getSnapshot().activeBibleVersion || defaultBibleVersion
        const ticket = ++verseLookupRequestIdRef.current
        ++activeLookupCountRef.current

        setIsLoading(true)
        try {
            const scripture = await fetchScripture(label, version)
            if (ticket !== verseLookupRequestIdRef.current) return { status: 'superseded' }
            if (!scripture) return { status: 'missing' }
            setCurrentScripture(scripture)
            return { status: 'found', scripture }
        } catch (err) {
            console.error('Failed to look up verse:', err)
            return { status: 'missing' }
        } finally {
            if (--activeLookupCountRef.current === 0) {
                setIsLoading(false)
            }
        }
    }, [fetchScripture, defaultBibleVersion])

    /**
     * Put a scripture on the live output, reusing the slide already queued for
     * that reference instead of appending a second one. Every detection path
     * goes through here, so a passage mentioned three times occupies one queue
     * entry — see findQueuedBibleSlide for why the queue duplicated where the
     * detected list didn't.
     *
     * The queued copy is refreshed in place when its text is out of date — a
     * different version, or a narrower span of the passage now being read. Its
     * background and typography survive the refresh — the operator may have
     * styled that slide.
     */
    const projectScriptureSlide = useCallback((scripture: Scripture, supersedesLabel?: string | null): string => {
        const state = useAppStore.getState()
        const match = findQueuedBibleSlide(state.activeSlides, scripture, state.liveOutputSlidesId, supersedesLabel)

        if (!match) {
            // Applies the default bible template and includes the verse reference
            const slide = createAutoDetectBibleSlide(scripture)
            appendActiveSlide(slide)
            setLiveSlide(slide.id)
            return slide.id
        }

        const { slide: queued, needsRefresh } = match
        const versionChanged = (queued.data as Scripture | undefined)?.version !== scripture.version

        if (needsRefresh || versionChanged) {
            const refreshed = createAutoDetectBibleSlide(scripture)
            const updated: Slide = {
                ...queued,
                data: refreshed.data,
                contents: refreshed.contents,
                displayVerseNumbers: refreshed.displayVerseNumbers,
                title: refreshed.title,
                name: refreshed.name,
                slideStyle: {
                    ...queued.slideStyle,
                    fontSize: refreshed.slideStyle?.fontSize,
                    bibleVersion: refreshed.slideStyle?.bibleVersion,
                },
            }
            updateActiveSlide(updated)
            setLiveSlide(queued.id)

            // setLiveSlide is a no-op when this slide is already live, so the
            // live window/multi-monitor needs the update pushed explicitly.
            if (typeof window !== 'undefined' && '__TAURI__' in window) {
                window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updated }))
            }
            return queued.id
        }

        setLiveSlide(queued.id)
        return queued.id
    }, [createAutoDetectBibleSlide, appendActiveSlide, updateActiveSlide, setLiveSlide])

    /**
     * Display the current verse on live view
     */
    const displayCurrentVerse = useCallback(() => {
        if (!currentScripture) return
        projectScriptureSlide(currentScripture)
    }, [currentScripture, projectScriptureSlide])

    const setCurrentDetectedVerse = useCallback(async (verse: DetectedVerse): Promise<void> => {
        followerRef.current?.select(verse)
        await lookUp(verse)
    }, [lookUp])

    const resolveBibleVersionId = useCallback((requested: string): string | null => {
        const normalized = requested.trim().toLowerCase()
        const versions = bibleVersions as BibleVersion[]
        const exact = versions.find(v => v.id.toLowerCase() === normalized || v.name.toLowerCase() === normalized)
        if (exact) return exact.id
        const partial = versions.find(v => v.id.toLowerCase().includes(normalized) || v.name.toLowerCase().includes(normalized))
        return partial?.id || null
    }, [bibleVersions])
    resolveVersionRef.current = resolveBibleVersionId

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
            // No existing bible slide — fall back to queueing one (only for auto-detect, not voice nav)
            projectScriptureSlide(scripture)
        }
        // When skipQueueAppend=true and no existing bible slide, do nothing.
        // The user explicitly wants voice navigation to never spam the queue.
    }, [createAutoDetectBibleSlide, updateActiveSlide, setLiveSlide, projectScriptureSlide])

    /** Carry out what the scripture follower decided. */
    decideRef.current = (decision: FollowerDecision) => {
        switch (decision.type) {
            case 'look-up': {
                const { verse, then, supersedes } = decision
                void lookUp(verse).then((result) => {
                    if (result.status !== 'found') return
                    if (then === 'project') projectScriptureSlide(result.scripture, supersedes)
                    else if (then === 'refresh-live') refreshLiveSlide(result.scripture, true)
                })
                break
            }
            case 'change-version': {
                const { verse, versionId, settle } = decision
                setError(null)
                if (!verse) {
                    settle({ ok: true })
                    break
                }
                if (!verseToLabel(verse)) {
                    setError('Could not resolve current verse label for version switch.')
                    settle({ ok: false })
                    break
                }
                void lookUp(verse, versionId).then((result) => {
                    if (result.status !== 'found') {
                        if (result.status === 'missing') setError(`Could not load ${versionId} for ${verse.reference}.`)
                        settle({ ok: false })
                        return
                    }
                    // Same reference as what's already queued, so this rewrites
                    // that slide's text in the new version rather than queueing
                    // a second copy.
                    projectScriptureSlide(result.scripture)
                    settle({ ok: true, label: result.scripture.label })
                })
                break
            }
            case 'display': {
                const scripture = currentScriptureRef.current
                if (scripture) projectScriptureSlide(scripture)
                break
            }
            case 'stop-listening':
                // The full stop, as the button does — keep-awake released, the
                // archive recording ended, a pending LLM pass dropped.
                stopRef.current()
                break
            case 'start-listening':
                void startRef.current()
                break
            case 'detected':
                trackEvent(AnalyticsEventType.SERMON_LISTENER_VERSE_DETECTED, {
                    reference: decision.verse.reference,
                    confidence: decision.verse.confidence,
                    detection_type: decision.detectionType,
                    verse_count: decision.verseCount,
                })
                break
        }
    }

    /**
     * Hand an utterance to the scripture follower. The transcription callbacks
     * are given to the provider once, at start; this reads only refs, so a
     * setting changed mid-service applies to the next utterance.
     */
    const hear = useCallback((text: string, latestChunk?: string) => {
        followerRef.current?.hear(text, { latestChunk, committed: text === transcriptBufferRef.current.trim() })
    }, [])

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
     * Begin the session's archive recording, when the church turned recording
     * on. A capture restarted mid-session keeps the recording it already has.
     */
    const beginSessionRecording = useCallback(() => {
        if (recordingSessionIdRef.current) return
        if (!useAppStore.getState().settings.sermonListener?.recordSessions) return
        const sessionId = crypto.randomUUID()
        recordingSessionIdRef.current = sessionId
        void startSermonRecording(sessionId).then((path) => {
            if (path) return
            if (recordingSessionIdRef.current === sessionId) recordingSessionIdRef.current = null
            // Recording failed but the service is running anyway. Say so once
            // rather than letting the operator believe there is an archive —
            // finding out weeks later that the sermon was never captured is
            // the failure this feature exists to prevent.
            toast.error('Session recording could not start', {
                description: 'The service will still be transcribed, but no audio is being saved.',
            })
        })
    }, [])

    /**
     * End the session's archive recording and keep the live transcript with
     * it, so the archive shows what was heard and a later re-transcription has
     * something to be judged against.
     */
    const finishSessionRecording = useCallback(() => {
        const sessionId = recordingSessionIdRef.current
        if (!sessionId) return
        recordingSessionIdRef.current = null
        const liveText = transcriptBufferRef.current.trim()
        void stopSermonRecording().then(() => {
            if (!liveText) return
            void setSermonRecordingTranscript(sessionId, liveText).catch((err: unknown) => {
                console.warn('[recordings] could not attach transcript:', err)
            })
        })
    }, [])

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

        if (startInFlightRef.current) {
            console.warn('[useSermonListener] Start already in progress, ignoring duplicate call')
            return false
        }
        startInFlightRef.current = true
        try {

            // System-audio capture on desktop runs through the OS screen-recording
            // permission (macOS: "Screen & System Audio Recording"). That system
            // prompt is shown only ONCE — if the user previously declined or
            // dismissed it, macOS never prompts again and ScreenCaptureKit fails
            // silently. Detect the grant up front: request it (a no-op after a prior
            // decline) and, if still not granted, route the user to Settings instead
            // of spinning up a capture that will die with no signal.
            if (isDesktop() && sermonSettings?.captureSource === 'system') {
                try {
                    const { invoke } = await import('@tauri-apps/api/core')
                    let granted = await invoke<boolean>('check_screen_capture_permission')
                    if (!granted) {
                        granted = await invoke<boolean>('request_screen_capture_permission')
                    }
                    if (!granted) {
                        const msg = 'Selah needs Screen & System Audio Recording permission to capture system audio. Open System Settings → Privacy & Security → Screen & System Audio Recording, enable Selah, then restart the app.'
                        setError(msg)
                        onError?.(msg)
                        trackEvent(AnalyticsEventType.SERMON_LISTENER_ERROR, { reason: 'screen_capture_denied' })
                        return false
                    }
                } catch (err) {
                    // Non-fatal (e.g. web build or IPC hiccup): fall through and let
                    // the capture attempt surface any real error downstream.
                    console.warn('[useSermonListener] Screen capture permission check failed:', err)
                }
            }

            // Lazily initialize the provider when the user starts listening.
            // This avoids blocking the UI for 60s on app startup.
            if (!providerReady && provider !== 'web-speech') {
                setIsInitializingProvider(true)
                try {
                    // Start was pressed before the availability check on mount
                    // landed. Ask the same question it asks rather than wait for
                    // it. (This used to invoke `check_whisper_ready`, a command
                    // that went with the desktop-whisper sidecar, so an early
                    // Start failed silently.)
                    console.log('[useSermonListener] Provider not ready yet, checking:', provider)
                    const available = await unifiedTranscriptionService.isProviderAvailable(provider)
                    if (available) {
                        setProviderReady(true)
                        setError(null)
                    } else {
                        console.log('[useSermonListener] Provider not available yet')
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

            // Initialize semantic detector on first use if not already ready.
            // Once `semanticDetectorReady` is true, the detector singleton's own
            // `initialize()` short-circuits on every future call — so without the
            // else branch below, a worker torn down by embeddingSyncManager's
            // 5-minute idle-unload timer (or from a much earlier session) would
            // otherwise only get reloaded lazily on the first live semantic query
            // mid-sermon, which is exactly the multi-second "sometimes" delay.
            // `initializeEmbedder()` is a cheap idempotent no-op when the worker
            // is already warm, so eagerly re-warming here on every start costs
            // nothing when nothing was disposed.
            if (!semanticDetectorReady) {
                initSemanticDetector().catch(err => {
                    console.warn('[useSermonListener] Semantic detector init failed:', err)
                })
            } else if (enableSemanticDetection) {
                initializeEmbedder().catch(err => {
                    console.warn('[useSermonListener] Embedder re-warm failed:', err)
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
                inputChannel: sermonSettings?.inputChannel,
                continuous: true,
                interimResults: true,
                useVAD: globalSettings?.sermonListener_useVAD,
                // The Bible-biased prompt steers Whisper toward scripture vocabulary,
                // which garbles sung lyrics and surfaces spurious verses. When song
                // auto-detect is on (worship mode), use a neutral prompt so lyrics
                // transcribe cleanly; keep the scripture bias for sermon mode.
                initialPrompt: useAppStore.getState().songTracking.autoDetect ? '' : buildBibleInitialPrompt(),
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
                        hear(transcriptBufferRef.current, cleanedText)
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

                            // The buffer is advanced HERE, not inside the state
                            // updater below. React runs updaters during the
                            // render that follows this callback, so a buffer
                            // written in there is still one utterance behind when
                            // the follower reads it a few lines down — and
                            // empty for the first utterance of a session, which
                            // `if (!text) return` then dropped entirely. That is
                            // why an opening "Psalm 27 verse 1" was never
                            // detected and why every later detection trailed the
                            // speaker by a chunk.
                            transcriptBufferRef.current = appendToTranscriptBuffer(
                                newSegments.map(s => s.text).join(' '),
                            )
                            setTranscript(transcriptBufferRef.current)
                            setTranscriptSegments(prev => [...prev, ...newSegments])
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

                            // Advanced outside the updater — same reason as the
                            // whisper-segment branch above.
                            transcriptBufferRef.current = appendToTranscriptBuffer(segment.text)
                            setTranscript(transcriptBufferRef.current)
                            setTranscriptSegments(prev => [...prev, segment])
                        }

                        const newFullTranscript = `${transcriptBufferRef.current}`.trim()
                        hear(newFullTranscript, cleanedText)
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
                            hear(rollingContext, cleanedText)
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
            if (success) beginSessionRecording()
            return success
        } catch (err) {
            // If anything above throws (e.g. unifiedTranscriptionService.start()
            // rejects rather than resolving false), don't leave the button
            // stuck on "Starting…" forever with no recovery but a manual stop().
            console.error('[useSermonListener] start() failed:', err)
            setIsStarting(false)
            setIsListening(false)
            setError(err instanceof Error ? err.message : String(err))
            return false
        } finally {
            startInFlightRef.current = false
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the global provider setting is kept so `start` is rebuilt when an admin switches provider, as before
    }, [
        isSupported,
        isListening,
        providerReady,
        provider,
        language,
        onError,
        onTranscriptUpdate,
        cleanRepeatedPhrases,
        isDuplicateText,
        stripOverlap,
        appendToTranscriptBuffer,
        sermonSettings?.captureSource,
        sermonSettings?.selectedMicrophoneId,
        sermonSettings?.inputChannel,
        globalSettings?.sermonListener_transcriptionProvider,
        globalSettings?.sermonListener_useVAD,
        semanticDetectorReady,
        initSemanticDetector,
        enableSemanticDetection,
        trackEvent,
        beginSessionRecording,
        hear,
    ])

    // Keep ref in sync so a "start listening" command can call start
    useEffect(() => {
        startRef.current = start
    }, [start])

    /**
     * Stop capture. Ends listening but not the listening session's archive —
     * see `stop`, which does both, and the watchdog, which restarts capture.
     */
    const stopCapture = useCallback(() => {
        followerRef.current?.cancelPending()
        // A pending interim pass would otherwise still run commands and
        // auto-display 300 ms after Stop.
        if (interimDebounceRef.current) {
            clearTimeout(interimDebounceRef.current)
            interimDebounceRef.current = null
        }
        const wasListening = isListeningRef.current
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
                verses_detected: followerRef.current?.getSnapshot().heardVerses.length ?? 0,
                provider,
            })
        }
    }, [provider, trackEvent])

    /**
     * Stop listening, ending the listening session.
     */
    const stop = useCallback(() => {
        stopCapture()
        finishSessionRecording()
    }, [stopCapture, finishSessionRecording])

    // Keep the refs current for the voice command, the free-plan cap and the
    // watchdog (all defined before these callbacks exist).
    useEffect(() => {
        stopRef.current = stop
        stopCaptureRef.current = stopCapture
    }, [stop, stopCapture])

    useEffect(() => {
        isListeningRef.current = isListening
    }, [isListening])

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
            stopCaptureRef.current()
            setTimeout(() => { void startRef.current() }, 400)
        }, 2500)
        return () => clearInterval(timer)
    }, [isListening])

    // Free-tier limit: end a session automatically once it hits 40 minutes, and
    // nudge toward Pro. Pro/trial users are unlimited. We arm the timer off the
    // real session start time so it's correct even if entitlements resolve late.
    useEffect(() => {
        if (!isListening || isPro) return
        const started = sessionStartTimeRef.current || Date.now()
        const remaining = FREE_SERMON_LIMIT_MS - (Date.now() - started)
        const enforce = () => {
            stopRef.current()
            toast.warning('Free plan sessions are capped at 40 minutes', {
                description: 'Upgrade to Selah Pro for unlimited sermon recording.',
                duration: 10000,
                action: {
                    label: 'Upgrade',
                    onClick: () => {
                        void startProCheckout()
                    },
                },
            })
        }
        if (remaining <= 0) {
            enforce()
            return
        }
        const timer = setTimeout(enforce, remaining)
        return () => clearTimeout(timer)
    }, [isListening, isPro, startProCheckout])

    /**
     * Reset state
     */
    const reset = useCallback(() => {
        setTranscript('')
        setTranscriptSegments([])
        setInterimTranscript('')
        setCurrentScripture(null)
        setError(null)
        setIsSpeechDetected(false)
        setIsLoading(false)
        setRawUtterances([])
        transcriptBufferRef.current = ''
        recentChunksRef.current = []
        // A new scripture follower for the new listening session: nothing the
        // last one remembered — what was heard, the reading context, the
        // cooldowns — carries over, and its results still in flight are dropped.
        followerRef.current?.dispose()
        followerRef.current = createFollower()
        setFollower(followerRef.current)
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
    }, [createFollower])

    /**
     * Remove a verse from the detected list
     */
    const removeVerse = useCallback((verse: DetectedVerse) => {
        followerRef.current?.remove(verse.reference)
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

    // Deep-link to the OS Screen & System Audio Recording settings page. This is
    // the only recovery once the one-shot macOS permission prompt was declined —
    // the user enables Selah there and restarts.
    const openScreenCaptureSettings = useCallback(async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core')
            await invoke('open_screen_capture_settings')
        } catch (err) {
            console.warn('[useSermonListener] Failed to open screen capture settings:', err)
        }
    }, [])

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
        captureSource,
        activeBibleVersion,
        lastVoiceCommand,
        rawUtterances,
        // Actions
        start,
        stop,
        reset,
        displayCurrentVerse,
        removeVerse,
        setProvider: setTranscriptionProvider,
        saveCurrentTranscript,
        deleteSavedTranscript,
        clearSavedTranscripts,
        exportCurrentTranscript,
        setCurrentDetectedVerse,
        openScreenCaptureSettings,
    }
}

export default useSermonListener
