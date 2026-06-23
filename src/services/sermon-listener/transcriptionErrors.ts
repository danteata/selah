/**
 * Structured Transcription Error Codes
 *
 * Categorizes transcription errors into user errors (action needed),
 * retryable errors (auto-retry), and internal errors (show details).
 *
 * Inspired by Vibe's SonaApiError taxonomy but adapted for Selah's
 * dual web/desktop architecture.
 */

export const transcriptionErrorCodes = {
    SERVER_NOT_RUNNING: 'server_not_running',
    SERVER_BUSY: 'server_busy',
    SERVER_CRASHED: 'server_crashed',
    MODEL_NOT_FOUND: 'model_not_found',
    NETWORK_TIMEOUT: 'network_timeout',
    INVALID_AUDIO: 'invalid_audio',
    MICROPHONE_DENIED: 'microphone_denied',
    MICROPHONE_NOT_FOUND: 'mic_not_found',
    VAD_LOAD_FAILED: 'vad_load_failed',
    TRANSCRIPTION_TIMEOUT: 'transcription_timeout',
    INTERNAL_ERROR: 'internal_error',
} as const

export type TranscriptionErrorCode = typeof transcriptionErrorCodes[keyof typeof transcriptionErrorCodes]

export type UserErrorCode = 'invalid_audio' | 'microphone_denied' | 'mic_not_found' | 'model_not_found' | 'vad_load_failed'
export type RetryableErrorCode = 'server_not_running' | 'server_busy' | 'server_crashed' | 'network_timeout' | 'transcription_timeout'

const USER_ERRORS: Set<string> = new Set([
    transcriptionErrorCodes.INVALID_AUDIO,
    transcriptionErrorCodes.MICROPHONE_DENIED,
    transcriptionErrorCodes.MICROPHONE_NOT_FOUND,
    transcriptionErrorCodes.MODEL_NOT_FOUND,
    transcriptionErrorCodes.VAD_LOAD_FAILED,
])

const RETRYABLE_ERRORS: Set<string> = new Set([
    transcriptionErrorCodes.SERVER_NOT_RUNNING,
    transcriptionErrorCodes.SERVER_BUSY,
    transcriptionErrorCodes.SERVER_CRASHED,
    transcriptionErrorCodes.NETWORK_TIMEOUT,
    transcriptionErrorCodes.TRANSCRIPTION_TIMEOUT,
])

export function isUserError(code: string): boolean {
    return USER_ERRORS.has(code)
}

export function isRetryableError(code: string): boolean {
    return RETRYABLE_ERRORS.has(code)
}

export function getMaxRetries(code: string): number {
    if (!isRetryableError(code)) return 0
    switch (code) {
        case transcriptionErrorCodes.SERVER_NOT_RUNNING:
        case transcriptionErrorCodes.SERVER_CRASHED:
            return 3
        case transcriptionErrorCodes.NETWORK_TIMEOUT:
        case transcriptionErrorCodes.TRANSCRIPTION_TIMEOUT:
            return 5
        case transcriptionErrorCodes.SERVER_BUSY:
            return 2
        default:
            return 3
    }
}

export function getUserAction(code: string): string | null {
    switch (code) {
        case transcriptionErrorCodes.MICROPHONE_DENIED: {
            // Desktop users don't have a "browser settings" page — the
            // failure happens at the OS layer (Windows Privacy /
            // macOS Privacy & Security) and the WebView can't surface
            // a prompt on its own. Tailor the message to the runtime.
            const isDesktop =
                typeof window !== 'undefined' && '__TAURI__' in window
            return isDesktop
                ? "Open your OS settings and grant microphone access to Selah. On Windows: Settings → Privacy & security → Microphone. On macOS: System Settings → Privacy & Security → Microphone."
                : 'Grant microphone permission in your browser settings.'
        }
        case transcriptionErrorCodes.MICROPHONE_NOT_FOUND:
            return 'Connect a microphone and try again.'
        case transcriptionErrorCodes.MODEL_NOT_FOUND:
            return 'Download the whisper model in settings.'
        case transcriptionErrorCodes.VAD_LOAD_FAILED:
            return 'Check your internet connection (VAD model needs to download once).'
        case transcriptionErrorCodes.INVALID_AUDIO:
            return 'Audio format not supported. Try a different input.'
        default:
            return null
    }
}

export class TranscriptionError extends Error {
    code: TranscriptionErrorCode
    retryable: boolean
    userAction: string | null

    constructor(code: TranscriptionErrorCode, message: string) {
        super(message)
        this.name = 'TranscriptionError'
        this.code = code
        this.retryable = isRetryableError(code)
        this.userAction = getUserAction(code)
    }
}

export class RetryableTranscriptionError extends TranscriptionError {
    attempt: number
    maxRetries: number

    constructor(code: TranscriptionErrorCode, message: string, attempt: number, maxRetries: number) {
        super(code, message)
        this.name = 'RetryableTranscriptionError'
        this.attempt = attempt
        this.maxRetries = maxRetries
    }
}

export class UserTranscriptionError extends TranscriptionError {
    constructor(code: TranscriptionErrorCode, message: string) {
        super(code, message)
        this.name = 'UserTranscriptionError'
    }
}

/**
 * Classify an error from the transcription pipeline into a structured code.
 */
export function classifyTranscriptionError(error: unknown): TranscriptionErrorCode {
    if (error instanceof TranscriptionError) {
        return error.code
    }

    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()

    if (lower.includes('permission') || lower.includes('notallowederror') || lower.includes('not allowed')) {
        return transcriptionErrorCodes.MICROPHONE_DENIED
    }
    if (lower.includes('notfounderror') || lower.includes('no audio') || lower.includes('requested device not found')) {
        return transcriptionErrorCodes.MICROPHONE_NOT_FOUND
    }
    if (lower.includes('model not found') || lower.includes('no model') || lower.includes('model not loaded')) {
        return transcriptionErrorCodes.MODEL_NOT_FOUND
    }
    if (lower.includes('vad') && (lower.includes('load') || lower.includes('failed') || lower.includes('timeout'))) {
        return transcriptionErrorCodes.VAD_LOAD_FAILED
    }
    if (lower.includes('failed to fetch') || lower.includes('could not connect') || lower.includes('networkerror') || lower.includes('err_network')) {
        return transcriptionErrorCodes.SERVER_NOT_RUNNING
    }
    if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('aborted')) {
        return transcriptionErrorCodes.TRANSCRIPTION_TIMEOUT
    }
    if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('internal server error')) {
        return transcriptionErrorCodes.SERVER_CRASHED
    }
    if (lower.includes('invalid audio') || lower.includes('bad format') || lower.includes('unsupported audio')) {
        return transcriptionErrorCodes.INVALID_AUDIO
    }

    return transcriptionErrorCodes.INTERNAL_ERROR
}