/**
 * Whisper.cpp Local Transcription Service
 *
 * This provider sends microphone chunks to a local whisper.cpp server endpoint.
 * It is intended for fully offline on-device transcription when whisper.cpp is
 * running on the same machine.
 */

const DEFAULT_WHISPER_CPP_ENDPOINT = 'http://127.0.0.1:8080/inference'

export interface WhisperCppConfig {
    endpoint?: string
    language?: string
    chunkDurationMs?: number
    onProgress?: (progress: number) => void
    onStatus?: (status: string) => void
}

export interface WhisperCppTranscriptionResult {
    text: string
    language?: string
}

interface WhisperCppResponse {
    text?: string
    result?: string
    language?: string
}

type ResultCallback = (result: WhisperCppTranscriptionResult) => void
type ErrorCallback = (error: string) => void

class WhisperCppTranscriptionService {
    private config: WhisperCppConfig = {}
    private isInitialized = false
    private isInitializing = false
    private modelLoaded = false
    private mediaRecorder: MediaRecorder | null = null
    private mediaStream: MediaStream | null = null
    private processingQueue: Promise<void> = Promise.resolve()
    private isStreaming = false

    async init(config: WhisperCppConfig = {}): Promise<boolean> {
        if (this.isInitializing) {
            while (this.isInitializing) {
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            return this.isInitialized
        }

        this.isInitializing = true
        this.config = {
            endpoint: DEFAULT_WHISPER_CPP_ENDPOINT,
            language: 'en',
            chunkDurationMs: 5000,
            ...this.config,
            ...config,
        }

        try {
            this.config.onStatus?.('Preparing whisper.cpp local provider...')

            // Verify the whisper.cpp server is actually running
            const endpoint = this.getEndpoint()
            this.config.onStatus?.(`Checking connection to ${endpoint}...`)

            const isServerRunning = await this.checkServerHealth(endpoint)

            if (!isServerRunning) {
                console.error('whisper.cpp server is not reachable at', endpoint)
                this.config.onStatus?.(`whisper.cpp server not reachable at ${endpoint}. Please ensure the server is running.`)
                this.isInitialized = false
                this.modelLoaded = false
                return false
            }

            this.isInitialized = true
            this.modelLoaded = true
            this.config.onProgress?.(100)
            this.config.onStatus?.('whisper.cpp local provider ready')
            return true
        } catch (error) {
            console.error('Failed to initialize whisper.cpp provider:', error)
            this.config.onStatus?.('Failed to initialize whisper.cpp provider')
            this.isInitialized = false
            this.modelLoaded = false
            return false
        } finally {
            this.isInitializing = false
        }
    }

    /**
     * Check if the whisper.cpp server is running and reachable
     */
    private async checkServerHealth(endpoint: string): Promise<boolean> {
        try {
            // Try to reach the server with a HEAD request or GET to the base URL
            // whisper.cpp server responds to GET on / with basic info
            const baseUrl = endpoint.replace(/\/inference$/, '')
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000)

            try {
                const response = await fetch(baseUrl, {
                    method: 'GET',
                    signal: controller.signal,
                })
                clearTimeout(timeoutId)
                return response.ok || response.status === 404 // 404 means server is running but no root handler
            } catch {
                clearTimeout(timeoutId)
                // Try the full endpoint with a minimal request
                const controller2 = new AbortController()
                const timeoutId2 = setTimeout(() => controller2.abort(), 5000)

                try {
                    // Some whisper.cpp builds only respond to POST /inference
                    await fetch(endpoint, {
                        method: 'POST',
                        body: new FormData(),
                        signal: controller2.signal,
                    })
                    clearTimeout(timeoutId2)
                    return true
                } catch {
                    clearTimeout(timeoutId2)
                    return false
                }
            }
        } catch (error) {
            console.error('Health check failed:', error)
            return false
        }
    }

    isAvailable(): boolean {
        return this.isInitialized && this.modelLoaded
    }

    isConfigured(): boolean {
        return Boolean(this.getEndpoint())
    }

    async transcribeAudio(audioBlob: Blob): Promise<WhisperCppTranscriptionResult | null> {
        if (!this.isAvailable()) {
            console.warn('whisper.cpp service not initialized')
            return null
        }

        try {
            const response = await this.requestTranscription(audioBlob)
            return {
                text: response.text,
                language: response.language || this.config.language,
            }
        } catch (error) {
            console.error('whisper.cpp transcription failed:', error)
            return null
        }
    }

    async startRealtimeTranscription(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs?: number
    ): Promise<boolean> {
        if (!this.isAvailable()) {
            onError('whisper.cpp service is not initialized')
            return false
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            onError('MediaDevices API is not available in this browser')
            return false
        }

        if (this.isStreaming) {
            onError('whisper.cpp stream already started')
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
            onError('Microphone permission is required for whisper.cpp transcription')
            return false
        }

        try {
            const mimeType = this.getSupportedMimeType()
            this.mediaRecorder = mimeType
                ? new MediaRecorder(this.mediaStream, { mimeType })
                : new MediaRecorder(this.mediaStream)
        } catch (error) {
            console.error('Failed to create MediaRecorder for whisper.cpp:', error)
            onError('Unable to capture microphone audio for whisper.cpp')
            this.cleanupMedia()
            return false
        }

        this.isStreaming = true
        this.config.onStatus?.('whisper.cpp realtime transcription started')

        this.mediaRecorder.ondataavailable = (event) => {
            if (!event.data || event.data.size === 0) return

            this.processingQueue = this.processingQueue
                .then(async () => {
                    const result = await this.transcribeAudio(event.data)
                    if (!result?.text) return
                    onResult(result)
                })
                .catch((error) => {
                    console.error('whisper.cpp chunk processing failed:', error)
                    onError('Failed to process whisper.cpp audio chunk')
                })
        }

        this.mediaRecorder.onerror = () => {
            onError('whisper.cpp audio recorder error')
        }

        this.mediaRecorder.onstop = () => {
            this.isStreaming = false
            this.config.onStatus?.('whisper.cpp realtime transcription stopped')
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
            console.error('Failed to stop whisper.cpp transcription:', error)
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

    private getEndpoint(): string {
        const endpointFromEnv = import.meta.env.VITE_WHISPER_CPP_ENDPOINT as string | undefined
        return (this.config.endpoint || endpointFromEnv || DEFAULT_WHISPER_CPP_ENDPOINT).trim()
    }

    private async requestTranscription(audioBlob: Blob): Promise<{ text: string; language?: string }> {
        const endpoint = this.getEndpoint()
        const language = this.config.language || 'en'

        const file = new File([audioBlob], `whispercpp-chunk-${Date.now()}.webm`, {
            type: audioBlob.type || 'audio/webm',
        })

        const formData = new FormData()
        formData.append('file', file)
        formData.append('language', language)

        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData,
        })

        if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            throw new Error(`whisper.cpp endpoint failed (${response.status}): ${errorText}`)
        }

        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
            const json = await response.json() as WhisperCppResponse
            const text = (json.text || json.result || '').trim()
            return {
                text,
                language: json.language || language,
            }
        }

        const rawText = (await response.text()).trim()
        return {
            text: rawText,
            language,
        }
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

export const whisperCppTranscriptionService = new WhisperCppTranscriptionService()

export default whisperCppTranscriptionService
