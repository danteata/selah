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

class WhisperCppTranscriptionService {
    private config: WhisperCppConfig = {}
    private isInitialized = false
    private isInitializing = false
    private modelLoaded = false
    private mediaRecorder: MediaRecorder | null = null
    private mediaStream: MediaStream | null = null
    private isStreaming = false
    // AudioContext-based capture (replaces MediaRecorder for raw PCM)
    private audioContext: AudioContext | null = null
    private scriptProcessor: ScriptProcessorNode | null = null
    private audioBuffer: Float32Array[] = []
    // Track active requests for parallel processing (max 2 concurrent)
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

        // Use AudioContext to capture raw PCM data instead of MediaRecorder
        // MediaRecorder produces webm/opus which decodeAudioData can't decode
        try {
            // Create AudioContext at 16kHz to match whisper.cpp's expected sample rate
            // This eliminates the need for resampling and improves audio quality
            const targetSampleRate = 16000
            try {
                this.audioContext = new AudioContext({ sampleRate: targetSampleRate })
            } catch {
                // Fallback to default sample rate if 16kHz is not supported
                console.warn('[Whisper.cpp] 16kHz AudioContext not supported, using native sample rate')
                this.audioContext = new AudioContext()
            }
            const nativeSampleRate = this.audioContext.sampleRate
            const needsResampling = nativeSampleRate !== targetSampleRate

            console.log('[Whisper.cpp] AudioContext sample rate:', nativeSampleRate, needsResampling ? '(will resample to 16kHz)' : '(optimal - no resampling needed)')

            const source = this.audioContext.createMediaStreamSource(this.mediaStream)

            // Buffer to accumulate audio samples
            this.audioBuffer = []
            const chunkDuration = chunkDurationMs || this.config.chunkDurationMs || DEFAULT_CHUNK_DURATION_MS
            // Calculate samples based on the AudioContext's actual sample rate
            const samplesPerChunk = nativeSampleRate * (chunkDuration / 1000)

            // Use ScriptProcessorNode to capture raw PCM data
            // Note: ScriptProcessorNode is deprecated but AudioWorklet requires more complex setup
            const bufferSize = 4096
            this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1)

            this.scriptProcessor.onaudioprocess = (event) => {
                if (!this.isStreaming) return

                const inputData = event.inputBuffer.getChannelData(0)
                // Copy the data since it's reused by the browser
                this.audioBuffer.push(new Float32Array(inputData))

                // Check if we have enough samples for a chunk
                const totalSamples = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0)

                if (totalSamples >= samplesPerChunk) {
                    // Combine all buffered samples
                    const combined = new Float32Array(totalSamples)
                    let offset = 0
                    for (const chunk of this.audioBuffer) {
                        combined.set(chunk, offset)
                        offset += chunk.length
                    }

                    // Clear the buffer
                    this.audioBuffer = []

                    // Process the chunk in parallel (up to max concurrent requests)
                    if (this.activeRequests < this.maxConcurrentRequests) {
                        this.activeRequests++
                        this.processChunkAsync(combined, nativeSampleRate, targetSampleRate, needsResampling, onResult, onError)
                            .finally(() => {
                                this.activeRequests--
                            })
                    } else {
                        // Skip this chunk if we're at max capacity (prevents memory buildup)
                        console.log('[Whisper.cpp] Skipping chunk - max concurrent requests reached')
                    }
                }
            }

            source.connect(this.scriptProcessor)
            this.scriptProcessor.connect(this.audioContext.destination)

            this.isStreaming = true
            this.config.onStatus?.('whisper.cpp realtime transcription started')
            console.log('[Whisper.cpp] Started audio capture via AudioContext')

            return true
        } catch (error) {
            console.error('[Whisper.cpp] Failed to setup audio capture:', error)
            onError('Failed to initialize audio capture')
            this.cleanupMedia()
            return false
        }
    }

    async stopRealtimeTranscription(): Promise<void> {
        if (!this.isStreaming) return

        this.isStreaming = false

        try {
            // Disconnect ScriptProcessorNode
            if (this.scriptProcessor) {
                this.scriptProcessor.disconnect()
                this.scriptProcessor.onaudioprocess = null
            }

            // Close AudioContext
            if (this.audioContext && this.audioContext.state !== 'closed') {
                await this.audioContext.close()
            }

            // Wait for active requests to complete (with timeout)
            const maxWait = 5000
            const startTime = Date.now()
            while (this.activeRequests > 0 && Date.now() - startTime < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100))
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
     * Process a chunk asynchronously (allows parallel processing)
     */
    private async processChunkAsync(
        combined: Float32Array,
        nativeSampleRate: number,
        targetSampleRate: number,
        needsResampling: boolean,
        onResult: ResultCallback,
        onError: ErrorCallback
    ): Promise<void> {
        try {
            // Check audio level
            const maxAmp = this.getMaxAmplitude(combined)
            console.log('[Whisper.cpp] Audio level:', maxAmp.toFixed(4), '| Samples:', combined.length, '| Sample rate:', nativeSampleRate, needsResampling ? '(resampling...)' : '(no resampling)')

            // Resample only if needed (when AudioContext couldn't be set to 16kHz)
            const resampled = needsResampling
                ? this.resample(combined, nativeSampleRate, targetSampleRate)
                : combined

            // Convert to WAV
            const wavBlob = this.encodeWav(resampled, targetSampleRate)
            console.log('[Whisper.cpp] Sending chunk:', {
                nativeSamples: combined.length,
                resampledSamples: resampled.length,
                duration: (resampled.length / targetSampleRate).toFixed(2) + 's',
                size: wavBlob.size,
            })

            const result = await this.transcribeWav(wavBlob)
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
     * Convert audio blob to WAV format (16kHz, 16-bit, mono)
     * whisper.cpp server expects WAV format, not webm/opus
     */
    private async convertToWav(audioBlob: Blob): Promise<Blob> {
        let audioContext: AudioContext | null = null
        try {
            // Create audio context - the sampleRate here is for output, not decoding
            audioContext = new AudioContext()
            const arrayBuffer = await audioBlob.arrayBuffer()
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

            // Get the original sample rate and samples
            const originalSampleRate = audioBuffer.sampleRate
            const originalLength = audioBuffer.length

            console.log('[Whisper.cpp] Decoded audio:', {
                originalSampleRate,
                originalLength,
                duration: (originalLength / originalSampleRate).toFixed(2) + 's',
                channels: audioBuffer.numberOfChannels,
            })

            // Get mono channel data (whisper expects mono)
            const channelData = audioBuffer.numberOfChannels > 1
                ? this.mixToMono(audioBuffer)
                : audioBuffer.getChannelData(0)

            // Check for silent audio
            const maxAmplitude = this.getMaxAmplitude(channelData)
            console.log('[Whisper.cpp] Max amplitude:', maxAmplitude.toFixed(4))

            if (maxAmplitude < 0.01) {
                console.warn('[Whisper.cpp] Audio appears to be silent or very quiet')
            }

            // Resample to 16kHz if needed
            const targetSampleRate = 16000
            let resampledData: Float32Array

            if (originalSampleRate !== targetSampleRate) {
                resampledData = this.resample(channelData, originalSampleRate, targetSampleRate)
                console.log('[Whisper.cpp] Resampled to 16kHz:', resampledData.length, 'samples')
            } else {
                resampledData = channelData
            }

            // Convert to 16-bit PCM WAV
            const wavBlob = this.encodeWav(resampledData, targetSampleRate)

            await audioContext.close()
            return wavBlob
        } catch (error) {
            console.error('[Whisper.cpp] Failed to convert audio to WAV:', error)
            if (audioContext) {
                await audioContext.close().catch(() => { })
            }
            throw new Error(`Failed to convert audio to WAV: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
    }

    /**
     * Get the maximum amplitude from audio samples
     */
    private getMaxAmplitude(samples: Float32Array): number {
        let max = 0
        for (let i = 0; i < samples.length; i++) {
            const abs = Math.abs(samples[i])
            if (abs > max) max = abs
        }
        return max
    }

    /**
     * Resample audio data using cubic interpolation for better quality
     * This reduces artifacts that can affect transcription accuracy
     */
    private resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
        const ratio = fromRate / toRate
        const newLength = Math.round(samples.length / ratio)
        const result = new Float32Array(newLength)

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio
            const srcIndexFloor = Math.floor(srcIndex)
            const fraction = srcIndex - srcIndexFloor

            // Cubic interpolation using 4-point Hermite
            const y0 = samples[Math.max(0, srcIndexFloor - 1)]
            const y1 = samples[srcIndexFloor]
            const y2 = samples[Math.min(srcIndexFloor + 1, samples.length - 1)]
            const y3 = samples[Math.min(srcIndexFloor + 2, samples.length - 1)]

            // Hermite interpolation coefficients
            const c0 = y1
            const c1 = 0.5 * (y2 - y0)
            const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
            const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)

            result[i] = ((c3 * fraction + c2) * fraction + c1) * fraction + c0
        }

        return result
    }

    /**
     * Mix multiple channels to mono
     */
    private mixToMono(audioBuffer: AudioBuffer): Float32Array {
        const length = audioBuffer.length
        const result = new Float32Array(length)
        const numChannels = audioBuffer.numberOfChannels

        for (let i = 0; i < length; i++) {
            let sum = 0
            for (let channel = 0; channel < numChannels; channel++) {
                sum += audioBuffer.getChannelData(channel)[i]
            }
            result[i] = sum / numChannels
        }

        return result
    }

    /**
     * Encode Float32Array audio data to WAV Blob
     */
    private encodeWav(samples: Float32Array, sampleRate: number): Blob {
        const buffer = new ArrayBuffer(44 + samples.length * 2)
        const view = new DataView(buffer)

        // WAV header
        this.writeString(view, 0, 'RIFF')
        view.setUint32(4, 36 + samples.length * 2, true)
        this.writeString(view, 8, 'WAVE')
        this.writeString(view, 12, 'fmt ')
        view.setUint32(16, 16, true) // Subchunk1Size (16 for PCM)
        view.setUint16(20, 1, true) // AudioFormat (1 for PCM)
        view.setUint16(22, 1, true) // NumChannels (1 for mono)
        view.setUint32(24, sampleRate, true) // SampleRate
        view.setUint32(28, sampleRate * 2, true) // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
        view.setUint16(32, 2, true) // BlockAlign (NumChannels * BitsPerSample/8)
        view.setUint16(34, 16, true) // BitsPerSample
        this.writeString(view, 36, 'data')
        view.setUint32(40, samples.length * 2, true) // Subchunk2Size

        // Write PCM samples
        this.floatTo16BitPCM(view, 44, samples)

        return new Blob([buffer], { type: 'audio/wav' })
    }

    private writeString(view: DataView, offset: number, str: string): void {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i))
        }
    }

    private floatTo16BitPCM(view: DataView, offset: number, samples: Float32Array): void {
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]))
            view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
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

        // Clean up AudioContext/ScriptProcessor (new approach)
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect()
            this.scriptProcessor.onaudioprocess = null
            this.scriptProcessor = null
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
}

export const whisperCppTranscriptionService = new WhisperCppTranscriptionService()

export default whisperCppTranscriptionService
