/**
 * The desktop's in-process engine (Rust, via Tauri) behind the transcription
 * engine seam. See transcriptionEngine.ts.
 *
 * Besides transcription results, this is where the capture supervisor's
 * `capture-stream-error` events become typed capture statuses, so the
 * listener never reads Rust's payload — or its error text — itself.
 */

import { nativeTranscriptionService } from './nativeTranscription'
import { onCaptureStreamError, type CaptureStreamErrorEvent } from './nativeAudioCapture'
import {
    errorFromMessage,
    type CaptureStatus,
    type EngineEvent,
    type EngineStartOptions,
    type TranscriptionEngine,
} from './transcriptionEngine'

type NativeService = Pick<typeof nativeTranscriptionService, 'isConfigured' | 'start' | 'stop' | 'isBusy'>
type SubscribeCaptureErrors = (handler: (event: CaptureStreamErrorEvent) => void) => Promise<() => void>

/** A capture-stream-error payload as the listener should understand it. */
export function captureStatusOf(event: CaptureStreamErrorEvent): CaptureStatus {
    if (event.fellBackFrom) return { status: 'fell-back', from: event.fellBackFrom, message: event.message }
    if (event.fatal) return { status: 'fatal', message: event.message }
    if (event.recovered) return { status: 'recovered', attempt: event.attempt, message: event.message }
    return { status: 'lost', attempt: event.attempt, message: event.message }
}

export function createNativeEngine(
    service: NativeService = nativeTranscriptionService,
    subscribeCaptureErrors: SubscribeCaptureErrors = onCaptureStreamError,
): TranscriptionEngine {
    let listening = false
    // Stop pressed while the model was still loading: start() then stops what
    // it started and reports false, instead of going live anyway.
    let stopRequested = false
    let unlistenCapture: (() => void) | null = null

    const detachCapture = () => {
        unlistenCapture?.()
        unlistenCapture = null
    }

    return {
        provider: 'native',

        async isAvailable() {
            return service.isConfigured()
        },

        async start(options: EngineStartOptions, onEvent: (event: EngineEvent) => void) {
            stopRequested = false
            const started = await service.start({
                language: options.language,
                initialPrompt: options.initialPrompt,
                captureSource: options.captureSource,
                microphoneDeviceId: options.microphoneDeviceId,
                inputChannel: options.inputChannel,
                onResult: (text, isFinal, segments) => {
                    onEvent({
                        type: 'result',
                        text,
                        isFinal,
                        segments: segments?.map((s) => ({
                            startMs: Math.max(0, Math.round(s.start * 1000)),
                            endMs: Math.max(0, Math.round(s.end * 1000)),
                            text: s.text,
                        })),
                    })
                },
                onError: (message) => {
                    listening = false
                    detachCapture()
                    onEvent({ type: 'failed', error: errorFromMessage(message) })
                },
            })
            if (!started) return false

            if (stopRequested) {
                stopRequested = false
                await service.stop()
                return false
            }

            listening = true
            const unlisten = await subscribeCaptureErrors((event) => {
                onEvent({ type: 'capture', ...captureStatusOf(event) })
            })
            if (listening) unlistenCapture = unlisten
            else unlisten()
            onEvent({ type: 'started' })
            return true
        },

        async stop() {
            if (!listening) {
                stopRequested = true
                return
            }
            listening = false
            detachCapture()
            await service.stop()
        },

        isBusy() {
            return service.isBusy()
        },
    }
}
