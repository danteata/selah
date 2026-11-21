/**
 * The seam between the sermon listener and whatever turns audio into text.
 *
 * Two engines sit behind it: web speech in the browser (webSpeechEngine) and
 * the in-process native engine on the desktop (nativeEngine). Each one emits
 * the same typed events, and each one classifies its own errors — a Rust
 * message or a browser error code becomes a `ListeningError` at the adapter,
 * so nothing above it matches on error text.
 */

import {
    classifyTranscriptionError,
    isRetryableError,
    type TranscriptionErrorCode,
} from './transcriptionErrors'

export type TranscriptionProvider = 'web-speech' | 'native'

/** Segment timing from the native engine, in seconds from the start of capture. */
export interface WhisperSegmentTiming {
    start: number
    end: number
    text: string
}

/** A timed piece of an utterance, in milliseconds from the start of this capture. */
export interface EngineSegment {
    startMs: number
    endMs: number
    text: string
}

/** An error the listener can act on: what kind it is, not only what it says. */
export interface ListeningError {
    code: TranscriptionErrorCode
    message: string
    /** Whether the listener (or the capture supervisor) is retrying on its own. */
    retryable: boolean
}

export function listeningError(code: TranscriptionErrorCode, message: string, retryable = isRetryableError(code)): ListeningError {
    return { code, message, retryable }
}

/** Classify free text — a browser message, or text from code we don't own. */
export function errorFromMessage(message: string): ListeningError {
    return listeningError(classifyTranscriptionError(message), message)
}

/** What happened to the capture stream underneath a running engine (native only). */
export type CaptureStatus =
    /** The stream dropped; the capture supervisor is rebuilding it. */
    | { status: 'lost'; attempt: number; message: string }
    /** The stream was rebuilt and audio is flowing again. */
    | { status: 'recovered'; attempt: number; message: string }
    /** The chosen microphone is gone; capture continues on the system default. */
    | { status: 'fell-back'; from: string; message: string }
    /** Rebuilding gave up; capture has stopped. */
    | { status: 'fatal'; message: string }

export type EngineEvent =
    | { type: 'started' }
    /** The engine stopped on its own. */
    | { type: 'ended' }
    | { type: 'result'; text: string; isFinal: boolean; segments?: EngineSegment[] }
    /** The engine stopped with an error. */
    | { type: 'failed'; error: ListeningError }
    | ({ type: 'capture' } & CaptureStatus)
    /** Speech started or stopped being heard (web speech only, so far). */
    | { type: 'speech'; active: boolean }

export interface EngineStartOptions {
    language: string
    captureSource?: 'microphone' | 'system'
    /** Browser deviceId or native device name. */
    microphoneDeviceId?: string
    /** 0-based input channel on a multi-channel interface (native only). */
    inputChannel?: number
    /** Vocabulary bias for the model (native only). */
    initialPrompt?: string
}

export interface TranscriptionEngine {
    readonly provider: TranscriptionProvider
    isAvailable(): Promise<boolean>
    /**
     * Start capturing. Resolves true once listening; events arrive through
     * `onEvent` from then on. A `stop()` that arrives while the start is still
     * in flight wins: the start then resolves false and nothing is started.
     */
    start(options: EngineStartOptions, onEvent: (event: EngineEvent) => void): Promise<boolean>
    stop(): Promise<void>
    /** Running or still shutting down — the question to ask before starting again. */
    isBusy(): boolean
}
