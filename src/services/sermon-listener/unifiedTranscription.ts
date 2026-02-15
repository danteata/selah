/**
 * Unified Transcription Service
 * 
 * Provides a unified interface for speech transcription that can switch between
 * Web Speech API and Whisper.cpp based on user settings.
 */

import { speechRecognitionService } from './speechRecognition'
import { whisperTranscriptionService } from './whisperTranscription'

export type TranscriptionProvider = 'web-speech' | 'whisper'

export interface UnifiedTranscriptionOptions {
    provider?: TranscriptionProvider
    language?: string
    continuous?: boolean
    interimResults?: boolean
    onStart?: () => void
    onEnd?: () => void
    onResult?: (transcript: string, isFinal: boolean, confidence?: number) => void
    onError?: (error: string, message?: string) => void
    onStatusChange?: (status: TranscriptionStatus) => void
    // Whisper-specific options
    whisperModel?: 'tiny' | 'base' | 'small' | 'medium'
    onProgress?: (progress: number) => void
}

export interface TranscriptionStatus {
    provider: TranscriptionProvider
    isListening: boolean
    isReady: boolean
    isLoading: boolean
    error: string | null
    modelLoaded?: boolean
}

/**
 * Unified Transcription Service
 * 
 * Switches between Web Speech API and Whisper.cpp based on settings
 */
class UnifiedTranscriptionService {
    private currentProvider: TranscriptionProvider = 'web-speech'
    private isListening = false
    private isReady = false
    private isLoading = false
    private error: string | null = null
    private options: UnifiedTranscriptionOptions = {}
    private whisperInitialized = false

    /**
     * Check if a provider is available
     */
    async isProviderAvailable(provider: TranscriptionProvider): Promise<boolean> {
        switch (provider) {
            case 'web-speech':
                return speechRecognitionService.isSupported()
            case 'whisper':
                // Whisper is always "available" but needs initialization
                return true
            default:
                return false
        }
    }

    /**
     * Get current status
     */
    getStatus(): TranscriptionStatus {
        return {
            provider: this.currentProvider,
            isListening: this.isListening,
            isReady: this.isReady,
            isLoading: this.isLoading,
            error: this.error,
            modelLoaded: this.currentProvider === 'whisper' ? this.whisperInitialized : undefined,
        }
    }

    /**
     * Set the transcription provider
     */
    async setProvider(provider: TranscriptionProvider, options?: UnifiedTranscriptionOptions): Promise<boolean> {
        if (this.isListening) {
            await this.stop()
        }

        this.currentProvider = provider
        this.options = { ...this.options, ...options }

        // Initialize Whisper if needed
        if (provider === 'whisper' && !this.whisperInitialized) {
            this.isLoading = true
            this.options.onStatusChange?.(this.getStatus())

            const initialized = await whisperTranscriptionService.init({
                modelUrl: this.getWhisperModelUrl(options?.whisperModel || 'base'),
                language: options?.language || 'en',
                onProgress: options?.onProgress,
                onStatus: (status) => console.log('[Whisper]', status),
            })

            this.whisperInitialized = initialized
            this.isLoading = false
            this.isReady = initialized

            if (!initialized) {
                this.error = 'Failed to initialize Whisper'
                this.options.onStatusChange?.(this.getStatus())
                return false
            }
        }

        this.isReady = true
        this.options.onStatusChange?.(this.getStatus())
        return true
    }

    /**
     * Get Whisper model URL based on model size
     */
    private getWhisperModelUrl(model: 'tiny' | 'base' | 'small' | 'medium'): string {
        const modelName = model === 'tiny' ? 'tiny.en' :
            model === 'base' ? 'base.en' :
                model === 'small' ? 'small.en' : 'medium.en'
        return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`
    }

    /**
     * Start transcription
     */
    async start(options?: UnifiedTranscriptionOptions): Promise<boolean> {
        if (this.isListening) {
            console.warn('Already listening')
            return false
        }

        if (options) {
            this.options = { ...this.options, ...options }
        }

        // Switch provider if specified
        if (options?.provider && options.provider !== this.currentProvider) {
            const switched = await this.setProvider(options.provider, options)
            if (!switched) return false
        }

        this.error = null
        this.options.onStatusChange?.(this.getStatus())

        try {
            if (this.currentProvider === 'web-speech') {
                return await this.startWebSpeech()
            } else {
                return await this.startWhisper()
            }
        } catch (err) {
            this.error = err instanceof Error ? err.message : 'Failed to start transcription'
            this.options.onStatusChange?.(this.getStatus())
            return false
        }
    }

    /**
     * Start Web Speech API transcription
     */
    private async startWebSpeech(): Promise<boolean> {
        const success = await speechRecognitionService.start({
            lang: this.options.language || 'en-US',
            continuous: this.options.continuous ?? true,
            interimResults: this.options.interimResults ?? true,
            onStart: () => {
                this.isListening = true
                this.options.onStart?.()
                this.options.onStatusChange?.(this.getStatus())
            },
            onEnd: () => {
                this.isListening = false
                this.options.onEnd?.()
                this.options.onStatusChange?.(this.getStatus())
            },
            onResult: (transcript, isFinal, confidence) => {
                this.options.onResult?.(transcript, isFinal, confidence)
            },
            onError: (error, _message) => {
                this.error = error
                this.isListening = false
                this.options.onError?.(error)
                this.options.onStatusChange?.(this.getStatus())
            },
        })

        return success
    }

    /**
     * Start Whisper transcription
     * Note: Whisper works differently - it processes audio chunks
     */
    private async startWhisper(): Promise<boolean> {
        if (!this.whisperInitialized) {
            const initialized = await whisperTranscriptionService.init({
                language: this.options.language || 'en',
                onProgress: this.options.onProgress,
            })
            if (!initialized) {
                this.error = 'Whisper not initialized'
                return false
            }
            this.whisperInitialized = true
        }

        // For Whisper, we need to set up audio recording
        // This is a simplified version - full implementation would use MediaRecorder
        this.isListening = true
        this.options.onStart?.()
        this.options.onStatusChange?.(this.getStatus())

        return true
    }

    /**
     * Stop transcription
     */
    async stop(): Promise<void> {
        if (!this.isListening) return

        if (this.currentProvider === 'web-speech') {
            speechRecognitionService.stop()
        } else {
            // Whisper cleanup if needed
        }

        this.isListening = false
        this.options.onEnd?.()
        this.options.onStatusChange?.(this.getStatus())
    }

    /**
     * Get the current provider
     */
    getProvider(): TranscriptionProvider {
        return this.currentProvider
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

    /**
     * Clear error
     */
    clearError(): void {
        this.error = null
        this.options.onStatusChange?.(this.getStatus())
    }

    /**
     * Get full transcript (for Web Speech API)
     */
    getFullTranscript(): string {
        if (this.currentProvider === 'web-speech') {
            return speechRecognitionService.getFullTranscript()
        }
        return ''
    }

    /**
     * Clear transcript
     */
    clearTranscript(): void {
        if (this.currentProvider === 'web-speech') {
            speechRecognitionService.clearTranscript()
        }
    }
}

// Export singleton
export const unifiedTranscriptionService = new UnifiedTranscriptionService()

export default unifiedTranscriptionService