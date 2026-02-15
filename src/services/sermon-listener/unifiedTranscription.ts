/**
 * Unified Transcription Service
 * 
 * Provides a unified interface for speech transcription that can switch between
 * Web Speech API and Whisper.cpp based on user settings.
 */

import { speechRecognitionService } from './speechRecognition'
import { whisperTranscriptionService } from './whisperTranscription'
import { whisperCppTranscriptionService } from './whisperCppTranscription'

export type TranscriptionProvider = 'web-speech' | 'whisper' | 'whisper-cpp'

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
    whisperEndpoint?: string
    whisperApiKey?: string
    whisperChunkDurationMs?: number
    whisperCppEndpoint?: string
    whisperCppChunkDurationMs?: number
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
    private whisperCppInitialized = false

    /**
     * Check if a provider is available
     */
    async isProviderAvailable(provider: TranscriptionProvider): Promise<boolean> {
        switch (provider) {
            case 'web-speech':
                return speechRecognitionService.isSupported()
            case 'whisper':
                return whisperTranscriptionService.isConfigured()
            case 'whisper-cpp':
                return whisperCppTranscriptionService.isConfigured()
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
            modelLoaded: this.currentProvider === 'whisper'
                ? this.whisperInitialized
                : this.currentProvider === 'whisper-cpp'
                    ? this.whisperCppInitialized
                    : undefined,
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

        // Initialize Whisper provider
        if (provider === 'whisper') {
            this.isLoading = true
            this.options.onStatusChange?.(this.getStatus())

            const initialized = await whisperTranscriptionService.init({
                language: options?.language || 'en',
                endpoint: options?.whisperEndpoint,
                apiKey: options?.whisperApiKey,
                model: this.getWhisperModelName(options?.whisperModel || 'base'),
                chunkDurationMs: options?.whisperChunkDurationMs,
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

        if (provider === 'whisper-cpp') {
            this.isLoading = true
            this.options.onStatusChange?.(this.getStatus())

            const initialized = await whisperCppTranscriptionService.init({
                language: options?.language || 'en',
                endpoint: options?.whisperCppEndpoint,
                chunkDurationMs: options?.whisperCppChunkDurationMs,
                onProgress: options?.onProgress,
                onStatus: (status) => console.log('[Whisper.cpp]', status),
            })

            this.whisperCppInitialized = initialized
            this.isLoading = false
            this.isReady = initialized

            if (!initialized) {
                this.error = 'Failed to initialize Whisper.cpp'
                this.options.onStatusChange?.(this.getStatus())
                return false
            }
        }

        if (provider === 'web-speech' && !speechRecognitionService.isSupported()) {
            this.error = 'Web Speech API is not supported in this browser'
            this.isReady = false
            this.options.onStatusChange?.(this.getStatus())
            return false
        }

        this.isReady = provider === 'web-speech'
            ? speechRecognitionService.isSupported()
            : provider === 'whisper'
                ? this.whisperInitialized
                : this.whisperCppInitialized
        this.options.onStatusChange?.(this.getStatus())
        return true
    }

    /**
     * Map size aliases to OpenAI-compatible model names
     */
    private getWhisperModelName(model: 'tiny' | 'base' | 'small' | 'medium'): string {
        // Keep existing setting options stable while mapping them to widely-supported API model names.
        if (model === 'tiny') return 'whisper-1'
        if (model === 'small') return 'whisper-1'
        if (model === 'medium') return 'whisper-1'
        return 'whisper-1'
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
            }
            if (this.currentProvider === 'whisper') {
                return await this.startWhisper()
            }
            return await this.startWhisperCpp()
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
            onError: (error, message) => {
                this.error = message || error
                this.isListening = false
                this.options.onError?.(error, message)
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
                endpoint: this.options.whisperEndpoint,
                apiKey: this.options.whisperApiKey,
                model: this.getWhisperModelName(this.options.whisperModel || 'base'),
                chunkDurationMs: this.options.whisperChunkDurationMs,
                onProgress: this.options.onProgress,
            })
            if (!initialized) {
                this.error = 'Whisper transcription is not configured. Set a transcription endpoint first.'
                return false
            }
            this.whisperInitialized = true
        }

        const started = await whisperTranscriptionService.startRealtimeTranscription(
            (result) => {
                this.options.onResult?.(result.text, true, undefined)
            },
            (error) => {
                this.error = error
                this.isListening = false
                this.options.onError?.(error)
                this.options.onStatusChange?.(this.getStatus())
            },
            this.options.whisperChunkDurationMs
        )

        if (!started) {
            this.error = 'Failed to start Whisper transcription stream'
            this.options.onStatusChange?.(this.getStatus())
            return false
        }

        this.isListening = true
        this.options.onStart?.()
        this.options.onStatusChange?.(this.getStatus())
        return true
    }

    /**
     * Start whisper.cpp local transcription
     */
    private async startWhisperCpp(): Promise<boolean> {
        if (!this.whisperCppInitialized) {
            const initialized = await whisperCppTranscriptionService.init({
                language: this.options.language || 'en',
                endpoint: this.options.whisperCppEndpoint,
                chunkDurationMs: this.options.whisperCppChunkDurationMs,
                onProgress: this.options.onProgress,
            })
            if (!initialized) {
                this.error = 'Whisper.cpp provider is not configured correctly.'
                return false
            }
            this.whisperCppInitialized = true
        }

        const started = await whisperCppTranscriptionService.startRealtimeTranscription(
            (result) => {
                this.options.onResult?.(result.text, true, undefined)
            },
            (error) => {
                this.error = error
                this.isListening = false
                this.options.onError?.(error)
                this.options.onStatusChange?.(this.getStatus())
            },
            this.options.whisperCppChunkDurationMs
        )

        if (!started) {
            this.error = 'Failed to start Whisper.cpp transcription stream'
            this.options.onStatusChange?.(this.getStatus())
            return false
        }

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
        } else if (this.currentProvider === 'whisper') {
            await whisperTranscriptionService.stopRealtimeTranscription()
        } else {
            await whisperCppTranscriptionService.stopRealtimeTranscription()
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
