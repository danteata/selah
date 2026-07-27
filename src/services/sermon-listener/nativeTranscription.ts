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
    language?: string
    initialPrompt?: string
    captureSource?: 'microphone' | 'system'
    microphoneDeviceId?: string
    onResult: (text: string, isFinal: boolean, segments?: WhisperSegmentTiming[]) => void
    onError: (error: string) => void
}

class NativeTranscriptionService {
    private unlisten: UnlistenFn | null = null
    private unlistenStream: UnlistenFn | null = null
    private isRunning = false

    isConfigured(): boolean {
        return isDesktop()
    }

    getIsRunning(): boolean {
        return this.isRunning
    }

    /** Load the selected model into the engine, then start VAD capture. */
    async start(options: NativeTranscriptionStartOptions): Promise<boolean> {
        if (!isDesktop()) {
            options.onError('Native transcription is only available in the desktop app')
            return false
        }
        if (this.isRunning) return false

        const modelId =
            useAppStore.getState().settings.sermonListener?.whisperModel || DEFAULT_NATIVE_MODEL_ID

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

            this.unlisten = await listen<TranscriptionResultEvent>('transcription-result', (event) => {
                if (this.isRunning && event.payload.text) {
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

            await invoke('start_capture_with_vad', {
                captureType: options.captureSource ?? 'microphone',
                deviceName: options.microphoneDeviceId,
            })

            this.isRunning = true
            return true
        } catch (err) {
            this.unlisten?.()
            this.unlisten = null
            this.unlistenStream?.()
            this.unlistenStream = null
            options.onError(err instanceof Error ? err.message : String(err))
            return false
        }
    }

    async stop(): Promise<void> {
        this.isRunning = false
        try {
            await invoke('stop_capture')
        } catch (err) {
            console.warn('[nativeWhisper] stop_capture failed:', err)
        }
        if (this.unlisten) {
            this.unlisten()
            this.unlisten = null
        }
        if (this.unlistenStream) {
            this.unlistenStream()
            this.unlistenStream = null
        }
    }

    /** Native capture has no JS-side MediaStream (audio is captured in Rust). */
    getMediaStream(): MediaStream | null {
        return null
    }
}

export const nativeTranscriptionService = new NativeTranscriptionService()
export default nativeTranscriptionService
