/**
 * One short voice-search utterance, on the local engine.
 *
 * `useVoiceSearch` was built on the Web Speech API, which on desktop has been a
 * long argument with three operating systems: macOS wants a *separate* Speech
 * Recognition permission on top of the microphone one, and Dictation enabled on
 * top of that; Windows wants "Online speech recognition" turned on; and the
 * backend behind it ships only in Google Chrome, so Arc and Brave fail on a
 * perfectly good network. Every one of those branches exists in that hook
 * because every one of them was hit.
 *
 * None of them apply here. The model is already on disk, the microphone
 * permission is the one Selah already holds for the sermon listener, and
 * nothing leaves the machine — so voice search works in a hall with no Wi-Fi,
 * which is the case that actually matters on a Sunday.
 *
 * Deliberately not a hook: React owns the UI state, this owns one session. That
 * keeps it testable without a renderer, and keeps `useVoiceSearch` from growing
 * a second lifecycle alongside the Web Speech one it already manages.
 */
import nativeTranscriptionService from '../sermon-listener/nativeTranscription'
import { useAppStore } from '../../store/appStore'
import { isDesktop } from '../../platform'

/**
 * Silence budget before giving up, in ms.
 *
 * Mirrors what Web Speech does on its own with `no-speech`: a search box that
 * sits listening forever because the operator changed their mind is worse than
 * one that quietly stops.
 */
const NO_SPEECH_MS = 7000

/**
 * Hard ceiling on one search utterance. A search query is a few seconds; this
 * exists so a stuck VAD cannot hold the microphone open indefinitely, the same
 * reason `useDictation` has `maxSeconds` and the engine has a finalize timeout.
 */
const MAX_SESSION_MS = 25_000

/** Grace period for the flushed final utterance after capture stops. */
const FINAL_UTTERANCE_GRACE_MS = 2000

export type NativeVoiceSearchUnavailable =
    /** Not the desktop build. */
    | 'unsupported'
    /** The sermon listener or a dictation is already holding the engine. */
    | 'busy'

export interface NativeVoiceSearchOptions {
    /** Live partial text, for streaming-capable models only. */
    onInterim: (text: string) => void
    /** Fires once with the finished query; the session has already stopped. */
    onFinal: (text: string) => void
    /** Fires when the session ends without usable speech, or fails. */
    onError: (message: string) => void
    /** Keep listening past the first utterance. Off for a search box. */
    continuous?: boolean
}

export interface NativeVoiceSearchSession {
    /** End early. Commits whatever was heard. Safe to call twice. */
    stop: () => Promise<void>
}

/**
 * Whether the local engine could take a search right now.
 *
 * `busy` is a real and expected answer, not an error: the sermon listener holds
 * the engine for the length of a service, and that is exactly when someone is
 * most likely to reach for voice search on the Bible panel. The caller is
 * expected to fall back to Web Speech rather than refuse.
 */
export function nativeVoiceSearchAvailability(): 'available' | NativeVoiceSearchUnavailable {
    if (!isDesktop() || !nativeTranscriptionService.isConfigured()) return 'unsupported'
    if (nativeTranscriptionService.isBusy()) return 'busy'
    return 'available'
}

/**
 * Speech recognition punctuates; a search box does not want it.
 *
 * Whisper-family models are considerably more enthusiastic about this than Web
 * Speech was — "John 3:16." and "Amazing Grace?" both break reference parsing
 * and exact-phrase matching. Trailing sentence punctuation only: the colon in
 * "John 3:16" is load-bearing and must survive.
 */
export function normalizeQuery(text: string): string {
    return text.replace(/[.,!?;]+\s*$/, '').trim()
}

/**
 * Start listening. Resolves to `null` when the engine is not available — check
 * {@link nativeVoiceSearchAvailability} first if you need to know why.
 */
export async function startNativeVoiceSearch(
    options: NativeVoiceSearchOptions,
): Promise<NativeVoiceSearchSession | null> {
    if (nativeVoiceSearchAvailability() !== 'available') return null

    const settings = useAppStore.getState().settings
    const dictation = settings.dictation
    const sermon = settings.sermonListener

    const heard: string[] = []
    let stopped = false
    let noSpeechTimer: ReturnType<typeof setTimeout> | null = null
    let sessionTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
        if (noSpeechTimer) clearTimeout(noSpeechTimer)
        if (sessionTimer) clearTimeout(sessionTimer)
        noSpeechTimer = null
        sessionTimer = null
    }

    /**
     * Ends the session and reports exactly once.
     *
     * The three ways a session can end — a final result, a timeout, the caller
     * calling `stop()` — can race, so every path goes through here and the
     * `stopped` latch decides which one won.
     */
    const finish = async (reason: 'result' | 'no-speech' | 'timeout' | 'caller') => {
        if (stopped) return
        stopped = true
        clearTimers()

        // Hold the listener open for the flushed final utterance: the VAD may
        // not have seen a silence boundary yet, and for a two-word search query
        // that pending segment is the entire search.
        await nativeTranscriptionService.stop(FINAL_UTTERANCE_GRACE_MS)

        const text = normalizeQuery(heard.join(' ').replace(/\s+/g, ' '))

        if (text) {
            options.onFinal(text)
            return
        }
        if (reason === 'no-speech' || reason === 'timeout') {
            options.onError('No speech was picked up. Try again, or type your search.')
        }
        // A caller-initiated stop with nothing heard is the operator changing
        // their mind. Silence is the right response to that.
    }

    const armNoSpeech = () => {
        if (noSpeechTimer) clearTimeout(noSpeechTimer)
        noSpeechTimer = setTimeout(() => void finish('no-speech'), NO_SPEECH_MS)
    }

    const started = await nativeTranscriptionService.start({
        // Voice search is a short query, so it wants the same fast model
        // dictation does rather than the accuracy-first one a sermon wants.
        modelId: dictation?.model,
        language: dictation?.language,
        captureSource: 'microphone',
        microphoneDeviceId: dictation?.selectedMicrophoneId || sermon?.selectedMicrophoneId,
        onResult: (text, isFinal) => {
            if (stopped) return
            const trimmed = text.trim()
            if (!trimmed) return

            if (!isFinal) {
                // Streaming models only; non-streaming ones simply never
                // produce this and the box stays empty until the final.
                armNoSpeech()
                options.onInterim(trimmed)
                return
            }

            heard.push(trimmed)
            if (options.continuous) {
                armNoSpeech()
                return
            }
            // One utterance is a search query. Commit and get out of the way.
            void finish('result')
        },
        onError: (message) => {
            if (stopped) return
            stopped = true
            clearTimers()
            options.onError(message)
        },
    })

    if (!started) {
        clearTimers()
        return null
    }

    armNoSpeech()
    sessionTimer = setTimeout(() => void finish('timeout'), MAX_SESSION_MS)

    return {
        stop: () => finish('caller'),
    }
}
