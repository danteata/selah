/**
 * Speech Recognition Service for Web
 * Uses the Web Speech API for real-time transcription
 */

// Type definitions for Web Speech API
interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
    readonly length: number
    item(index: number): SpeechRecognitionResult
    [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
    readonly length: number
    readonly isFinal: boolean
    item(index: number): SpeechRecognitionAlternative
    [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
    readonly transcript: string
    readonly confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
}

interface SpeechRecognitionInterface extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    maxAlternatives: number
    onaudioend: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    onaudiostart: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    onend: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    onerror: ((this: SpeechRecognitionInterface, ev: SpeechRecognitionErrorEvent) => void) | null
    onnomatch: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    onresult: ((this: SpeechRecognitionInterface, ev: SpeechRecognitionEvent) => void) | null
    onsoundend: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    onsoundstart: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    onspeechend: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    onspeechstart: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    onstart: ((this: SpeechRecognitionInterface, ev: Event) => void) | null
    abort(): void
    start(): void
    stop(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInterface

// Extend Window interface
declare global {
    interface Window {
        SpeechRecognition?: SpeechRecognitionConstructor
        webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
}

export interface SpeechRecognitionOptions {
    /** Language code (e.g., 'en-US', 'es-ES') */
    lang?: string
    /** Return interim results as they come in */
    interimResults?: boolean
    /** Continue recognition after results */
    continuous?: boolean
    /** Maximum number of alternative transcriptions */
    maxAlternatives?: number
    /** Callback when recognition starts */
    onStart?: () => void
    /** Callback when recognition ends */
    onEnd?: () => void
    /** Callback for interim and final results */
    onResult?: (transcript: string, isFinal: boolean, confidence: number) => void
    /** Callback for errors */
    onError?: (error: string, message: string) => void
    /** Callback when speech is detected */
    onSpeechStart?: () => void
    /** Callback when speech ends */
    onSpeechEnd?: () => void
    /** Automatically restart on recoverable errors/end events */
    autoRestart?: boolean
    /** Maximum auto-restart attempts before stopping */
    maxRestartAttempts?: number
    /** Delay before auto-restart in milliseconds */
    restartDelayMs?: number
    /** Request microphone access before starting recognition */
    preflightMicPermission?: boolean
}

export interface SpeechRecognitionStatus {
    isListening: boolean
    isSupported: boolean
    currentTranscript: string
    interimTranscript: string
    error: string | null
}

/**
 * Speech Recognition Service Class
 * Wraps the Web Speech API for easier use
 */
export class SpeechRecognitionService {
    private recognition: SpeechRecognitionInterface | null = null
    private isListening = false
    private shouldBeListening = false
    private currentTranscript = ''
    private interimTranscript = ''
    private error: string | null = null
    private options: SpeechRecognitionOptions = {}
    private fullTranscript: string[] = []
    private restartAttempts = 0
    private restartTimer: number | null = null
    private consecutiveRecoverableErrors = 0

    constructor() {
        this.initialize()
    }

    /**
     * Check if Web Speech API is supported
     */
    isSupported(): boolean {
        return !!(
            window.SpeechRecognition ||
            window.webkitSpeechRecognition
        )
    }

    /**
     * Initialize the speech recognition instance
     */
    private initialize(): void {
        if (!this.isSupported()) {
            console.warn('Web Speech API is not supported in this browser')
            return
        }

        const SpeechRecognitionClass =
            window.SpeechRecognition || window.webkitSpeechRecognition

        this.recognition = new SpeechRecognitionClass!()
        this.setupDefaultHandlers()
    }

    /**
     * Set up default event handlers
     */
    private setupDefaultHandlers(): void {
        if (!this.recognition) return

        this.recognition.onstart = () => {
            this.isListening = true
            this.error = null
            this.restartAttempts = 0
            this.consecutiveRecoverableErrors = 0
            this.options.onStart?.()
        }

        this.recognition.onend = () => {
            this.isListening = false
            this.options.onEnd?.()

            if (this.shouldBeListening) {
                this.scheduleRestart('Recognition ended unexpectedly')
            }
        }

        this.recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = ''
            let finalTranscript = ''
            let confidence = 0

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i]
                const transcript = result[0].transcript

                if (result.isFinal) {
                    finalTranscript += transcript
                    confidence = result[0].confidence
                } else {
                    interimTranscript += transcript
                }
            }

            if (finalTranscript) {
                this.currentTranscript = finalTranscript
                this.fullTranscript.push(finalTranscript)
                this.options.onResult?.(finalTranscript, true, confidence)
            }

            const hadInterim = this.interimTranscript.length > 0
            this.interimTranscript = interimTranscript
            if (interimTranscript || hadInterim) {
                this.options.onResult?.(interimTranscript, false, 0)
            }
        }

        this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            const message = this.getErrorMessage(event.error, event.message)
            const recoverable = this.isRecoverableError(event.error)

            if (!recoverable) {
                this.error = message
            }
            this.isListening = false
            if (!this.shouldBeListening) {
                this.options.onError?.(event.error, message)
                return
            }

            if (!recoverable) {
                this.options.onError?.(event.error, message)
                return
            }

            this.consecutiveRecoverableErrors += 1
            const scheduled = this.scheduleRestart(`Speech recognition error: ${event.error}`)
            if (!scheduled) {
                const finalMessage = 'Speech recognition could not recover from network interruptions. Switch to Whisper.cpp offline mode or retry.'
                this.error = finalMessage
                this.options.onError?.(event.error, finalMessage)
            }
        }

        this.recognition.onspeechstart = () => {
            this.options.onSpeechStart?.()
        }

        this.recognition.onspeechend = () => {
            this.options.onSpeechEnd?.()
        }
    }

    /**
     * Configure speech recognition options
     */
    configure(options: SpeechRecognitionOptions): void {
        this.options = { ...this.options, ...options }

        if (!this.recognition) return

        if (options.lang !== undefined) {
            this.recognition.lang = options.lang
        }
        if (options.continuous !== undefined) {
            this.recognition.continuous = options.continuous
        }
        if (options.interimResults !== undefined) {
            this.recognition.interimResults = options.interimResults
        }
        if (options.maxAlternatives !== undefined) {
            this.recognition.maxAlternatives = options.maxAlternatives
        }
    }

    /**
     * Start speech recognition
     */
    async start(options?: SpeechRecognitionOptions): Promise<boolean> {
        if (!this.recognition) {
            console.error('Speech recognition not initialized')
            return false
        }

        if (this.isListening) {
            console.warn('Speech recognition already in progress')
            return false
        }

        // Apply options
        if (options) {
            this.configure(options)
        }

        // Set defaults
        this.recognition.lang = this.options.lang || 'en-US'
        this.recognition.continuous = this.options.continuous ?? true
        this.recognition.interimResults = this.options.interimResults ?? true
        this.recognition.maxAlternatives = this.options.maxAlternatives ?? 1

        // Reset state
        this.currentTranscript = ''
        this.interimTranscript = ''
        this.error = null
        this.shouldBeListening = true
        this.restartAttempts = 0
        this.consecutiveRecoverableErrors = 0
        this.clearRestartTimer()

        // Warm up mic permission to avoid browser-specific audio-capture/network failures
        if (this.options.preflightMicPermission !== false) {
            const permissionGranted = await this.ensureMicrophonePermission()
            if (!permissionGranted) {
                this.error = 'Microphone access is required. Please allow microphone permissions and try again.'
                this.shouldBeListening = false
                return false
            }
        }

        if (!this.isSecureContextForSpeech()) {
            this.error = 'Speech recognition requires a secure context (HTTPS or localhost).'
            this.shouldBeListening = false
            return false
        }

        try {
            this.recognition.start()
            return true
        } catch (err) {
            console.error('Failed to start speech recognition:', err)
            this.error = err instanceof Error ? err.message : 'Failed to start'
            this.shouldBeListening = false
            return false
        }
    }

    /**
     * Stop speech recognition
     */
    stop(): void {
        this.shouldBeListening = false
        this.clearRestartTimer()
        if (!this.recognition || !this.isListening) return

        try {
            this.recognition.stop()
        } catch (err) {
            console.error('Failed to stop speech recognition:', err)
        }
    }

    /**
     * Abort speech recognition immediately
     */
    abort(): void {
        this.shouldBeListening = false
        this.clearRestartTimer()
        if (!this.recognition) return

        try {
            this.recognition.abort()
            this.isListening = false
        } catch (err) {
            console.error('Failed to abort speech recognition:', err)
        }
    }

    /**
     * Get current status
     */
    getStatus(): SpeechRecognitionStatus {
        return {
            isListening: this.isListening,
            isSupported: this.isSupported(),
            currentTranscript: this.currentTranscript,
            interimTranscript: this.interimTranscript,
            error: this.error,
        }
    }

    /**
     * Get the full transcript history
     */
    getFullTranscript(): string {
        return this.fullTranscript.join(' ')
    }

    /**
     * Get recent transcript (last N characters)
     */
    getRecentTranscript(maxLength: number = 500): string {
        const full = this.getFullTranscript()
        if (full.length <= maxLength) return full
        return full.slice(-maxLength)
    }

    /**
     * Clear transcript history
     */
    clearTranscript(): void {
        this.fullTranscript = []
        this.currentTranscript = ''
        this.interimTranscript = ''
    }

    /**
     * Check if currently listening
     */
    getIsListening(): boolean {
        return this.isListening
    }

    /**
     * Get current error
     */
    getError(): string | null {
        return this.error
    }

    private clearRestartTimer(): void {
        if (this.restartTimer !== null) {
            window.clearTimeout(this.restartTimer)
            this.restartTimer = null
        }
    }

    private scheduleRestart(reason: string): boolean {
        if (!this.recognition) return false
        if (this.restartTimer !== null) return true
        if (this.options.autoRestart === false) return false

        const maxAttempts = this.options.maxRestartAttempts ?? 20
        if (this.restartAttempts >= maxAttempts) {
            this.shouldBeListening = false
            this.error = 'Speech recognition stopped after repeated connection errors. Please retry.'
            return false
        }

        const baseDelayMs = this.options.restartDelayMs ?? 600
        const exponentialFactor = Math.min(this.consecutiveRecoverableErrors, 6)
        const delayMs = Math.min(baseDelayMs * (2 ** exponentialFactor), 4500)
        this.restartAttempts += 1
        this.restartTimer = window.setTimeout(() => {
            this.restartTimer = null
            if (!this.shouldBeListening || this.isListening) return

            try {
                this.recognition?.start()
            } catch (err) {
                console.warn('Failed to auto-restart speech recognition:', reason, err)
                this.scheduleRestart('Auto-restart failed')
            }
        }, delayMs)
        return true
    }

    private isRecoverableError(error: string): boolean {
        return error === 'network' || error === 'no-speech'
    }

    private async ensureMicrophonePermission(): Promise<boolean> {
        if (!navigator.mediaDevices?.getUserMedia) return false

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            stream.getTracks().forEach((track) => track.stop())
            return true
        } catch {
            return false
        }
    }

    private isSecureContextForSpeech(): boolean {
        if (window.isSecureContext) return true

        const hostname = window.location.hostname
        return hostname === 'localhost' || hostname === '127.0.0.1'
    }

    private getErrorMessage(error: string, fallback?: string): string {
        switch (error) {
            case 'network':
                return 'Speech service network issue. Check internet and keep this tab active.'
            case 'no-speech':
                return 'No speech detected. Please speak closer to the microphone.'
            case 'audio-capture':
                return 'Microphone was not found or is already in use by another app.'
            case 'not-allowed':
            case 'service-not-allowed':
                return 'Microphone permission denied. Enable microphone access in browser settings.'
            case 'language-not-supported':
                return 'Selected recognition language is not supported by this browser.'
            default:
                return fallback || error || 'Speech recognition failed'
        }
    }
}

// Export singleton instance
export const speechRecognitionService = new SpeechRecognitionService()

// Export for custom instances if needed
export default speechRecognitionService
