/**
 * Whisper-style Transcription Service
 *
 * This service provides chunked audio transcription using MediaRecorder
 * and an OpenAI-compatible transcription endpoint.
 *
 * Runtime options:
 * 1. Set `VITE_TRANSCRIPTION_ENDPOINT` to your backend endpoint (recommended)
 * 2. Or provide `VITE_OPENAI_API_KEY` to call OpenAI directly (not recommended for production clients)
 */

const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'

export interface WhisperConfig {
    endpoint?: string
    apiKey?: string
    model?: string
    language?: string
    chunkDurationMs?: number
    microphoneDeviceId?: string
    onProgress?: (progress: number) => void
    onStatus?: (status: string) => void
}

export interface WhisperTranscriptionResult {
    text: string
    segments?: Array<{
        start: number
        end: number
        text: string
    }>
    language?: string
}

interface TranscriptionApiResponse {
    text?: string
    segments?: Array<{ start: number; end: number; text: string }>
    language?: string
}

type ResultCallback = (result: WhisperTranscriptionResult) => void
type ErrorCallback = (error: string) => void

class WhisperTranscriptionService {
    private config: WhisperConfig = {}
    private isInitialized = false
    private isInitializing = false
    private modelLoaded = false
    private mediaRecorder: MediaRecorder | null = null
    private mediaStream: MediaStream | null = null
    private processingQueue: Promise<void> = Promise.resolve()
    private isStreaming = false

    async init(config: WhisperConfig = {}): Promise<boolean> {
        if (this.isInitializing) {
            while (this.isInitializing) {
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            return this.isInitialized
        }

        this.isInitializing = true
        this.config = {
            model: 'whisper-1',
            language: 'en',
            chunkDurationMs: 5000,
            ...this.config,
            ...config,
        }

        try {
            this.config.onStatus?.('Preparing transcription service...')
            if (!this.hasTranscriptionTransport()) {
                this.config.onStatus?.(
                    'Transcription endpoint is not configured. Set VITE_TRANSCRIPTION_ENDPOINT or provide API credentials.'
                )
                this.isInitialized = false
                this.modelLoaded = false
                return false
            }

            this.isInitialized = true
            this.modelLoaded = true
            this.config.onProgress?.(100)
            this.config.onStatus?.('Transcription service ready')
            return true
        } catch (error) {
            console.error('Failed to initialize transcription service:', error)
            this.config.onStatus?.('Failed to initialize transcription service')
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
        return this.hasTranscriptionTransport()
    }

    async transcribeAudio(audioBlob: Blob): Promise<WhisperTranscriptionResult | null> {
        if (!this.isAvailable()) {
            console.warn('Transcription service not initialized')
            return null
        }

        try {
            const response = await this.requestTranscription(audioBlob)
            return {
                text: (response.text || '').trim(),
                segments: response.segments,
                language: response.language || this.config.language,
            }
        } catch (error) {
            console.error('Transcription failed:', error)
            return null
        }
    }

    async startRealtimeTranscription(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs?: number
    ): Promise<boolean> {
        if (!this.isAvailable()) {
            onError('Transcription service is not initialized')
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
            const audio = this.config.microphoneDeviceId
                ? { deviceId: { exact: this.config.microphoneDeviceId }, channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true }
                : { channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true }
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio })
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
        this.config.onStatus?.('Realtime transcription started')

        this.mediaRecorder.ondataavailable = (event) => {
            if (!event.data || event.data.size === 0) return

            // Process chunks in-order to keep transcript stable.
            this.processingQueue = this.processingQueue
                .then(async () => {
                    const result = await this.transcribeAudio(event.data)
                    if (!result?.text) return
                    onResult(result)
                })
                .catch((error) => {
                    console.error('Realtime transcription chunk failed:', error)
                    onError('Failed to transcribe one of the audio chunks')
                })
        }

        this.mediaRecorder.onerror = () => {
            onError('Audio recorder encountered an error')
        }

        this.mediaRecorder.onstop = () => {
            this.isStreaming = false
            this.config.onStatus?.('Realtime transcription stopped')
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
            console.error('Failed to stop transcription stream:', error)
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

    private hasTranscriptionTransport(): boolean {
        const endpoint = this.getEndpoint()
        const apiKey = this.getApiKey()
        return Boolean(endpoint || apiKey)
    }

    private getEndpoint(): string | null {
        const endpointFromEnv = import.meta.env.VITE_TRANSCRIPTION_ENDPOINT as string | undefined
        return this.config.endpoint || endpointFromEnv || null
    }

    private getApiKey(): string | null {
        const apiKeyFromEnv = import.meta.env.VITE_OPENAI_API_KEY as string | undefined
        return this.config.apiKey || apiKeyFromEnv || null
    }

    private async requestTranscription(audioBlob: Blob): Promise<TranscriptionApiResponse> {
        const endpoint = this.getEndpoint()
        const apiKey = this.getApiKey()

        const requestUrl = endpoint || DEFAULT_OPENAI_ENDPOINT
        const model = this.config.model || 'whisper-1'
        const language = this.config.language || 'en'

        const audioFile = new File([audioBlob], `sermon-chunk-${Date.now()}.webm`, {
            type: audioBlob.type || 'audio/webm',
        })

        const formData = new FormData()
        formData.append('file', audioFile)
        formData.append('model', model)
        formData.append('language', language)
        formData.append('response_format', 'json')

        const headers = new Headers()
        if (apiKey) {
            headers.set('Authorization', `Bearer ${apiKey}`)
        }

        const response = await fetch(requestUrl, {
            method: 'POST',
            headers,
            body: formData,
        })

        if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            throw new Error(`Transcription request failed (${response.status}): ${errorText}`)
        }

        const responseBody = await response.json() as TranscriptionApiResponse
        return responseBody
    }

    private getSupportedMimeType(): string | null {
        const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/ogg;codecs=opus',
            'audio/mp4',
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

export const whisperTranscriptionService = new WhisperTranscriptionService()

export default whisperTranscriptionService
