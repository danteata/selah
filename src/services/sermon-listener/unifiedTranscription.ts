/**
 * Unified Transcription Service
 *
 * Provides a unified interface for speech transcription that switches between
 * Web Speech API (browser) and Desktop Whisper (bundled sidecar) based on
 * user settings.
 *
 * Legacy providers (whisper, whisper-cpp, faster-whisper, elevenlabs) have
 * been removed from the union type and init/switch paths. The deprecated
 * service files are still in the repo for reference but are no longer
 * imported, so they can be tree-shaken out of the bundle.
 */

import { speechRecognitionService } from './speechRecognition'
import { desktopWhisperTranscriptionService } from './desktopWhisperTranscription'

export type TranscriptionProvider = 'web-speech' | 'desktop-whisper'

export interface UnifiedTranscriptionOptions {
  provider?: TranscriptionProvider
  language?: string
  /** Audio capture source: 'microphone' | 'system' */
  captureSource?: 'microphone' | 'system'
  /** Selected microphone device ID (browser deviceId or native device name) */
  microphoneDeviceId?: string
  continuous?: boolean
  interimResults?: boolean
  onStart?: () => void
  onEnd?: () => void
  onResult?: (transcript: string, isFinal: boolean, confidence?: number) => void
  onError?: (error: string, message?: string) => void
  onStatusChange?: (status: TranscriptionStatus) => void
  /** Called when speech is detected (VAD speech start) */
  onSpeechStart?: () => void
  /** Called when speech ends (VAD speech end) */
  onSpeechEnd?: () => void
  /** Called with audio level (0-1) for visualization */
  onAudioLevel?: (level: number) => void
  /** Enable VAD for smart chunking with desktop-whisper */
  useVAD?: boolean
  /** Initial prompt to bias transcription vocabulary (prevents offensive word hallucination) */
  initialPrompt?: string
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
 * Switches between Web Speech API and Desktop Whisper based on settings.
 */
class UnifiedTranscriptionService {
    private currentProvider: TranscriptionProvider = 'web-speech'
    private isListening = false
    private isReady = false
    private isLoading = false
    private error: string | null = null
    private options: UnifiedTranscriptionOptions = {}
    private desktopWhisperInitialized = false

    /**
     * Check if a provider is available
     */
    async isProviderAvailable(provider: TranscriptionProvider): Promise<boolean> {
        switch (provider) {
            case 'web-speech':
                return speechRecognitionService.isSupported()
            case 'desktop-whisper':
                return desktopWhisperTranscriptionService.isConfigured()
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
            modelLoaded: this.currentProvider === 'desktop-whisper'
                ? this.desktopWhisperInitialized
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

        if (provider === 'desktop-whisper') {
            this.isLoading = true
            this.options.onStatusChange?.(this.getStatus())

            const initialized = await desktopWhisperTranscriptionService.init({
                language: options?.language || 'en',
                useVAD: options?.useVAD,
                initialPrompt: options?.initialPrompt,
                microphoneDeviceId: options?.microphoneDeviceId,
                onProgress: options?.onProgress,
                onStatus: (status) => console.log('[DesktopWhisper]', status),
            })

            this.desktopWhisperInitialized = initialized
            this.isLoading = false
            this.isReady = initialized

            if (!initialized) {
                this.error = 'Failed to initialize Desktop Whisper. Make sure you are running in the desktop app.'
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
            : this.desktopWhisperInitialized
        this.options.onStatusChange?.(this.getStatus())
        return true
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
            if (this.currentProvider === 'desktop-whisper') {
                return await this.startDesktopWhisper()
            }
            return false
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
     * Start Desktop Whisper transcription (bundled faster-whisper in Tauri)
     */
    private async startDesktopWhisper(): Promise<boolean> {
        if (!this.desktopWhisperInitialized) {
            const initialized = await desktopWhisperTranscriptionService.init({
                language: this.options.language || 'en',
                useVAD: this.options.useVAD,
                initialPrompt: this.options.initialPrompt,
                microphoneDeviceId: this.options.microphoneDeviceId,
                onProgress: this.options.onProgress,
            })
            if (!initialized) {
                this.error = 'Desktop Whisper is only available in the desktop app.'
                return false
            }
            this.desktopWhisperInitialized = true
        }

        const started = await desktopWhisperTranscriptionService.startRealtimeTranscription(
            (result) => {
                this.options.onResult?.(result.text, true, undefined)
            },
            (error) => {
                this.error = error
                this.isListening = false
                this.options.onError?.(error)
                this.options.onStatusChange?.(this.getStatus())
            },
            undefined,
            this.options.captureSource
        )

        if (!started) {
            this.error = 'Failed to start Desktop Whisper transcription'
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
        } else if (this.currentProvider === 'desktop-whisper') {
            await desktopWhisperTranscriptionService.stop()
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
     * Get the active media stream from the current provider (for audio visualization)
     * Returns null for web-speech (manages streams internally)
     */
    getMediaStream(): MediaStream | null {
        switch (this.currentProvider) {
            case 'desktop-whisper':
                return desktopWhisperTranscriptionService.getMediaStream()
            default:
                return null
        }
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
