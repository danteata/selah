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
import { getListeningSession } from '../services/sermon-listener/appListeningSession'
import { useTranscripts } from './useTranscripts'
import { errorFromMessage, type ListeningError } from '../services/sermon-listener/transcriptionEngine'
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
import { isCongregationSinging } from '../services/sermon-listener/worshipMode'
import { buildBibleInitialPrompt } from '../services/sermon-listener/bibleInitialPrompt'
import {
    createScriptureFollower,
    type FollowerDecision,
    type ScriptureFollower,
} from '../services/sermon-listener/scriptureFollower'
import { extractVersesWithLLM } from '../services/sermon-listener/llmVerseExtraction'
import { isLlmConfigured } from '../services/sermon-listener/llmClient'
import { setupVisibilityKeepAwake } from '../services/sermon-listener/keepAwake'
import { audioLevel } from '../services/sermon-listener/audioLevel'
import {
    getLiveSermonState,
    saveLiveSermonState,
    clearLiveSermonState,
    migrateLegacySermonStorage,
} from './useIndexedDB'


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
    /** Whether the provider has been eagerly initialized and is ready */
    providerReady: boolean
    /** The team's saved copy of this session's transcript, once there is one */
    savedTranscriptId: string | null
    /** Bumped when a dev accuracy recording has been written (development builds) */
    devRecordingsVersion: number
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
    /** Manually set one detected verse as current */
    setCurrentDetectedVerse: (verse: DetectedVerse) => Promise<void>
    /** Clear the error being shown, and nothing else */
    dismissError: () => void
    /** What the team's saved copy is called (empty for the default, dated title) */
    setSavedCopyTitle: (title: string) => void
    /** Open the OS Screen & System Audio Recording settings page (macOS desktop) */
    openScreenCaptureSettings: () => Promise<void>
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

    // The listening session: one per app (there is one microphone).
    const session = getListeningSession()
    const {
        status,
        provider,
        isSupported,
        providerReady,
        error,
        savedTranscriptId,
        devRecordingsVersion,
        speechDetected: isSpeechDetected,
    } = useSyncExternalStore(session.subscribe, session.getSnapshot)
    const isListening = status === 'listening'
    const isStarting = status === 'starting'
    const {
        text: transcript,
        segments: transcriptSegments,
        interim: interimTranscript,
        rawUtterances,
    } = useSyncExternalStore(session.subscribeTranscript, () => session.getTranscript().getSnapshot())
    // Saving the team's copy of the transcript, which the session does.
    const { createTranscript, updateTranscript } = useTranscripts({ list: false })

    const [currentScripture, setCurrentScripture] = useState<Scripture | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    // Becomes true once we've finished hydrating from IndexedDB. Used to
    // gate the persistence useEffect so we don't write back what we just read.
    const [hydrated, setHydrated] = useState(false)

    // Semantic detection state
    const [semanticDetectorReady, setSemanticDetectorReady] = useState(false)

    // Real-time audio level (0-1) for waveform visualization
    const [captureSource, setCaptureSource] = useState<'microphone' | 'system' | null>(null)
    const audioAnalyserRef = useRef<AnalyserNode | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const audioStreamRef = useRef<MediaStream | null>(null)
    const audioLevelRafRef = useRef<number | null>(null)
    // Cleanup for the desktop native audio-features subscription (visualizer + meter).
    const nativeFeaturesUnlistenRef = useRef<(() => void) | null>(null)

    const currentScriptureRef = useRef<Scripture | null>(null)

    const analyserGenerationRef = useRef(0)

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

    // Hydrate the sermon in progress from IndexedDB on mount.
    // One-shot, runs once per hook instance. Triggers the legacy localStorage
    // → IDB migration on first ever invocation. ~50–200 ms in practice.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                await migrateLegacySermonStorage()

                const live = await getLiveSermonState()
                if (cancelled) return

                // A session that has heard something since mount is not
                // overwritten by what was saved before the reload.
                const restored = live && session.restore({
                    text: typeof live.transcript === 'string' ? live.transcript : undefined,
                    segments: Array.isArray(live.segments) ? live.segments as TranscriptSegment[] : undefined,
                })
                if (live && restored && followerRef.current?.getSnapshot().heardVerses.length === 0) {
                    followerRef.current?.restore({
                        ...(Array.isArray(live.detectedVerses) ? { heardVerses: live.detectedVerses as DetectedVerse[] } : {}),
                        ...(live.currentVerse ? { currentVerse: live.currentVerse as DetectedVerse } : {}),
                        ...(typeof live.activeBibleVersion === 'string' && live.activeBibleVersion
                            ? { activeBibleVersion: live.activeBibleVersion }
                            : {}),
                    })
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
    }, [session])

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

    // Re-acquire Screen Wake Lock when tab becomes visible again.
    // The browser releases the lock when the tab is hidden; this
    // listener re-requests it so recording isn't interrupted by sleep.
    useEffect(() => {
        const cleanup = setupVisibilityKeepAwake()
        return cleanup
    }, [])

    // Which engine to use. We proceed even while global settings are loading
    // so the UI doesn't hang if Convex is unreachable; the defaults are safe.
    useEffect(() => {
        void session.checkAvailability(targetProvider, { isDesktop: isDesktop() })
    }, [session, targetProvider])

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
                session.showError(null)
                if (!verse) {
                    settle({ ok: true })
                    break
                }
                if (!verseToLabel(verse)) {
                    session.showError(errorFromMessage('Could not resolve current verse label for version switch.'))
                    settle({ ok: false })
                    break
                }
                void lookUp(verse, versionId).then((result) => {
                    if (result.status !== 'found') {
                        if (result.status === 'missing') session.showError(errorFromMessage(`Could not load ${versionId} for ${verse.reference}.`))
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

    // The listening session (one per app) owns the lifecycle and the
    // transcript; connect it to this listener. Re-connected every render so it
    // always reads current settings.
    session.connect({
        config: () => {
            const store = useAppStore.getState()
            const sermon = store.settings.sermonListener
            const worshipMode = store.songTracking.autoDetect
            return {
                language,
                captureSource: sermon?.captureSource,
                microphoneDeviceId: sermon?.selectedMicrophoneId,
                inputChannel: sermon?.inputChannel,
                // The Bible-biased prompt steers Whisper toward scripture
                // vocabulary, which garbles sung lyrics and surfaces spurious
                // verses. While a song is being followed, use a neutral prompt.
                initialPrompt: worshipMode ? '' : buildBibleInitialPrompt(),
                worshipMode,
                recordSessions: Boolean(sermon?.recordSessions),
                isPro,
            }
        },
        hear,
        // Capture stopped: drop a pending LLM pass so it can't put a slide up
        // after Stop.
        captureStopped: () => followerRef.current?.cancelPending(),
        track: (event, properties) => trackEvent(event, properties),
        notify: (notice) => {
            switch (notice.type) {
                case 'recording-failed':
                    toast.error('Session recording could not start', {
                        description: 'The service will still be transcribed, but no audio is being saved.',
                    })
                    return
                case 'microphone-fell-back':
                    toast.warning(`${notice.from} is unavailable`, {
                        description: 'Recording from the default microphone instead.',
                        duration: 10000,
                    })
                    return
                case 'microphone-reconnected':
                    toast.success('Microphone reconnected')
                    return
                case 'free-plan-limit':
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
        },
        transcripts: {
            create: (data) => createTranscript(data),
            update: (id, data) => updateTranscript(id, data),
        },
        savedCopyDetails: () => ({
            detectedVerses: followerRef.current?.getSnapshot().heardVerses ?? [],
            scheduleId: useAppStore.getState().activeSchedule?._id,
        }),
    })

    /**
     * Start a listening run.
     */
    const start = useCallback(async (): Promise<boolean> => {
        // Warm the semantic detector. Once ready, its own initialize()
        // short-circuits, so a worker torn down by the embedding sync's idle
        // unload would otherwise only reload lazily on the first live query
        // mid-sermon — the multi-second "sometimes" delay. Re-warming when
        // nothing was disposed costs nothing.
        if (!semanticDetectorReady) {
            initSemanticDetector().catch(err => {
                console.warn('[useSermonListener] Semantic detector init failed:', err)
            })
        } else if (enableSemanticDetection) {
            initializeEmbedder().catch(err => {
                console.warn('[useSermonListener] Embedder re-warm failed:', err)
            })
        }
        return session.start()
    }, [session, semanticDetectorReady, initSemanticDetector, enableSemanticDetection])

    useEffect(() => {
        startRef.current = start
    }, [start])

    /**
     * Stop listening.
     */
    const stop = useCallback(() => {
        session.stop()
    }, [session])

    useEffect(() => {
        stopRef.current = stop
    }, [stop])

    /**
     * Clear the transcript and the heard verses: a new listening session.
     * Listening, if it is on, carries on into it.
     */
    const reset = useCallback(() => {
        setCurrentScripture(null)
        setIsLoading(false)
        // A new scripture follower for the new listening session: nothing the
        // last one remembered — what was heard, the reading context, the
        // cooldowns — carries over, and its results still in flight are dropped.
        followerRef.current?.dispose()
        followerRef.current = createFollower()
        setFollower(followerRef.current)
        session.clear()
        clearLiveSermonState().catch((err) => {
            console.warn('[useSermonListener] IDB clear live state failed:', err)
        })
    }, [createFollower, session])

    /**
     * Remove a verse from the detected list
     */
    const removeVerse = useCallback((verse: DetectedVerse) => {
        followerRef.current?.remove(verse.reference)
    }, [])

    const dismissError = useCallback(() => {
        session.showError(null)
    }, [session])

    const setSavedCopyTitle = useCallback((title: string) => {
        session.setTitle(title)
    }, [session])

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

    // No auto-stop on unmount: the listening session outlives any one view of it.

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
        providerReady,
        savedTranscriptId,
        devRecordingsVersion,
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
        setCurrentDetectedVerse,
        dismissError,
        setSavedCopyTitle,
        openScreenCaptureSettings,
    }
}

export default useSermonListener
