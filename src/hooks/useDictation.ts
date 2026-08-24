/**
 * useDictation — speak into whatever Selah field has focus.
 *
 * A system-wide hotkey starts a short transcription session on the local engine
 * and drops the result at the caret. Phase A is in-app only: the text lands in a
 * Selah input, not in another application. See
 * `plan/dictation-mode-and-distribution.md` for the split and for what Phase B
 * adds.
 *
 * ## Why this lives in React
 *
 * Same reason the sermon listener does, and the same reason the tray emits
 * `tray://toggle-listening` rather than driving the pipeline itself: model
 * selection, device choice, and the transcription session already live here.
 * Rust owns the OS keystroke and nothing else.
 *
 * ## One engine, one session
 *
 * `nativeTranscriptionService` is a singleton around a single loaded model and a
 * single capture device. The sermon listener and dictation cannot both hold it,
 * and the failure if they try is not a clean error — it is the sermon listener's
 * capture being stopped out from under a live service. So dictation refuses
 * while the listener is running, loudly, rather than queueing or interleaving.
 *
 * ## Every wait is bounded
 *
 * A push-to-talk release can genuinely go missing: the keyboard focus moves, the
 * OS swallows the key-up, the operator walks away with the key held by a book.
 * `maxSeconds` ends the session regardless. This is the same discipline as
 * `await_finalize`'s `recv_timeout` in the engine — a pipeline stage that can
 * only be ended by an event that may never arrive is a pipeline stage that
 * wedges.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { isDesktop } from '../platform'
import { useAppStore } from '../store/appStore'
import nativeTranscriptionService from '../services/sermon-listener/nativeTranscription'
import {
    clearGlobalShortcuts,
    onShortcut,
    setGlobalShortcuts,
    ShortcutAction,
    DEFAULT_DICTATION_HOTKEY,
    type ShortcutTriggeredEvent,
} from '../services/dictation/globalShortcuts'
import { copyToClipboard, insertTextAtCaret } from '../services/dictation/insertText'
import {
    destroyPill,
    hidePill,
    preloadPill,
    setPillState,
    showPill,
} from '../services/dictation/pill'

/** Ceiling on one dictation when the setting doesn't say. */
const DEFAULT_MAX_SECONDS = 60

/**
 * How long to hold the result listener open after capture stops, waiting for
 * the flushed final utterance. Two seconds is what `nativeAudioCapture` already
 * allows for the same drain; a slow model on a cold cache is the reason it is
 * seconds rather than milliseconds.
 */
const FINAL_UTTERANCE_GRACE_MS = 2000

export type DictationState = 'idle' | 'listening' | 'transcribing'

export interface UseDictationResult {
    /** Whether the feature is on and the hotkey is registered. */
    isEnabled: boolean
    state: DictationState
    /** Accelerators the OS refused, for the settings UI to surface. */
    conflicts: string[]
    /** Start a dictation from the UI — the same path the hotkey takes. */
    startDictation: () => void
    stopDictation: () => void
}

export function useDictation(): UseDictationResult {
    const settings = useAppStore((s) => s.settings)
    const dictation = settings.dictation
    const enabled = Boolean(dictation?.enabled) && isDesktop()
    const hotkey = dictation?.hotkey || DEFAULT_DICTATION_HOTKEY
    const mode = dictation?.mode ?? 'push-to-talk'
    const maxSeconds = dictation?.maxSeconds ?? DEFAULT_MAX_SECONDS

    const [state, setState] = useState<DictationState>('idle')
    // Only ever written from the registration callback. Derived to empty while
    // disabled rather than cleared in the effect body — clearing it there is a
    // synchronous setState during an effect, which cascades a render for a value
    // nothing can be looking at anyway.
    const [registrationFailures, setRegistrationFailures] = useState<string[]>([])
    const conflicts = enabled ? registrationFailures : []

    /**
     * Session state in refs, not state: the shortcut listener is registered once
     * and must see current values without being torn down and rebuilt on every
     * keystroke — re-registering the OS hotkey mid-hold would lose the release.
     */
    const activeRef = useRef(false)
    const segmentsRef = useRef<string[]>([])
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const modeRef = useRef(mode)
    const maxSecondsRef = useRef(maxSeconds)

    useEffect(() => {
        modeRef.current = mode
        maxSecondsRef.current = maxSeconds
    }, [mode, maxSeconds])

    const clearWatchdog = useCallback(() => {
        if (watchdogRef.current) {
            clearTimeout(watchdogRef.current)
            watchdogRef.current = null
        }
    }, [])

    /** Commit whatever was heard, then reset. Safe to call twice. */
    const finish = useCallback(async () => {
        if (!activeRef.current) return
        activeRef.current = false
        clearWatchdog()
        setState('transcribing')
        void setPillState('transcribing')

        // Hold the listener open for the flushed final utterance — with
        // push-to-talk the operator releases mid-sentence by design, so this is
        // usually where most of the dictation is.
        await nativeTranscriptionService.stop(FINAL_UTTERANCE_GRACE_MS)

        const text = segmentsRef.current.join(' ').replace(/\s+/g, ' ').trim()
        segmentsRef.current = []
        setState('idle')
        // Hidden before the text is placed. `insertTextAtCaret` refuses when
        // this window has lost keyboard focus, so anything still on screen at
        // that moment is a thing that could be holding it.
        await hidePill()

        if (!text) {
            toast.info('Nothing heard', { description: 'No speech was picked up.' })
            return
        }

        const outcome = insertTextAtCaret(text)
        if (outcome.ok) return

        // Nowhere to put it. Never drop it silently — the operator just spoke a
        // sentence and is entitled to know where it went.
        const copied = await copyToClipboard(text)
        if (copied) {
            toast.success('Copied to clipboard', {
                description:
                    outcome.reason === 'no-focus'
                        ? 'Selah was not focused, so the text was copied instead.'
                        : 'No text field was focused, so the text was copied instead.',
            })
        } else {
            toast.error('Could not place the dictation', { description: text.slice(0, 120) })
        }
    }, [clearWatchdog])

    const begin = useCallback(async () => {
        if (activeRef.current) return

        if (nativeTranscriptionService.getIsRunning()) {
            toast.warning('Sermon Listener is running', {
                description: 'Dictation and the listener share one microphone and model.',
            })
            return
        }

        activeRef.current = true
        segmentsRef.current = []
        setState('listening')
        // Not awaited: the pill is an indicator, and making the microphone wait
        // on a window to paint would put the operator's first word behind it.
        void showPill('listening')

        // The session cannot outlive this, whatever happens to the key-up.
        clearWatchdog()
        watchdogRef.current = setTimeout(() => {
            toast.info('Dictation ended', { description: `Reached the ${maxSecondsRef.current}s limit.` })
            void finish()
        }, maxSecondsRef.current * 1000)

        // An explicit dictation device means the sermon listener's channel index
        // no longer describes anything: channel 3 of a four-channel desk is not
        // a channel on the headset the operator just picked. Inherit the channel
        // only when the device is inherited too.
        const usingOwnDevice = Boolean(dictation?.selectedMicrophoneId)
        const started = await nativeTranscriptionService.start({
            modelId: dictation?.model,
            language: dictation?.language,
            captureSource: 'microphone',
            microphoneDeviceId:
                dictation?.selectedMicrophoneId || settings.sermonListener?.selectedMicrophoneId,
            inputChannel: usingOwnDevice ? undefined : settings.sermonListener?.inputChannel,
            onResult: (text, isFinal) => {
                // Interim results are for a live display we do not have yet (the
                // pill window is the next increment). Only finals are committed,
                // so a streaming model cannot double-insert its own text.
                if (isFinal && text.trim()) segmentsRef.current.push(text.trim())
            },
            onError: (message) => {
                activeRef.current = false
                clearWatchdog()
                setState('idle')
                void hidePill()
                toast.error('Dictation failed', { description: message })
            },
        })

        if (!started && activeRef.current) {
            activeRef.current = false
            clearWatchdog()
            setState('idle')
            void hidePill()
        }
    }, [
        clearWatchdog,
        dictation?.language,
        dictation?.model,
        dictation?.selectedMicrophoneId,
        finish,
        settings.sermonListener?.inputChannel,
        settings.sermonListener?.selectedMicrophoneId,
    ])

    // --- hotkey registration ------------------------------------------------
    // Re-runs whenever the binding changes, so a rebind takes effect
    // immediately. Registering once at startup and never again is the classic
    // version of this feature being "broken": the setting moves, the key does
    // not, and nothing says so.
    useEffect(() => {
        if (!enabled) {
            void clearGlobalShortcuts()
            // A hidden webview is memory spent on a feature the operator has
            // turned off.
            void destroyPill()
            return
        }

        // Build it warm, so the first dictation shows an indicator with the
        // utterance rather than a beat behind it.
        void preloadPill()

        let cancelled = false

        void (async () => {
            const failures = await setGlobalShortcuts([
                {
                    action:
                        mode === 'push-to-talk'
                            ? ShortcutAction.DictationPushToTalk
                            : ShortcutAction.DictationToggle,
                    accelerator: hotkey,
                    // Only push-to-talk needs the key-up. Asking for it in toggle
                    // mode would stop the session the instant it started.
                    wantsRelease: mode === 'push-to-talk',
                },
            ])
            if (cancelled) return

            setRegistrationFailures(failures.map((failure) => failure.accelerator))
            for (const failure of failures) {
                toast.error(`Hotkey ${failure.accelerator} unavailable`, {
                    description: failure.reason,
                })
            }
        })()

        return () => {
            cancelled = true
            void clearGlobalShortcuts()
        }
    }, [enabled, hotkey, mode])

    // --- hotkey handling ----------------------------------------------------
    useEffect(() => {
        if (!enabled) return

        let unlisten: (() => void) | undefined
        let cancelled = false

        void (async () => {
            const stop = await onShortcut((event: ShortcutTriggeredEvent) => {
                if (event.action === ShortcutAction.DictationPushToTalk) {
                    if (event.state === 'pressed') void begin()
                    else void finish()
                    return
                }
                if (event.action === ShortcutAction.DictationToggle && event.state === 'pressed') {
                    if (activeRef.current) void finish()
                    else void begin()
                }
            })
            if (cancelled) stop()
            else unlisten = stop
        })()

        return () => {
            cancelled = true
            unlisten?.()
        }
    }, [enabled, begin, finish])

    // Never leave the microphone open behind an unmount.
    useEffect(
        () => () => {
            clearWatchdog()
            void hidePill()
            if (activeRef.current) {
                activeRef.current = false
                void nativeTranscriptionService.stop()
            }
        },
        [clearWatchdog],
    )

    return {
        isEnabled: enabled,
        state,
        conflicts,
        startDictation: () => void begin(),
        stopDictation: () => void finish(),
    }
}

export default useDictation
