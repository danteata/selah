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
import { transcriptionEngines } from '../services/sermon-listener/engines'
import {
    errorFromMessage,
    listeningError,
    type CaptureStatus,
    type EngineEvent,
    type EngineSegment,
    type ListeningError,
} from '../services/sermon-listener/transcriptionEngine'
import { transcriptionErrorCodes } from '../services/sermon-listener/transcriptionErrors'
import { saveSelectedDeviceLabel } from './useAudioDevices'
import { audioFeatures, bandsForSampleRate } from '../services/visualizer/audioFeatures'
import { startNativeAudioFeatures } from '../services/visualizer/nativeAudioFeatures'
import type { TranscriptionProvider } from '../services/sermon-listener'
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
import { TranscriptAssembler } from '../services/sermon-listener/transcriptAssembler'
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
    /** What went wrong, as a kind the panel can act on */
    error: ListeningError | null
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
    const [currentScripture, setCurrentScripture] = useState<Scripture | null>(null)
    const [error, setError] = useState<ListeningError | null>(null)
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

    // Debounce timestamp for SERMON_LISTENER_TRANSCRIPTION — fires at most
    // once every 5s while the listener is active.
    const lastTranscriptEventRef = useRef<number>(0)

    // Refs for callback stability
    const optionsRef = useRef(options)
    optionsRef.current = options

    // When the current listening run began, for its duration and the free-plan cap.
    const sessionStartTimeRef = useRef<number>(0)

    // The transcript of this listening session, assembled from the engine's
    // results. One per listening session, like the follower: reset() replaces it.
    const assemblerRef = useRef<TranscriptAssembler | null>(null)
    if (!assemblerRef.current) assemblerRef.current = new TranscriptAssembler()
    const [assembler, setAssembler] = useState<TranscriptAssembler>(assemblerRef.current)
    const {
        text: transcript,
        segments: transcriptSegments,
        interim: interimTranscript,
        rawUtterances,
    } = useSyncExternalStore(assembler.subscribe, assembler.getSnapshot)

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
            if (userCaptureSource === 'system') {
                setCaptureSource('system')
                console.log('[useSermonListener] System audio active — mic analyser disabled')
                return
            }

            // Neither engine shares its stream (web speech opens its own; the
            // native engine captures in Rust), so the meter opens a lightweight
            // one of its own. It used to wait three seconds for a shared stream
            // that never came.
            let stream: MediaStream | null = null

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
     * Surface what happened to the native capture stream while listening.
     *
     * Nothing else can: the VAD thread keeps its `audio-features` heartbeat
     * running through delivery gaps on purpose, so a microphone that dropped
     * mid-service reads downstream as a room that simply went quiet. Rust
     * rebuilds the stream itself with backoff — these events are what tell the
     * operator it is happening, and when it has given up.
     */
    const handleCaptureStatus = useCallback((capture: CaptureStatus) => {
        switch (capture.status) {
            case 'fell-back': {
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
                toast.warning(`${capture.from} is unavailable`, {
                    description: 'Recording from the default microphone instead.',
                    duration: 10000,
                })
                return
            }
            case 'recovered':
                setError(null)
                toast.success('Microphone reconnected')
                return
            case 'fatal':
                // The supervisor has given up, so this is not retrying — even
                // though its message often says "input stream", which is what
                // used to make the banner promise an automatic retry.
                setError(listeningError(
                    transcriptionErrorCodes.CAPTURE_STREAM_LOST,
                    `Microphone disconnected and could not be reopened: ${capture.message}`,
                    false,
                ))
                return
            case 'lost':
                setError(listeningError(
                    transcriptionErrorCodes.CAPTURE_STREAM_LOST,
                    `Lost the input stream (attempt ${capture.attempt}): ${capture.message}`,
                    true,
                ))
        }
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
                    assemblerRef.current?.restore({
                        text: typeof live.transcript === 'string' ? live.transcript : undefined,
                        segments: Array.isArray(live.segments) ? live.segments as TranscriptSegment[] : undefined,
                    })
                    followerRef.current?.restore({
                        ...(Array.isArray(live.detectedVerses) ? { heardVerses: live.detectedVerses as DetectedVerse[] } : {}),
                        ...(live.currentVerse ? { currentVerse: live.currentVerse as DetectedVerse } : {}),
                        ...(typeof live.activeBibleVersion === 'string' && live.activeBibleVersion
                            ? { activeBibleVersion: live.activeBibleVersion }
                            : {}),
                    })
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
            const available = await transcriptionEngines[targetProvider].isAvailable()
            if (cancelled) return

            // Cross-platform fallback to web-speech if the chosen native provider
            // isn't available. Desktop-whisper only exists in the Tauri app, so
            // the web build always lands here — that's the expected path and we
            // don't surface a "falling back" banner for it. On desktop, only
            // flag the fallback if the sidecar genuinely failed (dev without
            // whisper.cpp running, for example).
            if (!available && targetProvider === 'native') {
                const webSpeechAvailable = await transcriptionEngines['web-speech'].isAvailable()
                if (cancelled) return
                if (webSpeechAvailable) {
                    setProvider('web-speech')
                    setIsSupported(true)
                    setProviderReady(true)
                    if (isDesktop()) {
                        setError(errorFromMessage('Native transcription unavailable. Falling back to Web Speech API.'))
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

            // Neither engine needs a warm-up: web speech is built in, and the
            // native engine loads its model when listening starts.
            setProviderReady(true)
        }

        initialize()

        return () => {
            cancelled = true
        }
    }, [targetProvider])

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
                    setError(errorFromMessage('Could not resolve current verse label for version switch.'))
                    settle({ ok: false })
                    break
                }
                void lookUp(verse, versionId).then((result) => {
                    if (result.status !== 'found') {
                        if (result.status === 'missing') setError(errorFromMessage(`Could not load ${versionId} for ${verse.reference}.`))
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
    const hear = useCallback((text: string, latestChunk: string, committed: boolean) => {
        followerRef.current?.hear(text, { latestChunk, committed })
    }, [])

    /**
     * Set transcription provider
     * Note: This is now primarily controlled by global settings.
     * This function is kept for local fallback/testing purposes.
     */
    const setTranscriptionProvider = useCallback(async (newProvider: TranscriptionProvider): Promise<boolean> => {
        if (isListening) {
            await transcriptionEngines[provider].stop()
        }

        setIsModelLoading(true)
        setModelLoadingProgress(0)

        const success = await transcriptionEngines[newProvider].isAvailable()

        setIsModelLoading(false)

        if (success) {
            setProvider(newProvider)
            setIsSupported(true)
        } else {
            setError(errorFromMessage('Failed to initialize transcription provider'))
        }

        return success
    }, [isListening, provider])

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
        const liveText = (assemblerRef.current?.getSnapshot().text ?? '').trim()
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
            setError(errorFromMessage(errorMsg))
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
                        setError(errorFromMessage(msg))
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
                    const available = await transcriptionEngines[provider].isAvailable()
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

            // The engines are module-level singletons, so one can outlive our
            // React state (e.g. after this provider remounts on navigation).
            // When that happens our state resets to false but the engine is
            // still running, and the button would stay on "Start". Reconcile by
            // stopping the stale capture before starting fresh.
            const engine = transcriptionEngines[provider]
            if (engine.isBusy()) {
                console.warn('[useSermonListener] Reconciling stale listening state before start')
                try {
                    await engine.stop()
                } catch (e) {
                    console.warn('[useSermonListener] Failed to stop stale session:', e)
                }
            }

            const startOptions = {
                language,
                captureSource: sermonSettings?.captureSource,
                microphoneDeviceId: sermonSettings?.selectedMicrophoneId,
                inputChannel: sermonSettings?.inputChannel,
                // The Bible-biased prompt steers Whisper toward scripture vocabulary,
                // which garbles sung lyrics and surfaces spurious verses. When song
                // auto-detect is on (worship mode), use a neutral prompt so lyrics
                // transcribe cleanly; keep the scripture bias for sermon mode.
                initialPrompt: useAppStore.getState().songTracking.autoDetect ? '' : buildBibleInitialPrompt(),
            }
            const onStart = () => {
                    setIsListening(true)
                    setIsStarting(false)
                    setError(null)
                    audioFeedbackService.playStart()
                    sessionStartTimeRef.current = Date.now()
                    assemblerRef.current?.startRun(sessionStartTimeRef.current)
                    trackEvent(AnalyticsEventType.SERMON_LISTENER_STARTED, {
                        provider,
                        language,
                        capture_source: sermonSettings?.captureSource,
                    })
            }
            const onResult = (text: string, isFinal: boolean, segments?: EngineSegment[]) => {
                console.log('[useSermonListener] onResult called:', { text: text.substring(0, 50), isFinal, hasSegments: !!segments?.length })
                const assembled = assemblerRef.current!.take({ text, isFinal, segments }, {
                    now: Date.now(),
                    provider,
                    worshipMode: useAppStore.getState().songTracking.autoDetect,
                })
                const { chunk } = assembled

                if (assembled.kind === 'interim') {
                    // Verse detection waits for the words to settle.
                    if (interimDebounceRef.current) clearTimeout(interimDebounceRef.current)
                    interimDebounceRef.current = setTimeout(() => {
                        hear(assembled.hear, chunk, assembled.committed)
                        interimDebounceRef.current = null
                    }, INTERIM_DEBOUNCE_MS)
                } else {
                    if (assembled.kind === 'duplicate') {
                        console.log('[useSermonListener] Skipping duplicate text:', chunk.substring(0, 50))
                    } else if (interimDebounceRef.current) {
                        // The final supersedes the interim pass still waiting.
                        clearTimeout(interimDebounceRef.current)
                        interimDebounceRef.current = null
                    }
                    // The follower hears the transcript as it now stands, with
                    // the newest utterance — the only place commands are read.
                    hear(assembled.hear, chunk, assembled.committed)
                    if (assembled.kind === 'duplicate') return

                    // Throttled transcript event — final results only.
                    if (lastTranscriptEventRef.current && Date.now() - lastTranscriptEventRef.current > 5000) {
                        trackEvent(AnalyticsEventType.SERMON_LISTENER_TRANSCRIPTION, {
                            length: assembled.hear.length,
                            provider,
                        })
                        lastTranscriptEventRef.current = Date.now()
                    } else if (!lastTranscriptEventRef.current) {
                        lastTranscriptEventRef.current = Date.now()
                    }
                }
                onTranscriptUpdate?.(chunk, !isFinal)
            }
            const onFailed = (failure: ListeningError) => {
                    const resolvedError = failure.message
                    setError(failure)
                    setIsListening(false)
                    setIsStarting(false)
                    onError?.(resolvedError)
                    trackEvent(AnalyticsEventType.SERMON_LISTENER_ERROR, {
                        provider,
                        message: typeof resolvedError === 'string' ? resolvedError : 'unknown',
                    })
            }

            const success = await engine.start(startOptions, (event: EngineEvent) => {
                switch (event.type) {
                    case 'started': onStart(); break
                    case 'ended': setIsListening(false); break
                    case 'result': onResult(event.text, event.isFinal, event.segments); break
                    case 'failed': onFailed(event.error); break
                    case 'capture': handleCaptureStatus(event); break
                }
            })

            // Safety net: if the provider resolved without ever firing onStart
            // (e.g. it failed silently), don't leave the button stuck on "Starting".
            setIsStarting(false)
            if (success) beginSessionRecording()
            return success
        } catch (err) {
            // If anything above throws (e.g. the engine's start()
            // rejects rather than resolving false), don't leave the button
            // stuck on "Starting…" forever with no recovery but a manual stop().
            console.error('[useSermonListener] start() failed:', err)
            setIsStarting(false)
            setIsListening(false)
            setError(errorFromMessage(err instanceof Error ? err.message : String(err)))
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
        void transcriptionEngines[provider].stop()
        setIsListening(false)
        setIsStarting(false)
        assemblerRef.current?.clearInterim()
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
        setCurrentScripture(null)
        setError(null)
        setIsSpeechDetected(false)
        setIsLoading(false)
        // A new transcript for the new listening session.
        assemblerRef.current = new TranscriptAssembler()
        setAssembler(assemblerRef.current)
        // A new scripture follower for the new listening session: nothing the
        // last one remembered — what was heard, the reading context, the
        // cooldowns — carries over, and its results still in flight are dropped.
        followerRef.current?.dispose()
        followerRef.current = createFollower()
        setFollower(followerRef.current)
        sessionStartTimeRef.current = 0
        if (interimDebounceRef.current) {
            clearTimeout(interimDebounceRef.current)
            interimDebounceRef.current = null
        }
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
