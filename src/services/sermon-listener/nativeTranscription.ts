/**
 * Native (in-process) Whisper/Parakeet transcription provider.
 *
 * Unlike the sidecar path, transcription happens entirely in Rust: we load a
 * model into the engine, start the Rust VAD capture, and listen for
 * `transcription-result` events the engine emits per finished speech segment.
 * No WAV is shipped over HTTP — the VAD `Vec<f32>` goes straight to
 * `transcribe()` (or a live stream, for streaming-capable models — see below).
 *
 * Streaming-capable models (e.g. Parakeet Unified) additionally emit
 * `native-stream-text` events while a segment is still being spoken —
 * `committed`/`tentative` text from the in-progress utterance. Non-streaming
 * models never emit this event, so `onResult` simply never sees `isFinal:
 * false` for them; the rest of the pipeline (interim transcript state,
 * dimmed-italic rendering) already handles both cases identically to the
 * web-speech provider.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isDesktop } from '@/platform'
import { useAppStore } from '../../store/appStore'
import { DEFAULT_NATIVE_MODEL_ID } from './nativeModelManager'
// Type-only, so this does not create a runtime cycle with unifiedTranscription
// (which imports this module).
import type { WhisperSegmentTiming } from './unifiedTranscription'

interface TranscriptionResultEvent {
    text: string
    duration_ms: number
    start_offset_ms: number
    /**
     * Segment timings in seconds from the start of the recording session (the
     * Rust side has already applied `start_offset_ms`). Empty when the model
     * produces no alignment data, and for results that came from the streaming
     * path — `finalize_stream` returns text only.
     */
    segments: WhisperSegmentTiming[]
}

/** Mirrors Rust `StreamTextEvent` (the `native-stream-text` payload). */
interface StreamTextEvent {
    committed: string
    tentative: string
}

export interface NativeTranscriptionStartOptions {
    /**
     * Model to run this session on. Defaults to the sermon listener's choice.
     *
     * Dictation overrides it: it is latency-sensitive in a way a sermon
     * transcript is not — the operator is watching a cursor — so a small fast
     * model is often the right answer there and the wrong one for a service.
     * Switching costs a load, which is why the default is to inherit rather
     * than to pick a fast model on the operator's behalf.
     */
    modelId?: string
    language?: string
    initialPrompt?: string
    captureSource?: 'microphone' | 'system'
    microphoneDeviceId?: string
    /** 0-based input channel on a multi-channel interface; omit to average all. */
    inputChannel?: number
    onResult: (text: string, isFinal: boolean, segments?: WhisperSegmentTiming[]) => void
    onError: (error: string) => void
}

class NativeTranscriptionService {
    private unlisten: UnlistenFn | null = null
    private unlistenStream: UnlistenFn | null = null
    /** Terminal-marker listener; see `stop(waitForFinalMs)`. */
    private unlistenEos: UnlistenFn | null = null
    /** Armed while draining, fired by the `end_of_stream` marker. */
    private eosResolve: (() => void) | null = null
    private isRunning = false
    /**
     * True from the moment `stop()` is entered until it has finished draining
     * and unlistening.
     *
     * `isRunning` goes false at the top of `stop()` so no *new* audio is taken,
     * but the session is not over at that point: `stop()` still has up to
     * `waitForFinalMs` of draining to do, and the last utterance arrives inside
     * that window. Callers asking "is the engine free?" have to see the drain,
     * or they start a second session on top of a singleton that is still
     * shutting down.
     */
    private isStopping = false

    isConfigured(): boolean {
        return isDesktop()
    }

    getIsRunning(): boolean {
        return this.isRunning
    }

    /**
     * Whether the engine and microphone are unavailable — live *or* still
     * shutting down. This, not `getIsRunning()`, is the question to ask before
     * starting a session.
     */
    isBusy(): boolean {
        return this.isRunning || this.isStopping
    }

    /** Load the selected model into the engine, then start VAD capture. */
    async start(options: NativeTranscriptionStartOptions): Promise<boolean> {
        if (!isDesktop()) {
            options.onError('Native transcription is only available in the desktop app')
            return false
        }
        if (this.isBusy()) return false

        const modelId =
            options.modelId ||
            useAppStore.getState().settings.sermonListener?.whisperModel ||
            DEFAULT_NATIVE_MODEL_ID

        try {
            // Load the model if it isn't already the one loaded. A load fails when
            // the model isn't on disk, which a saved selection can easily outlive:
            // the user deleted it, or the setting names a model this install never
            // downloaded (a synced profile, or a retired legacy entry). Rather than
            // failing the whole session, fall back to the bundled default, which is
            // always present.
            const loaded = await invoke<string | null>('get_loaded_native_model')
            if (loaded !== modelId) {
                try {
                    await invoke('load_native_model', { modelId })
                } catch (loadErr) {
                    if (modelId === DEFAULT_NATIVE_MODEL_ID) throw loadErr
                    console.warn(
                        `[nativeTranscription] could not load "${modelId}" (${loadErr}); ` +
                            `falling back to bundled "${DEFAULT_NATIVE_MODEL_ID}"`,
                    )
                    await invoke('load_native_model', { modelId: DEFAULT_NATIVE_MODEL_ID })
                }
            }

            await invoke('set_native_transcription_config', {
                language: options.language ? options.language.split('-')[0] : null,
                initialPrompt: options.initialPrompt ?? null,
                translate: false,
            })

            // `isBusy()`, not `isRunning`: the flushed final utterance arrives
            // *after* `stop()` has cleared `isRunning`, and catching it is the
            // entire reason `stop()` waits for `end_of_stream`. Gating finals
            // on `isRunning` dropped the last thing the operator said —
            // which, with push-to-talk, is usually most of the dictation.
            this.unlisten = await listen<TranscriptionResultEvent>('transcription-result', (event) => {
                if (this.isBusy() && event.payload.text) {
                    const { text, segments } = event.payload
                    options.onResult(text, true, segments?.length ? segments : undefined)
                }
            })

            this.unlistenStream = await listen<StreamTextEvent>('native-stream-text', (event) => {
                if (!this.isRunning) return
                const { committed, tentative } = event.payload
                const display = `${committed}${tentative}`.trim()
                if (display) {
                    options.onResult(display, false)
                }
            })

            // The capture thread flushes the in-progress speech segment when
            // capture stops, waits for the transcription worker to drain, and
            // only then emits this terminal marker. Listening for it is what
            // lets `stop()` hold the result listener open long enough to
            // receive that last utterance — see the drain in `stop()`.
            this.unlistenEos = await listen<{ end_of_stream?: boolean }>(
                'vad-audio-chunk',
                (event) => {
                    if (event.payload?.end_of_stream) this.eosResolve?.()
                },
            )

            await invoke('start_capture_with_vad', {
                captureType: options.captureSource ?? 'microphone',
                deviceName: options.microphoneDeviceId,
                inputChannel: options.inputChannel,
            })

            this.isRunning = true
            return true
        } catch (err) {
            this.unlisten?.()
            this.unlisten = null
            this.unlistenStream?.()
            this.unlistenStream = null
            this.unlistenEos?.()
            this.unlistenEos = null
            options.onError(err instanceof Error ? err.message : String(err))
            return false
        }
    }

    /**
     * Stop capture and tear down the listeners.
     *
     * `waitForFinalMs` holds the result listener open after `stop_capture`,
     * until the Rust side signals `end_of_stream` or the wait elapses. That
     * matters when a caller needs the *last* utterance: the capture thread
     * flushes whatever speech the VAD was still accumulating and transcribes it
     * after the stop, so a listener torn down immediately misses it.
     *
     * It defaults to 0 — no drain — because a continuous session (the sermon
     * listener) stops during silence, where there is nothing in flight to lose,
     * and because a drain on every stop would make teardown feel sticky.
     * Dictation is the opposite case: push-to-talk releases *mid-sentence* by
     * design, so the flushed segment is not an edge case, it is the whole
     * dictation. It passes a real timeout.
     *
     * The wait is bounded rather than open-ended for the reason every wait in
     * this pipeline is: a marker that never arrives must not wedge the caller.
     */
    async stop(waitForFinalMs = 0): Promise<void> {
        this.isRunning = false
        this.isStopping = true
        try {
            try {
                await invoke('stop_capture')
            } catch (err) {
                console.warn('[nativeWhisper] stop_capture failed:', err)
            }

            if (waitForFinalMs > 0) {
                await this.waitForEndOfStream(waitForFinalMs)
            }

            if (this.unlisten) {
                this.unlisten()
                this.unlisten = null
            }
            if (this.unlistenStream) {
                this.unlistenStream()
                this.unlistenStream = null
            }
            if (this.unlistenEos) {
                this.unlistenEos()
                this.unlistenEos = null
            }
        } finally {
            // Cleared in `finally` on purpose: a throw anywhere above would
            // otherwise leave the service permanently "busy" and refuse every
            // later session, which is a worse failure than the one that threw.
            this.isStopping = false
        }
    }

    /** Resolves on the `end_of_stream` marker, or when `timeoutMs` elapses. */
    private waitForEndOfStream(timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            let settled = false
            const finish = () => {
                if (settled) return
                settled = true
                this.eosResolve = null
                clearTimeout(timer)
                resolve()
            }
            const timer = setTimeout(() => {
                console.warn('[nativeWhisper] end_of_stream did not arrive; committing anyway')
                finish()
            }, timeoutMs)
            this.eosResolve = finish
        })
    }

    /** Native capture has no JS-side MediaStream (audio is captured in Rust). */
    getMediaStream(): MediaStream | null {
        return null
    }
}

export const nativeTranscriptionService = new NativeTranscriptionService()
export default nativeTranscriptionService
