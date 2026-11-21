/**
 * The browser's speech recognition behind the transcription engine seam.
 * See transcriptionEngine.ts.
 */

import { speechRecognitionService, type SpeechRecognitionService } from './speechRecognition'
import { errorFromMessage, type EngineEvent, type EngineStartOptions, type TranscriptionEngine } from './transcriptionEngine'

export function createWebSpeechEngine(service: Pick<SpeechRecognitionService, 'isSupported' | 'start' | 'stop'> = speechRecognitionService): TranscriptionEngine {
    let listening = false
    // Stop pressed before recognition reported it had started. Web speech's
    // onstart arrives after start() has resolved, so this is remembered until
    // then rather than dropped.
    let stopRequested = false

    return {
        provider: 'web-speech',

        async isAvailable() {
            return service.isSupported()
        },

        async start(options: EngineStartOptions, onEvent: (event: EngineEvent) => void) {
            stopRequested = false
            return service.start({
                lang: options.language || 'en-US',
                continuous: true,
                interimResults: true,
                onStart: () => {
                    if (stopRequested) {
                        stopRequested = false
                        service.stop()
                        return
                    }
                    listening = true
                    onEvent({ type: 'started' })
                },
                onEnd: () => {
                    listening = false
                    onEvent({ type: 'ended' })
                },
                onResult: (text, isFinal) => {
                    onEvent({ type: 'result', text, isFinal })
                },
                onError: (code, message) => {
                    listening = false
                    onEvent({ type: 'failed', error: errorFromMessage(message || code) })
                },
            })
        },

        async stop() {
            if (!listening) {
                stopRequested = true
                return
            }
            listening = false
            service.stop()
        },

        isBusy() {
            return listening
        },
    }
}
