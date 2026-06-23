/**
 * Native (in-process) Whisper/Parakeet transcription provider.
 *
 * Unlike the sidecar path, transcription happens entirely in Rust: we load a
 * model into the engine, start the Rust VAD capture, and listen for
 * `transcription-result` events the engine emits per speech segment. No WAV is
 * shipped over HTTP — the VAD `Vec<f32>` goes straight to `transcribe()`.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isDesktop } from '@/platform'
import { useAppStore } from '../../store/appStore'
import { DEFAULT_NATIVE_MODEL_ID } from './nativeModelManager'

interface TranscriptionResultEvent {
    text: string
    duration_ms: number
    start_offset_ms: number
}

export interface NativeTranscriptionStartOptions {
    language?: string
    initialPrompt?: string
    captureSource?: 'microphone' | 'system'
    microphoneDeviceId?: string
    onResult: (text: string) => void
    onError: (error: string) => void
}

class NativeTranscriptionService {
    private unlisten: UnlistenFn | null = null
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
            // Load the model if it isn't already the one loaded. The model must
            // already be downloaded (via the model picker); load fails otherwise.
            const loaded = await invoke<string | null>('get_loaded_native_model')
            if (loaded !== modelId) {
                await invoke('load_native_model', { modelId })
            }

            await invoke('set_native_transcription_config', {
                language: options.language ? options.language.split('-')[0] : null,
                initialPrompt: options.initialPrompt ?? null,
                translate: false,
            })

            this.unlisten = await listen<TranscriptionResultEvent>('transcription-result', (event) => {
                if (this.isRunning && event.payload.text) {
                    options.onResult(event.payload.text)
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
    }

    /** Native capture has no JS-side MediaStream (audio is captured in Rust). */
    getMediaStream(): MediaStream | null {
        return null
    }
}

export const nativeTranscriptionService = new NativeTranscriptionService()
export default nativeTranscriptionService
