/**
 * useVoiceSearch — voice-to-text for short search queries.
 *
 * Two engines behind one interface, chosen per `start()`:
 *
 *   - **The local engine**, on desktop, when it is free. Offline, no cloud
 *     round-trip, and none of the desktop speech-permission maze below.
 *   - **The Web Speech API**, everywhere else — the browser build, and desktop
 *     while the sermon listener holds the engine.
 *
 * The choice is made at `start()` rather than at render, because "is the engine
 * free" is only knowable then. Mid-service is exactly when someone reaches for
 * voice search on the Bible panel *and* exactly when the listener owns the
 * engine, so falling back rather than refusing is the point.
 *
 * The Web Speech path keeps the whole error vocabulary below it accumulated —
 * macOS wanting a separate Speech Recognition permission and Dictation enabled,
 * Windows wanting "Online speech recognition", the backend shipping only in
 * Google Chrome. On the local path none of that applies, which is the reason
 * for preferring it on desktop.
 *
 * The hook is for short search inputs (Bible refs, song titles); long-form
 * dictation is `useDictation`, and a sermon is the sermon listener.
 *
 * Usage:
 *   const { isListening, transcript, start, stop, isSupported, error } = useVoiceSearch()
 *   ...
 *   <VoiceSearchButton isListening={isListening} onClick={isListening ? stop : start} />
 *   <input value={query} onChange={...} />
 *   // When the user stops speaking, commit `transcript` into the input.
 *
 * Lifecycle:
 *   - `start()` requests a one-shot recognition session. If the browser
 *     doesn't support it, or mic permission is denied, `isSupported` or
 *     `error` is set and the session is a no-op.
 *   - Interim results update `transcript` live so the caller can show them
 *     in the input.
 *   - On a final result, `onFinal` fires (if provided) and the session
 *     ends — the caller is responsible for committing the final text
 *     into their input.
 *   - `stop()` aborts an in-flight session early.
 *   - `reset()` clears transcript + error without starting a session.
 *
 * The recognition object is lazily created on the first `start()` and
 * torn down on unmount, on `stop()`, or on `onend` so we don't leak
 * listeners across many search opens.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { isDesktop } from '../platform'
import {
    nativeVoiceSearchAvailability,
    normalizeQuery,
    startNativeVoiceSearch,
    type NativeVoiceSearchSession,
} from '../services/dictation/nativeVoiceSearch'

// The sermon-listener service already declares `SpeechRecognition` /
// `webkitSpeechRecognition` on the global Window (see
// src/services/sermon-listener/speechRecognition.ts). We don't redeclare
// the type — a second `declare global { interface Window { … } }` block
// collides with the existing one even when the shape matches.
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

// Slim local alias. Mirrors the subset we actually drive; the underlying
// browser type may have additional callbacks we don't touch.
interface SpeechRecognitionLike {
    lang: string
    continuous: boolean
    interimResults: boolean
    maxAlternatives: number
    onresult:
        | ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void)
        | null
    onerror: ((event: { error?: string; message?: string }) => void) | null
    onend: (() => void) | null
    onstart: (() => void) | null
    start(): void
    stop(): void
    abort(): void
}

export interface UseVoiceSearchOptions {
    /** BCP-47 language tag (e.g. 'en-US'). Defaults to 'en-US'. */
    lang?: string
    /**
     * Called once a `final` result arrives. The caller should commit
     * `transcript` into their input here. The session is automatically
     * ended after this fires, so the user can review and edit before
     * submitting.
     */
    onFinal?: (transcript: string) => void
    /**
     * If true, recognition continues until the user explicitly stops.
     * Off by default — most search inputs are short single-shot queries
     * and a final result is the natural endpoint.
     */
    continuous?: boolean
}

export interface UseVoiceSearchReturn {
    /** True while the recognition session is active. */
    isListening: boolean
    /**
     * The latest transcript. While listening, this updates with interim
     * results. After `onFinal`, the caller has committed the text and
     * this value persists until `reset()` or the next `start()`.
     */
    transcript: string
    /**
     * `true` if the current browser supports the Web Speech API. When
     * false, `start()` is a no-op and the UI should hide the mic button
     * (or show it disabled with a tooltip).
     */
    isSupported: boolean
    /** Most recent error message (e.g. 'not-allowed'). */
    error: string | null
    /** Start a recognition session. No-op if not supported. */
    start: () => void
    /** Stop the in-flight session. Safe to call when idle. */
    stop: () => void
    /** Clear transcript + error. Does not stop a running session. */
    reset: () => void
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') return null
    const w = window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor
        webkitSpeechRecognition?: SpeechRecognitionCtor
    }
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useVoiceSearch(options: UseVoiceSearchOptions = {}): UseVoiceSearchReturn {
    const { lang = 'en-US', onFinal, continuous = false } = options

    const [isListening, setIsListening] = useState(false)
    // Track committed (final) text and the current interim slice separately.
    // The exposed `transcript` is the concatenation of the two. This is the
    // canonical pattern for the Web Speech API — accumulating everything
    // into one string via `prev + interim` produces duplicated text when
    // the browser fires multiple `onresult` events as the utterance
    // refines ("Matthew" → "Matthew 7" → "Matthew 7:7" would otherwise
    // glue into "MatthewMatthew 7Matthew 7:7").
    const [finalText, setFinalText] = useState('')
    const [interimText, setInterimText] = useState('')
    const transcript = finalText + interimText
    // Mirror the latest finalText into a ref so the `onend` callback
    // (closed over by `start()`) sees the up-to-date value when it
    // commits on session end. Without this, the commit would always
    // see the empty string from when start() was called.
    const finalTextRef = useRef('')
    // Same pattern for the "session actually started" flag. The
    // browser's `onstart` is async (microtask in the spec, sometimes
    // a full task in some engines), and `onend` may fire in a
    // microtask scheduled before `onstart` ran. Reading the closure
    // local `started` in that ordering is unreliable — mirroring it
    // into a ref lets `onend` always see the latest value.
    const startedRef = useRef(false)
    const [error, setError] = useState<string | null>(null)

    const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
    /** Non-null while a local-engine session is in flight. */
    const nativeSessionRef = useRef<NativeVoiceSearchSession | null>(null)
    const onFinalRef = useRef(onFinal)
    onFinalRef.current = onFinal

    // The local engine needs no browser support at all, so on desktop the mic
    // button must not be hidden just because this WebView lacks Web Speech —
    // which WKWebView and WebView2 both, at times, do.
    const isSupported = getSpeechRecognitionCtor() !== null || isDesktop()

    // One-shot startup probe so DevTools shows the platform-reported
    // mic permission state before the user ever clicks the mic. On
    // macOS, a `denied` here (with no prompt shown) usually means the
    // user previously denied the OS prompt and the only path forward
    // is System Settings → Privacy & Security → Microphone → toggle
    // Selah on. On Windows WebView2 the same `denied` (with no prompt
    // shown) means the app manifest didn't declare the microphone
    // DeviceCapability — the other common cause of "NotAllowedError
    // before any prompt" after a fresh build. The probe is best-
    // effort: `permissions` is not implemented in every WebView, so
    // we swallow errors.
    useEffect(() => {
        // Only meaningful for the Web Speech path. On desktop the local engine
        // is the one that will run, and it holds the microphone permission the
        // sermon listener already uses — reporting a browser-level denial
        // before the operator has clicked anything would be an error about a
        // path we are not going to take.
        if (nativeVoiceSearchAvailability() !== 'unsupported') return
        if (typeof navigator === 'undefined' || !navigator.permissions?.query) return
        navigator.permissions
            .query({ name: 'microphone' as PermissionName })
            .then((status) => {
                console.info('[voice-search] permissions.microphone =', status.state)
                // If the user already denied at the OS level (Windows
                // Settings → Privacy → Microphone toggle is off, macOS
                // Privacy → Microphone off, or the app was installed
                // with a manifest/Info.plist that didn't declare the
                // capability), surface a heads-up so they don't have
                // to click the mic to find out.
                if (status.state === 'denied') {
                    setError(
                        isDesktop()
                            ? "Selah can't access the microphone. On Windows, open Settings → Privacy & security → Microphone and allow Selah. On macOS, open System Settings → Privacy & Security → Microphone. Then click the mic again to retry. You can also type your search below."
                            : 'Microphone permission was denied. Click the mic again to retry after allowing it in your browser.'
                    )
                }
            })
            .catch(() => {
                // Some WebViews (notably older WebView2 builds) don't
                // implement the Permissions API. Silently skip — the
                // onerror path will catch the failure when the user
                // actually clicks the mic.
            })
    }, [])

    // Tear down on unmount so a session in flight is aborted if the
    // component using this hook unmounts mid-listen.
    useEffect(() => {
        return () => {
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.abort()
                } catch {
                    // ignore — abort() can throw on already-stopped instances
                }
                recognitionRef.current = null
            }
            // Never leave the microphone open behind an unmount. The panel
            // holding this hook closes while listening more often than not —
            // the operator clicks the mic, changes their mind, and closes it.
            if (nativeSessionRef.current) {
                void nativeSessionRef.current.stop()
                nativeSessionRef.current = null
            }
        }
    }, [])

    const startWebSpeech = useCallback(() => {
        const Ctor = getSpeechRecognitionCtor()
        if (!Ctor) {
            setError('Voice search is not supported in this browser.')
            return
        }

        // If a session is somehow already running, abort it before starting
        // a new one. Avoids a "recognition has already started" DOMException.
        if (recognitionRef.current) {
            try {
                recognitionRef.current.abort()
            } catch {
                // ignore
            }
            recognitionRef.current = null
        }

        setError(null)
        setFinalText('')
        setInterimText('')
        finalTextRef.current = ''
        startedRef.current = false

        // Defer the actual `isListening=true` flip until the browser
        // confirms the session started. Some browsers fire `onerror` →
        // `onend` synchronously after `start()` (e.g. when no microphone
        // is available, or when the page lost permission). Without
        // this gate, the UI flickers red → off in the same frame and
        // the user sees no indication of what happened. The closure-
        // local `started` is a synchronous fast-path; `startedRef` is
        // the cross-microtask source of truth read by `onend`.
        let started = false

        const recognition = new Ctor() as unknown as SpeechRecognitionLike
        recognition.lang = lang
        recognition.continuous = continuous
        recognition.interimResults = true
        recognition.maxAlternatives = 1

        recognition.onstart = () => {
            started = true
            startedRef.current = true
            setIsListening(true)
        }

        recognition.onresult = (event) => {
            console.warn('[voice-search] onresult, resultIndex:', event.resultIndex, 'results.length:', event.results.length)
            // Walk the new results (from `resultIndex` to the end). Within
            // a single event, multiple slices can be interim or final; the
            // latest interim is the only one that matters because the
            // browser keeps refining the same utterance as more audio
            // arrives. We commit final slices to `finalText` and only
            // keep the LAST interim slice in `interimText`.
            let newFinal = ''
            let newInterim = ''
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const slice = event.results[i]
                if (!slice) continue
                const text = slice[0]?.transcript ?? ''
                if (slice.isFinal) {
                    newFinal += text
                } else {
                    newInterim = text
                }
            }
            if (newFinal) {
                // Update the ref synchronously so the `onend` callback
                // (closed over by start()) sees the up-to-date value
                // even if React hasn't flushed the setState yet. In
                // React 18 the state updater is deferred to render
                // time, which is too late for the synchronous onend
                // path.
                finalTextRef.current = finalTextRef.current + newFinal
                setFinalText(finalTextRef.current)
            }
            setInterimText(newInterim)
        }

        recognition.onerror = (event) => {
            const code = event.error ?? 'unknown'
            // Surface the raw code in the console so the WebView2
            // DevTools (right-click → Inspect) shows the actual reason.
            // This is the single fastest way to tell apart:
            //   - "manifest not embedded" (still not-allowed with no
            //     prompt shown, even after enabling OS privacy toggle)
            //   - "OS toggle off" (not-allowed after a prompt that the
            //     user dismissed)
            //   - "no mic hardware" (audio-capture)
            //   - "Web Speech service unreachable" (network)
            console.warn('[voice-search] onerror', { code, message: event.message, isDesktop: isDesktop() })
            if (code === 'not-allowed') {
                // On the web this is a real user denial (or extension
                // blocking the prompt). On the Tauri desktop build
                // there is no "browser settings" page to point the
                // user at — if the OS hasn't granted microphone access
                // to the Selah process, getUserMedia fails silently
                // before any prompt. We branch on isDesktop() so the
                // message is actionable on each platform: web users
                // see the literal browser-permission language, desktop
                // users see OS-level steps that actually work.
                setError(
                    isDesktop()
                        ? "Selah can't access the microphone. On Windows, open Settings → Privacy & security → Microphone and allow Selah. On macOS, open System Settings → Privacy & Security → Microphone. Then click the mic again to retry. You can also type your search below."
                        : 'Microphone permission was denied. Click the mic again to retry after allowing it in your browser.'
                )
            } else if (code === 'service-not-allowed') {
                // macOS and Windows treat Speech Recognition as a
                // SEPARATE permission from Microphone. WKWebView and
                // WebView2 return `service-not-allowed` when the
                // speech-recognition permission is missing, even if
                // the mic permission is granted. On macOS the
                // setting lives at System Settings → Privacy &
                // Security → Speech Recognition. On Windows it's
                // Settings → Privacy & security → Speech ("Online
                // speech recognition"). Direct the user to the
                // right pane.
                setError(
                    isDesktop()
                        ? "Selah can't use speech recognition. On Windows, open Settings → Privacy & security → Speech and turn on 'Online speech recognition'. On macOS, open System Settings → Privacy & Security → Speech Recognition and allow Selah. Then click the mic again to retry. You can also type your search below."
                        : "Voice search couldn't reach the speech service. Check your network, or any browser extensions that block requests. You can still type your search below."
                )
            } else if (code === 'aborted' && /siri|dictation|disabled/i.test(event.message ?? '')) {
                // macOS returns `aborted` with a "Siri and
                // Dictation are disabled" message when the
                // user-level Dictation preference is off, even
                // though the per-app Speech Recognition permission
                // is granted. The fix is to enable Dictation at
                // the system level (Keyboard → Dictation) and/or
                // turn on Siri (Apple Intelligence & Siri).
                setError(
                    isDesktop()
                        ? "macOS Dictation is disabled. Open System Settings → Keyboard → Dictation and turn it on (or enable Siri under Apple Intelligence & Siri). Then click the mic again to retry. You can also type your search below."
                        : "Voice search couldn't reach the speech service. Check your network, or any browser extensions that block requests. You can still type your search below."
                )
            } else if (code === 'no-speech') {
                setError(null) // benign — just no speech detected
            } else if (code === 'audio-capture') {
                setError('No microphone was found. Check that a mic is connected and try again.')
            } else if (code === 'network') {
                // The Web Speech API round-trips audio to Google's cloud, and
                // that backend ships only in Google Chrome. Other Chromium
                // browsers (Arc, Brave, etc.) lack the key and fail here even
                // on a fine network — so lead with the browser cause, not the
                // network, and point to the typed fallback.
                setError("Voice search isn't available in this browser. On the web it works in Google Chrome or Safari — Arc, Brave and some others aren't supported. You can type your search below instead.")
            } else {
                setError(`Voice search error: ${code}`)
            }
            // Drop the listening state immediately on error so the UI
            // doesn't briefly show "listening" between onerror and onend
            // (Chrome fires onend shortly after onerror, but the gap is
            // long enough to flash the pulsing red ring).
            setIsListening(false)
        }

        recognition.onend = () => {
            console.warn('[voice-search] onend, finalText:', JSON.stringify(finalTextRef.current))
            setIsListening(false)
            setInterimText('') // Drop any trailing interim so the input
                               // doesn't show stale "..." while the user
                               // reviews the committed text.
            // Snapshot the ref before resetting — the ref is the
            // source of truth for "did the session actually start"
            // because the browser's onstart/onend are queued as
            // microtasks and may not run in the order we'd assume if
            // we relied on the closure-local `started` variable.
            const didStart = startedRef.current
            started = false
            startedRef.current = false
            // Commit the final text via the ref (which mirrors the
            // latest committed value — see note at `finalTextRef`).
            // We only call `onFinal` if the session actually got off
            // the ground and produced at least one character of
            // finalized text.
            // Speech recognition appends sentence punctuation (e.g. "John
            // 3:16.") which breaks Bible-reference parsing and exact-phrase
            // search. Shared with the local path, which needs it more — the
            // Whisper family punctuates far more readily than Web Speech did.
            const finalText = normalizeQuery(finalTextRef.current)
            if (didStart && finalText && onFinalRef.current) {
                onFinalRef.current(finalText)
            }
            recognitionRef.current = null
        }

        recognitionRef.current = recognition
        try {
            recognition.start()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start voice search.')
            setIsListening(false)
            recognitionRef.current = null
        }
    }, [lang, continuous])

    /**
     * Run the utterance on the local engine.
     *
     * Returns false when the engine could not take it, so `start()` can fall
     * through to Web Speech rather than leaving the operator with a dead mic
     * button.
     */
    const startNative = useCallback(async (): Promise<boolean> => {
        setError(null)
        setFinalText('')
        setInterimText('')
        finalTextRef.current = ''
        // The local path has no `onstart` to wait for: capture either starts or
        // throws, so the indicator can go up immediately.
        setIsListening(true)

        let session: NativeVoiceSearchSession | null = null
        try {
            session = await startNativeVoiceSearch({
                continuous,
                onInterim: (text) => setInterimText(text),
                onFinal: (text) => {
                    nativeSessionRef.current = null
                    setIsListening(false)
                    setInterimText('')
                    finalTextRef.current = text
                    setFinalText(text)
                    onFinalRef.current?.(text)
                },
                onError: (message) => {
                    nativeSessionRef.current = null
                    setIsListening(false)
                    setInterimText('')
                    setError(message)
                },
            })
        } catch (err) {
            console.warn('[voice-search] local engine failed to start:', err)
            session = null
        }

        if (!session) {
            setIsListening(false)
            return false
        }

        nativeSessionRef.current = session
        return true
    }, [continuous])

    /**
     * Pick an engine and go.
     *
     * Availability is read here rather than at render because `busy` changes
     * under us: the sermon listener starting or stopping does not re-render
     * this hook, and a decision cached from mount would be wrong for the whole
     * of a service.
     */
    const start = useCallback(() => {
        if (nativeVoiceSearchAvailability() === 'available') {
            void startNative().then((ok) => {
                // The engine was free a moment ago and is not now — another
                // panel's search, or a listener that just started. Web Speech is
                // still there.
                if (!ok) startWebSpeech()
            })
            return
        }
        startWebSpeech()
    }, [startNative, startWebSpeech])

    const stop = useCallback(() => {
        if (nativeSessionRef.current) {
            const session = nativeSessionRef.current
            nativeSessionRef.current = null
            void session.stop()
            return
        }
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop()
            } catch {
                // ignore
            }
        }
    }, [])

    const reset = useCallback(() => {
        setFinalText('')
        setInterimText('')
        setError(null)
    }, [])

    return { isListening, transcript, isSupported, error, start, stop, reset }
}
