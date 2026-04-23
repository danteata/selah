/**
 * ElevenLabs Speech-to-Text Transcription Service
 *
 * This service provides chunked audio transcription using MediaRecorder
 * and the ElevenLabs Speech-to-Text API.
 *
 * Requires ELEVENLABS_API_KEY environment variable or runtime configuration.
 */

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/speech-to-text'

export interface ElevenLabsConfig {
  apiKey?: string
  modelId?: string
  language?: string
  chunkDurationMs?: number
  initialPrompt?: string
  onProgress?: (progress: number) => void
  onStatus?: (status: string) => void
}

export interface ElevenLabsTranscriptionResult {
    text: string
    language?: string
    language_probability?: number
    words?: Array<{
        word: string
        start: number
        end: number
        probability: number
    }>
}

interface ElevenLabsApiResponse {
    text?: string
    language?: string
    language_probability?: number
    words?: Array<{
        word: string
        start: number
        end: number
        probability: number
    }>
}

type ResultCallback = (result: ElevenLabsTranscriptionResult) => void
type ErrorCallback = (error: string) => void

class ElevenLabsTranscriptionService {
    private config: ElevenLabsConfig = {}
    private isInitialized = false
    private isInitializing = false
    private modelLoaded = false
    private mediaRecorder: MediaRecorder | null = null
    private mediaStream: MediaStream | null = null
    private processingQueue: Promise<void> = Promise.resolve()
    private isStreaming = false

    async init(config: ElevenLabsConfig = {}): Promise<boolean> {
        if (this.isInitializing) {
            while (this.isInitializing) {
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            return this.isInitialized
        }

        this.isInitializing = true
        this.config = {
            modelId: 'scribe_v1', // ElevenLabs default model for speech-to-text
            language: 'en',
            chunkDurationMs: 5000,
            ...this.config,
            ...config,
        }

        try {
            this.config.onStatus?.('Preparing ElevenLabs transcription service...')

            if (!this.hasApiKey()) {
                this.config.onStatus?.(
                    'ElevenLabs API key is not configured. Set ELEVENLABS_API_KEY environment variable.'
                )
                this.isInitialized = false
                this.modelLoaded = false
                return false
            }

            // Verify API key by making a simple request
            const isValid = await this.verifyApiKey()
            if (!isValid) {
                this.config.onStatus?.('Invalid ElevenLabs API key. Please check your credentials.')
                this.isInitialized = false
                this.modelLoaded = false
                return false
            }

            this.isInitialized = true
            this.modelLoaded = true
            this.config.onProgress?.(100)
            this.config.onStatus?.('ElevenLabs transcription service ready')
            return true
        } catch (error) {
            console.error('Failed to initialize ElevenLabs transcription service:', error)
            this.config.onStatus?.('Failed to initialize ElevenLabs transcription service')
            this.isInitialized = false
            this.modelLoaded = false
            return false
        } finally {
            this.isInitializing = false
        }
    }

    isAvailable(): boolean {
        return this.isInitialized && this.modelLoaded
    }

    isConfigured(): boolean {
        return this.hasApiKey()
    }

    async transcribeAudio(audioBlob: Blob): Promise<ElevenLabsTranscriptionResult | null> {
        if (!this.isAvailable()) {
            console.warn('ElevenLabs transcription service not initialized')
            return null
        }

        try {
            const response = await this.requestTranscription(audioBlob)
            return {
                text: (response.text || '').trim(),
                language: response.language || this.config.language,
                language_probability: response.language_probability,
                words: response.words,
            }
        } catch (error) {
            console.error('ElevenLabs transcription failed:', error)
            return null
        }
    }

    async startRealtimeTranscription(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs?: number
    ): Promise<boolean> {
        if (!this.isAvailable()) {
            onError('ElevenLabs transcription service is not initialized')
            return false
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            onError('MediaDevices API is not available in this browser')
            return false
        }

        if (this.isStreaming) {
            onError('Transcription stream already started')
            return false
        }

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    noiseSuppression: true,
                    echoCancellation: true,
                    autoGainControl: true,
                },
            })
        } catch {
            onError('Microphone permission is required for transcription')
            return false
        }

        try {
            const mimeType = this.getSupportedMimeType()
            this.mediaRecorder = mimeType
                ? new MediaRecorder(this.mediaStream, { mimeType })
                : new MediaRecorder(this.mediaStream)
        } catch (error) {
            console.error('Failed to create MediaRecorder:', error)
            onError('Unable to capture microphone audio in this browser')
            this.cleanupMedia()
            return false
        }

        this.isStreaming = true
        this.config.onStatus?.('ElevenLabs realtime transcription started')

        this.mediaRecorder.ondataavailable = (event) => {
            if (!event.data || event.data.size === 0) return

            // Process chunks in-order to keep transcript stable
            this.processingQueue = this.processingQueue
                .then(async () => {
                    const result = await this.transcribeAudio(event.data)
                    if (!result?.text) return
                    onResult(result)
                })
                .catch((error) => {
                    console.error('ElevenLabs realtime transcription chunk failed:', error)
                    onError('Failed to transcribe one of the audio chunks')
                })
        }

        this.mediaRecorder.onerror = () => {
            onError('Audio recorder encountered an error')
        }

        this.mediaRecorder.onstop = () => {
            this.isStreaming = false
            this.config.onStatus?.('ElevenLabs realtime transcription stopped')
            this.cleanupMedia()
        }

        this.mediaRecorder.start(chunkDurationMs || this.config.chunkDurationMs || 5000)
        return true
    }

    async stopRealtimeTranscription(): Promise<void> {
        if (!this.isStreaming) return

        try {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop()
            }
            await this.processingQueue
        } catch (error) {
            console.error('Failed to stop ElevenLabs transcription stream:', error)
        } finally {
            this.isStreaming = false
            this.cleanupMedia()
        }
    }

    free(): void {
        this.cleanupMedia()
        this.isInitialized = false
        this.modelLoaded = false
        this.isStreaming = false
        this.processingQueue = Promise.resolve()
    }

    private hasApiKey(): boolean {
        const apiKey = this.getApiKey()
        return Boolean(apiKey)
    }

    private getApiKey(): string | null {
        const apiKeyFromEnv = import.meta.env.VITE_ELEVENLABS_API_KEY as string | undefined
        return this.config.apiKey || apiKeyFromEnv || null
    }

    private async verifyApiKey(): Promise<boolean> {
        const apiKey = this.getApiKey()
        if (!apiKey) return false

        try {
            // Make a minimal request to verify the API key
            // We'll create a small silent audio blob for verification
            const silentAudio = this.createSilentAudio()
            const formData = new FormData()
            formData.append('audio', silentAudio, 'test.mp3')
            formData.append('model_id', this.config.modelId || 'scribe_v1')

            const response = await fetch(ELEVENLABS_API_URL, {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                },
                body: formData,
            })

            // Accept both 200 and 400 (bad audio) as valid API key responses
            // 401 would indicate invalid API key
            return response.status !== 401
        } catch (error) {
            // Network errors shouldn't fail initialization
            console.warn('Could not verify ElevenLabs API key:', error)
            return true // Allow initialization to proceed
        }
    }

    private createSilentAudio(): Blob {
        // Create a minimal valid MP3 file (silent, ~0.1 seconds)
        // This is a minimal MP3 frame with silence
        const mp3Header = new Uint8Array([
            0xFF, 0xFB, 0x90, 0x00, // MP3 frame header
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
        ])
        return new Blob([mp3Header], { type: 'audio/mpeg' })
    }

    private async requestTranscription(audioBlob: Blob): Promise<ElevenLabsApiResponse> {
        const apiKey = this.getApiKey()
        if (!apiKey) {
            throw new Error('ElevenLabs API key is not configured')
        }

        const modelId = this.config.modelId || 'scribe_v1'

        // Determine the file extension based on blob type
        const fileExtension = this.getFileExtension(audioBlob.type)
        const audioFile = new File([audioBlob], `sermon-chunk-${Date.now()}${fileExtension}`, {
            type: audioBlob.type || 'audio/webm',
        })

        const formData = new FormData()
        formData.append('audio', audioFile)
        formData.append('model_id', modelId)

    // Add language if specified
    if (this.config.language) {
      formData.append('language_code', this.config.language)
    }

    // Add initial prompt to bias transcription vocabulary
    // Note: ElevenLabs uses 'prompt' parameter for context/glossary
    if (this.config.initialPrompt) {
      formData.append('prompt', this.config.initialPrompt)
    }

    const response = await fetch(ELEVENLABS_API_URL, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
            },
            body: formData,
        })

        if (!response.ok) {
            const errorText = await response.text().catch(() => '')

            if (response.status === 401) {
                throw new Error('Invalid ElevenLabs API key')
            }
            if (response.status === 422) {
                throw new Error(`Invalid audio format or parameters: ${errorText}`)
            }
            if (response.status === 429) {
                throw new Error('ElevenLabs API rate limit exceeded. Please try again later.')
            }

            throw new Error(`ElevenLabs transcription request failed (${response.status}): ${errorText}`)
        }

        const responseBody = await response.json() as ElevenLabsApiResponse
        return responseBody
    }

    private getFileExtension(mimeType: string): string {
        const extensions: Record<string, string> = {
            'audio/webm': '.webm',
            'audio/webm;codecs=opus': '.webm',
            'audio/ogg': '.ogg',
            'audio/ogg;codecs=opus': '.ogg',
            'audio/mp4': '.m4a',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/x-wav': '.wav',
        }
        return extensions[mimeType] || '.webm'
    }

    private getSupportedMimeType(): string | null {
        const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/webm',
        ]

        for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                return mimeType
            }
        }

        return null
    }

    private cleanupMedia(): void {
        if (this.mediaRecorder) {
            this.mediaRecorder.ondataavailable = null
            this.mediaRecorder.onerror = null
            this.mediaRecorder.onstop = null
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop())
        }

        this.mediaRecorder = null
        this.mediaStream = null
    }
}

export const elevenLabsTranscriptionService = new ElevenLabsTranscriptionService()

export default elevenLabsTranscriptionService