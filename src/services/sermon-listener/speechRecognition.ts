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
    private currentTranscript = ''
    private interimTranscript = ''
    private error: string | null = null
    private options: SpeechRecognitionOptions = {}
    private fullTranscript: string[] = []

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
            this.options.onStart?.()
        }

        this.recognition.onend = () => {
            this.isListening = false
            // Save final transcript
            if (this.currentTranscript) {
                this.fullTranscript.push(this.currentTranscript)
            }
            this.options.onEnd?.()
        }

        this.recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = ''
            let finalTranscript = ''

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i]
                const transcript = result[0].transcript

                if (result.isFinal) {
                    finalTranscript += transcript
                } else {
                    interimTranscript += transcript
                }
            }

            if (finalTranscript) {
                this.currentTranscript = finalTranscript
                this.fullTranscript.push(finalTranscript)
                this.options.onResult?.(finalTranscript, true, event.results[event.resultIndex][0].confidence)
            }

            if (interimTranscript) {
                this.interimTranscript = interimTranscript
                this.options.onResult?.(interimTranscript, false, 0)
            }
        }

        this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            this.error = event.error
            this.isListening = false
            this.options.onError?.(event.error, event.message)
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
        if (!this.recognition.lang) {
            this.recognition.lang = 'en-US'
        }
        if (this.recognition.continuous === undefined) {
            this.recognition.continuous = true
        }
        if (this.recognition.interimResults === undefined) {
            this.recognition.interimResults = true
        }

        // Reset state
        this.currentTranscript = ''
        this.interimTranscript = ''
        this.error = null

        try {
            this.recognition.start()
            return true
        } catch (err) {
            console.error('Failed to start speech recognition:', err)
            this.error = err instanceof Error ? err.message : 'Failed to start'
            return false
        }
    }

    /**
     * Stop speech recognition
     */
    stop(): void {
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
}

// Export singleton instance
export const speechRecognitionService = new SpeechRecognitionService()

// Export for custom instances if needed
export default speechRecognitionService