/**
 * Whisper.cpp Local Transcription Service
 *
 * This provider sends microphone chunks to a local whisper.cpp server endpoint.
 * It is intended for fully offline on-device transcription when whisper.cpp is
 * running on the same machine.
 */

const DEFAULT_WHISPER_CPP_ENDPOINT = '/whisper-cpp/inference' // Use Vite proxy to avoid CORS
const DIRECT_ENDPOINT = 'http://127.0.0.1:8080/inference' // Direct access when not using proxy
const DEFAULT_CHUNK_DURATION_MS = 2500 // Reduced from 5000ms for faster feedback
const REQUEST_TIMEOUT_MS = 15000 // Timeout for transcription requests

export interface WhisperCppConfig {
  endpoint?: string
  language?: string
  chunkDurationMs?: number
  initialPrompt?: string
  microphoneDeviceId?: string
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
    transcription?: Array<{
        text: string
        timestamps?: {
            from: string
            to: string
        }
    }>
}

type ResultCallback = (result: WhisperCppTranscriptionResult) => void
type ErrorCallback = (error: string) => void

// ---------------------------------------------------------------------------
// WAV Encoding Web Worker singleton
// ---------------------------------------------------------------------------

interface WavWorkerRequest {
    id: number
    type: 'encodeChunk' | 'convertBlob'
    samples?: Float32Array
    nativeSampleRate?: number
    targetSampleRate?: number
    needsResampling?: boolean
    audioBlob?: Blob
}

interface WavWorkerSuccess {
    id: number
    wavBlob: Blob
    maxAmplitude?: number
    resampledSamples?: number
    nativeSamples?: number
    duration?: number
}

interface WavWorkerError {
    id: number
    error: string
}

type WavWorkerResponse = WavWorkerSuccess | WavWorkerError

let wavWorkerInstance: Worker | null = null
let wavWorkerNextId = 0
const wavWorkerPending = new Map<
    number,
    { resolve: (v: WavWorkerSuccess) => void; reject: (e: Error) => void }
>()

function getWavWorker(): Worker {
    if (wavWorkerInstance) return wavWorkerInstance
    wavWorkerInstance = new Worker(new URL('./wav.worker.ts', import.meta.url), {
        type: 'module',
    })
    wavWorkerInstance.onmessage = (event: MessageEvent<WavWorkerResponse>) => {
        const res = event.data
        const handler = wavWorkerPending.get(res.id)
        if (!handler) return
        wavWorkerPending.delete(res.id)
        if ('error' in res) {
            handler.reject(new Error(res.error))
        } else {
            handler.resolve(res)
        }
    }
    wavWorkerInstance.onerror = (err) => {
        console.error('[Whisper.cpp] WAV worker error:', err)
        for (const [, h] of wavWorkerPending) {
            h.reject(new Error('WAV worker failed'))
        }
        wavWorkerPending.clear()
    }
    return wavWorkerInstance
}

function postToWavWorker(req: Omit<WavWorkerRequest, 'id'>): Promise<WavWorkerSuccess> {
    const worker = getWavWorker()
    const id = ++wavWorkerNextId
    return new Promise((resolve, reject) => {
        wavWorkerPending.set(id, { resolve, reject })
        worker.postMessage({ id, ...req } as WavWorkerRequest)
    })
}

class WhisperCppTranscriptionService {
    private config: WhisperCppConfig = {}
    private isInitialized = false
    private isInitializing = false
    private modelLoaded = false
    private mediaRecorder: MediaRecorder | null = null
    private mediaStream: MediaStream | null = null
    private isStreaming = false
    private audioContext: AudioContext | null = null
    private workletNode: AudioWorkletNode | null = null
    private audioBuffer: Float32Array[] = []
    private activeRequests = 0
    private readonly maxConcurrentRequests = 2

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
            chunkDurationMs: DEFAULT_CHUNK_DURATION_MS,
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
                const errorMsg = `whisper.cpp server not reachable at ${endpoint}. Please ensure the server is running (try 'npm run whisper:start').`
                console.error(errorMsg)
                this.config.onStatus?.(errorMsg)
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
            const audio = this.config.microphoneDeviceId
                ? { deviceId: { exact: this.config.microphoneDeviceId }, channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true }
                : { channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true }
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio })
        } catch {
            onError('Microphone permission is required for whisper.cpp transcription')
            return false
        }

        // Use AudioContext + AudioWorklet to capture raw PCM data
        // AudioWorklet runs on the audio rendering thread, not the main thread
        try {
            const targetSampleRate = 16000
            try {
                this.audioContext = new AudioContext({ sampleRate: targetSampleRate })
            } catch {
                console.warn('[Whisper.cpp] 16kHz AudioContext not supported, using native sample rate')
                this.audioContext = new AudioContext()
            }
            const nativeSampleRate = this.audioContext.sampleRate
            const needsResampling = nativeSampleRate !== targetSampleRate

            console.log('[Whisper.cpp] AudioContext sample rate:', nativeSampleRate, needsResampling ? '(will resample in worker)' : '(optimal - no resampling needed)')

            const source = this.audioContext.createMediaStreamSource(this.mediaStream)

            this.audioBuffer = []
            const chunkDuration = chunkDurationMs || this.config.chunkDurationMs || DEFAULT_CHUNK_DURATION_MS
            const samplesPerChunk = nativeSampleRate * (chunkDuration / 1000)

            // Inline AudioWorklet that accumulates samples and posts full chunks back
            const workletCode = `
                class WhisperCaptureProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.buffer = [];
                        this.samplesPerChunk = ${samplesPerChunk};
                        this.targetSampleRate = ${targetSampleRate};
                        this.nativeSampleRate = ${nativeSampleRate};
                    }
                    process(inputs, outputs, parameters) {
                        const input = inputs[0];
                        if (input.length > 0) {
                            const channelData = input[0];
                            // Copy data because the underlying buffer is reused
                            const copy = new Float32Array(channelData.length);
                            for (let i = 0; i < channelData.length; i++) {
                                copy[i] = channelData[i];
                            }
                            this.buffer.push(copy);

                            const totalSamples = this.buffer.reduce((sum, arr) => sum + arr.length, 0);
                            if (totalSamples >= this.samplesPerChunk) {
                                const combined = new Float32Array(totalSamples);
                                let offset = 0;
                                for (const chunk of this.buffer) {
                                    combined.set(chunk, offset);
                                    offset += chunk.length;
                                }
                                this.buffer = [];
                                this.port.postMessage({
                                    samples: combined,
                                    nativeSampleRate: this.nativeSampleRate,
                                    targetSampleRate: this.targetSampleRate,
                                    needsResampling: this.nativeSampleRate !== this.targetSampleRate,
                                });
                            }
                        }
                        return true;
                    }
                }
                registerProcessor('whisper-capture-processor', WhisperCaptureProcessor);
            `;

            const workletBlob = new Blob([workletCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(workletBlob);
            await this.audioContext.audioWorklet.addModule(workletUrl);
            URL.revokeObjectURL(workletUrl);

            this.workletNode = new AudioWorkletNode(this.audioContext, 'whisper-capture-processor');
            this.workletNode.port.onmessage = (event) => {
                if (!this.isStreaming) return;
                const { samples, nativeSampleRate, targetSampleRate, needsResampling } = event.data;
                if (this.activeRequests < this.maxConcurrentRequests) {
                    this.activeRequests++;
                    this.processChunkAsync(samples, nativeSampleRate, targetSampleRate, needsResampling, onResult, onError)
                        .finally(() => {
                            this.activeRequests--;
                        });
                } else {
                    console.log('[Whisper.cpp] Skipping chunk - max concurrent requests reached');
                }
            };

            source.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);

            this.isStreaming = true;
            this.config.onStatus?.('whisper.cpp realtime transcription started');
            console.log('[Whisper.cpp] Started audio capture via AudioWorklet');

            return true;
        } catch (error) {
            console.error('[Whisper.cpp] Failed to setup audio capture:', error);
            onError('Failed to initialize audio capture');
            this.cleanupMedia();
            return false;
        }
    }

    async stopRealtimeTranscription(): Promise<void> {
        if (!this.isStreaming) return

        this.isStreaming = false

        try {
            // Disconnect AudioWorkletNode
            if (this.workletNode) {
                this.workletNode.disconnect()
                this.workletNode.port.onmessage = null
            }

            // Close AudioContext
            if (this.audioContext && this.audioContext.state !== 'closed') {
                await this.audioContext.close()
            }

            // Wait for active requests to complete (with timeout)
            const maxWait = 5000
            const startTime = Date.now()
            while (this.activeRequests > 0 && Date.now() - startTime < maxWait) {
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
        } catch (error) {
            console.error('[Whisper.cpp] Failed to stop transcription:', error)
        } finally {
            this.cleanupMedia()
        }
    }

    free(): void {
        this.cleanupMedia()
        this.isInitialized = false
        this.modelLoaded = false
        this.isStreaming = false
        this.activeRequests = 0
        this.audioBuffer = []
    }

    /**
     * Process a chunk asynchronously (offloads WAV encoding to worker)
     */
    private async processChunkAsync(
        samples: Float32Array,
        nativeSampleRate: number,
        targetSampleRate: number,
        needsResampling: boolean,
        onResult: ResultCallback,
        onError: ErrorCallback,
    ): Promise<void> {
        try {
            const workerResult = await postToWavWorker({
                type: 'encodeChunk',
                samples,
                nativeSampleRate,
                targetSampleRate,
                needsResampling,
            })

            console.log('[Whisper.cpp] Worker returned chunk:', {
                nativeSamples: workerResult.nativeSamples,
                resampledSamples: workerResult.resampledSamples,
                duration: workerResult.duration?.toFixed(2) + 's',
                size: workerResult.wavBlob.size,
                maxAmplitude: workerResult.maxAmplitude?.toFixed(4),
            })

            if ((workerResult.maxAmplitude ?? 0) < 0.01) {
                console.warn('[Whisper.cpp] Audio appears to be silent or very quiet')
            }

            const result = await this.transcribeWav(workerResult.wavBlob)
            if (result?.text) {
                onResult(result)
            }
        } catch (error) {
            console.error('[Whisper.cpp] Chunk processing failed:', error)
            onError('Failed to process audio chunk')
        }
    }

    private getEndpoint(): string {
        const endpointFromEnv = import.meta.env.VITE_WHISPER_CPP_ENDPOINT as string | undefined
        const configured = this.config.endpoint || endpointFromEnv || DEFAULT_WHISPER_CPP_ENDPOINT
        // If using direct URL (127.0.0.1), switch to proxy path for CORS avoidance
        if (configured.startsWith('http://127.0.0.1') || configured.startsWith('http://localhost')) {
            return DEFAULT_WHISPER_CPP_ENDPOINT // Use proxy
        }
        return configured.trim()
    }

    /**
     * Transcribe a WAV blob directly (already in correct format)
     */
    private async transcribeWav(wavBlob: Blob): Promise<WhisperCppTranscriptionResult | null> {
        const endpoint = this.getEndpoint()
        const language = this.config.language || 'en'

        const file = new File([wavBlob], `whispercpp-chunk-${Date.now()}.wav`, {
            type: 'audio/wav',
        })

    const formData = new FormData()
    formData.append('file', file)
    formData.append('language', language)

    // Add initial prompt to bias transcription toward church vocabulary
    if (this.config.initialPrompt) {
      formData.append('initial_prompt', this.config.initialPrompt)
    }

    // Create abort controller for timeout
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                const errorText = await response.text().catch(() => '')
                console.error('[Whisper.cpp] Request failed:', response.status, errorText)
                return null
            }

            const responseText = await response.text()
            console.log('[Whisper.cpp] Raw response:', responseText.substring(0, 500))

            // Try to parse as JSON
            try {
                const json = JSON.parse(responseText) as WhisperCppResponse
                const text = this.extractTextFromResponse(json)
                if (text) {
                    console.log('[Whisper.cpp] Parsed text:', text.substring(0, 100))
                    return { text, language: json.language || language }
                }
            } catch {
                // Not JSON
            }

            // Plain text response
            const rawText = responseText.trim()
            if (rawText) {
                console.log('[Whisper.cpp] Plain text response:', rawText.substring(0, 100))
                return { text: rawText, language }
            }

            return null
        } catch (error) {
            clearTimeout(timeoutId)
            if (error instanceof Error && error.name === 'AbortError') {
                console.error('[Whisper.cpp] Request timed out after', REQUEST_TIMEOUT_MS, 'ms')
            } else {
                console.error('[Whisper.cpp] Transcription error:', error)
            }
            return null
        }
    }

    private async requestTranscription(audioBlob: Blob): Promise<{ text: string; language?: string }> {
        const endpoint = this.getEndpoint()
        const language = this.config.language || 'en'

        // Convert audio to WAV format - whisper.cpp expects WAV, not webm/opus
        const wavBlob = await this.convertToWav(audioBlob)

        console.log('[Whisper.cpp] Sending WAV blob:', {
            size: wavBlob.size,
            type: wavBlob.type,
        })

        const file = new File([wavBlob], `whispercpp-chunk-${Date.now()}.wav`, {
            type: 'audio/wav',
        })

    const formData = new FormData()
    formData.append('file', file)
    formData.append('language', language)
    // Request JSON output for easier parsing
    formData.append('response_format', 'json')

    // Add initial prompt to bias transcription toward church vocabulary
    if (this.config.initialPrompt) {
      formData.append('initial_prompt', this.config.initialPrompt)
    }

    const response = await fetch(endpoint, {
            method: 'POST',
            body: formData,
        })

        if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            console.error('[Whisper.cpp] Request failed:', response.status, errorText)
            throw new Error(`whisper.cpp endpoint failed (${response.status}): ${errorText}`)
        }

        const responseText = await response.text()
        console.log('[Whisper.cpp] Raw response:', responseText.substring(0, 500))

        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
            try {
                const json = JSON.parse(responseText) as WhisperCppResponse
                const text = this.extractTextFromResponse(json)
                console.log('[Whisper.cpp] Parsed text:', text.substring(0, 100))
                return {
                    text,
                    language: json.language || language,
                }
            } catch (e) {
                console.error('[Whisper.cpp] Failed to parse JSON:', e)
            }
        }

        // Try to parse as JSON anyway (some servers don't set content-type correctly)
        try {
            const json = JSON.parse(responseText) as WhisperCppResponse
            const text = this.extractTextFromResponse(json)
            if (text) {
                console.log('[Whisper.cpp] Parsed text from JSON:', text.substring(0, 100))
                return { text, language }
            }
        } catch {
            // Not JSON, treat as plain text
        }

        const rawText = responseText.trim()
        console.log('[Whisper.cpp] Plain text response:', rawText.substring(0, 100))
        return {
            text: rawText,
            language,
        }
    }

    /**
     * Extract text from whisper.cpp response format
     */
    private extractTextFromResponse(json: WhisperCppResponse): string {
        // Direct text field
        if (json.text) return json.text.trim()
        // Result field
        if (json.result) return json.result.trim()
        // Transcription array (from --output-json flag)
        if (json.transcription && Array.isArray(json.transcription)) {
            return json.transcription
                .map((seg) => seg.text)
                .join(' ')
                .trim()
        }
        return ''
    }

    /**
     * Convert audio blob to WAV format (offloaded to Web Worker)
     * whisper.cpp server expects WAV format, not webm/opus
     */
    private async convertToWav(audioBlob: Blob): Promise<Blob> {
        try {
            const result = await postToWavWorker({ type: 'convertBlob', audioBlob })
            return result.wavBlob
        } catch (error) {
            console.error('[Whisper.cpp] Worker WAV conversion failed:', error)
            throw new Error(
                `Failed to convert audio to WAV: ${error instanceof Error ? error.message : 'Unknown error'}`,
            )
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
        // Clean up MediaRecorder (legacy)
        if (this.mediaRecorder) {
            this.mediaRecorder.ondataavailable = null
            this.mediaRecorder.onerror = null
            this.mediaRecorder.onstop = null
        }

        // Clean up AudioContext/AudioWorklet
        if (this.workletNode) {
            this.workletNode.disconnect()
            this.workletNode.port.onmessage = null
            this.workletNode = null
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(() => { })
            this.audioContext = null
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop())
        }

        this.mediaRecorder = null
        this.mediaStream = null
        this.audioBuffer = []
    }

    getMediaStream(): MediaStream | null {
        return this.mediaStream
    }
}

export const whisperCppTranscriptionService = new WhisperCppTranscriptionService()

export default whisperCppTranscriptionService
