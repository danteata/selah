/**
 * Faster-Whisper Transcription Service
 *
 * Uses faster-whisper (CTranslate2-based) for 2-4x faster transcription
 * compared to original whisper.cpp. Uses AudioContext for direct PCM capture
 * and encodes to WAV format for server compatibility.
 *
 * @see https://github.com/SYSTRAN/faster-whisper
 * @see https://github.com/colabora/faster-whisper-server
 */

const DEFAULT_FASTER_WHISPER_ENDPOINT = '/faster-whisper' // Use Vite proxy to avoid CORS
const DIRECT_ENDPOINT = 'http://127.0.0.1:8000' // Direct access when not using proxy
const DEFAULT_CHUNK_DURATION_MS = 3000 // 3 seconds for better context and less hallucination
const REQUEST_TIMEOUT_MS = 20000 // 20 seconds - base.en processes fast enough

export interface FasterWhisperConfig {
    endpoint?: string
    language?: string
    model?: string // Full model ID like 'Systran/faster-whisper-base.en' or short name like 'base'
    chunkDurationMs?: number
    onProgress?: (progress: number) => void
    onStatus?: (status: string) => void
    vadFilter?: boolean // Enable Voice Activity Detection to filter silence
    hotwords?: string // Biblical terms to improve recognition
}

// Biblical hotwords to improve recognition of religious terms
const DEFAULT_HOTWORDS = [
    // Names of God
    'Yahweh', 'Jehovah', 'Elohim', 'Adonai', 'El Shaddai',
    // Biblical names
    'Jesus', 'Christ', 'Messiah', 'Yeshua',
    'Abraham', 'Isaac', 'Jacob', 'Moses', 'David', 'Solomon',
    'Peter', 'Paul', 'John', 'James', 'Matthew', 'Luke', 'Mark',
    'Mary', 'Martha', 'Lazarus', 'Joseph', 'Daniel', 'Elijah', 'Elisha',
    'Isaiah', 'Jeremiah', 'Ezekiel', 'Noah', 'Adam', 'Eve', 'Sarah', 'Rebekah',
    // Biblical places
    'Jerusalem', 'Bethlehem', 'Nazareth', 'Galilee', 'Jordan', 'Sinai',
    'Canaan', 'Egypt', 'Babylon', 'Bethany', 'Capernaum', 'Samaria',
    // Biblical terms
    'Psalm', 'Psalms', 'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
    'Gospel', 'Gospels', 'Epistle', 'Epistles', 'Revelation', 'Apocalypse',
    'Covenant', 'Testament', 'Parable', 'Miracle', 'Resurrection', 'Crucifixion',
    'Salvation', 'Redemption', 'Righteousness', 'Sanctification', 'Justification',
    'Amen', 'Hallelujah', 'Hosanna', 'Maranatha',
    // Church terms
    'Sermon', 'Homily', 'Congregation', 'Parishioner', 'Sacrament',
    'Baptism', 'Eucharist', 'Communion', 'Liturgy', 'Doxology',
].join(',')

// Model name mapping: short name -> full HuggingFace model ID
const MODEL_ID_MAP: Record<string, string> = {
    'tiny': 'Systran/faster-whisper-tiny',
    'tiny.en': 'Systran/faster-whisper-tiny.en',
    'base': 'Systran/faster-whisper-base',
    'base.en': 'Systran/faster-whisper-base.en',
    'small': 'Systran/faster-whisper-small',
    'small.en': 'Systran/faster-whisper-small.en',
    'medium': 'Systran/faster-whisper-medium',
    'medium.en': 'Systran/faster-whisper-medium.en',
    'large-v1': 'Systran/faster-whisper-large-v1',
    'large-v2': 'Systran/faster-whisper-large-v2',
    'large-v3': 'Systran/faster-whisper-large-v3',
    'distil-large-v3': 'Systran/faster-distil-whisper-large-v3',
}

export interface FasterWhisperTranscriptionResult {
    text: string
    language?: string
    segments?: Array<{
        start: number
        end: number
        text: string
    }>
}

interface FasterWhisperResponse {
    text?: string
    language?: string
    segments?: Array<{
        start: number
        end: number
        text: string
    }>
}

type ResultCallback = (result: FasterWhisperTranscriptionResult) => void
type ErrorCallback = (error: string) => void

class FasterWhisperTranscriptionService {
    private config: FasterWhisperConfig = {}
    private isInitialized = false
    private isInitializing = false
    private mediaStream: MediaStream | null = null
    private isStreaming = false
    private audioContext: AudioContext | null = null
    private scriptProcessor: ScriptProcessorNode | null = null
    private audioBuffer: Float32Array[] = []
    private activeRequests = 0
    private readonly maxConcurrentRequests = 3 // Higher since faster-whisper is more efficient

    async init(config: FasterWhisperConfig = {}): Promise<boolean> {
        if (this.isInitializing) {
            while (this.isInitializing) {
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            return this.isInitialized
        }

        this.isInitializing = true
        this.config = {
            endpoint: DEFAULT_FASTER_WHISPER_ENDPOINT,
            language: 'en',
            model: 'Systran/faster-whisper-base.en', // Default to base.en for faster processing on CPU
            chunkDurationMs: DEFAULT_CHUNK_DURATION_MS,
            vadFilter: true, // Enable VAD to filter silence and reduce hallucinations
            hotwords: DEFAULT_HOTWORDS, // Biblical terms for better recognition
            ...this.config,
            ...config,
        }

        try {
            this.config.onStatus?.('Preparing faster-whisper provider...')

            const endpoint = this.getEndpoint()
            this.config.onStatus?.(`Checking connection to ${endpoint}...`)

            const isServerRunning = await this.checkServerHealth(endpoint)

            if (!isServerRunning) {
                const errorMsg = `faster-whisper server not reachable at ${endpoint}. Please ensure the server is running.`
                console.error(errorMsg)
                this.config.onStatus?.(errorMsg)
                this.isInitialized = false
                return false
            }

            this.isInitialized = true
            this.config.onProgress?.(100)
            this.config.onStatus?.('faster-whisper provider ready')
            return true
        } catch (error) {
            console.error('Failed to initialize faster-whisper provider:', error)
            this.config.onStatus?.('Failed to initialize faster-whisper provider')
            this.isInitialized = false
            return false
        } finally {
            this.isInitializing = false
        }
    }

    /**
     * Check if the faster-whisper server is running
     */
    private async checkServerHealth(endpoint: string): Promise<boolean> {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000)

            // speaches has /health endpoint that returns "OK"
            const response = await fetch(`${endpoint}/health`, {
                method: 'GET',
                signal: controller.signal,
            })
            clearTimeout(timeoutId)

            // Check if response is ok (status 200) or returns "OK" text
            if (response.ok) return true

            const text = await response.text().catch(() => '')
            if (text === 'OK') return true

            return false
        } catch {
            // Try OpenAI-compatible endpoint as fallback
            try {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 5000)

                const response = await fetch(`${endpoint}/v1/models`, {
                    method: 'GET',
                    signal: controller.signal,
                })
                clearTimeout(timeoutId)
                return response.ok
            } catch {
                return false
            }
        }
    }

    isAvailable(): boolean {
        return this.isInitialized
    }

    isConfigured(): boolean {
        return Boolean(this.getEndpoint())
    }

    async transcribeAudio(audioBlob: Blob): Promise<FasterWhisperTranscriptionResult | null> {
        if (!this.isAvailable()) {
            console.warn('faster-whisper service not initialized')
            return null
        }

        try {
            // Convert to WAV if needed (speaches only supports mp3, flac, wav)
            const wavBlob = await this.convertToWav(audioBlob)
            const response = await this.requestTranscription(wavBlob)
            return {
                text: response.text,
                language: response.language || this.config.language,
                segments: response.segments,
            }
        } catch (error) {
            console.error('faster-whisper transcription failed:', error)
            return null
        }
    }

    async startRealtimeTranscription(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs?: number
    ): Promise<boolean> {
        if (!this.isAvailable()) {
            onError('faster-whisper service is not initialized')
            return false
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            onError('MediaDevices API is not available in this browser')
            return false
        }

        if (this.isStreaming) {
            onError('faster-whisper stream already started')
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
            // Create AudioContext with 16kHz sample rate (optimal for speech recognition)
            const targetSampleRate = 16000
            try {
                this.audioContext = new AudioContext({ sampleRate: targetSampleRate })
            } catch {
                console.warn('[FasterWhisper] 16kHz AudioContext not supported, using native sample rate')
                this.audioContext = new AudioContext()
            }
            const nativeSampleRate = this.audioContext.sampleRate
            const needsResampling = nativeSampleRate !== targetSampleRate

            console.log('[FasterWhisper] AudioContext sample rate:', nativeSampleRate,
                needsResampling ? '(will resample to 16kHz)' : '(optimal)')

            const source = this.audioContext.createMediaStreamSource(this.mediaStream)

            this.audioBuffer = []
            const chunkDuration = chunkDurationMs || this.config.chunkDurationMs || DEFAULT_CHUNK_DURATION_MS
            const samplesPerChunk = nativeSampleRate * (chunkDuration / 1000)

            // Use ScriptProcessorNode for audio capture
            // Note: AudioWorklet is the modern replacement but ScriptProcessor is more widely supported
            const bufferSize = 4096
            this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1)

            this.scriptProcessor.onaudioprocess = (event) => {
                if (!this.isStreaming) return

                const inputData = event.inputBuffer.getChannelData(0)
                this.audioBuffer.push(new Float32Array(inputData))

                const totalSamples = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0)

                if (totalSamples >= samplesPerChunk) {
                    // Combine all buffered chunks
                    const combined = new Float32Array(totalSamples)
                    let offset = 0
                    for (const chunk of this.audioBuffer) {
                        combined.set(chunk, offset)
                        offset += chunk.length
                    }

                    // Clear buffer
                    this.audioBuffer = []

                    // Process the chunk
                    if (this.activeRequests < this.maxConcurrentRequests) {
                        this.activeRequests++
                        this.processChunkAsync(combined, nativeSampleRate, targetSampleRate, needsResampling, onResult, onError)
                            .finally(() => {
                                this.activeRequests--
                            })
                    }
                }
            }

            source.connect(this.scriptProcessor)
            this.scriptProcessor.connect(this.audioContext.destination)

            this.isStreaming = true
            this.config.onStatus?.('faster-whisper realtime transcription started')
            console.log('[FasterWhisper] Started audio capture')

            return true
        } catch (error) {
            console.error('[FasterWhisper] Failed to setup audio capture:', error)
            onError('Failed to initialize audio capture')
            this.cleanupMedia()
            return false
        }
    }

    async stopRealtimeTranscription(): Promise<void> {
        if (!this.isStreaming) return

        this.isStreaming = false

        try {
            if (this.scriptProcessor) {
                this.scriptProcessor.disconnect()
                this.scriptProcessor.onaudioprocess = null
            }

            if (this.audioContext && this.audioContext.state !== 'closed') {
                await this.audioContext.close()
            }

            // Wait for any pending requests to complete
            const maxWait = 3000
            const startTime = Date.now()
            while (this.activeRequests > 0 && Date.now() - startTime < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100))
            }
        } catch (error) {
            console.error('[FasterWhisper] Failed to stop transcription:', error)
        } finally {
            this.cleanupMedia()
        }
    }

    free(): void {
        this.cleanupMedia()
        this.isInitialized = false
        this.isStreaming = false
        this.activeRequests = 0
        this.audioBuffer = []
    }

    private getEndpoint(): string {
        const endpointFromEnv = import.meta.env.VITE_FASTER_WHISPER_ENDPOINT as string | undefined
        const configured = this.config.endpoint || endpointFromEnv || DEFAULT_FASTER_WHISPER_ENDPOINT
        // If using direct URL (127.0.0.1), switch to proxy path for CORS avoidance
        if (configured.startsWith('http://127.0.0.1') || configured.startsWith('http://localhost')) {
            return DEFAULT_FASTER_WHISPER_ENDPOINT // Use proxy
        }
        return configured.trim()
    }

    /**
     * Process a chunk asynchronously
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
            // Log audio level for debugging
            const maxAmp = this.getMaxAmplitude(combined)
            console.log('[FasterWhisper] Audio level:', maxAmp.toFixed(4), '| Samples:', combined.length)

            // Resample if needed
            const resampled = needsResampling
                ? this.resample(combined, nativeSampleRate, targetSampleRate)
                : combined

            // Encode as WAV
            const wavBlob = this.encodeWav(resampled, targetSampleRate)
            console.log('[FasterWhisper] Sending chunk:', {
                samples: resampled.length,
                duration: (resampled.length / targetSampleRate).toFixed(2) + 's',
                size: wavBlob.size,
            })

            const result = await this.transcribeWav(wavBlob)
            if (result?.text) {
                onResult(result)
            }
        } catch (error) {
            console.error('[FasterWhisper] Chunk processing failed:', error)
            onError('Failed to process audio chunk')
        }
    }

    /**
     * Get the full model ID for the configured model
     */
    private getModelId(): string {
        const model = this.config.model || 'base.en'
        // If it already looks like a full ID (contains /), use it as-is
        if (model.includes('/')) {
            return model
        }
        // Otherwise, map short name to full ID
        return MODEL_ID_MAP[model] || MODEL_ID_MAP['base.en']
    }

    /**
     * Get maximum amplitude in audio samples (for debugging)
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
     */
    private resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
        const ratio = fromRate / toRate
        const newLength = Math.round(samples.length / ratio)
        const result = new Float32Array(newLength)

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio
            const srcIndexFloor = Math.floor(srcIndex)
            const fraction = srcIndex - srcIndexFloor

            const y0 = samples[Math.max(0, srcIndexFloor - 1)]
            const y1 = samples[srcIndexFloor]
            const y2 = samples[Math.min(srcIndexFloor + 1, samples.length - 1)]
            const y3 = samples[Math.min(srcIndexFloor + 2, samples.length - 1)]

            // Cubic interpolation
            const c0 = y1
            const c1 = 0.5 * (y2 - y0)
            const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
            const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)

            result[i] = ((c3 * fraction + c2) * fraction + c1) * fraction + c0
        }

        return result
    }

    /**
     * Encode Float32Array audio as WAV blob
     */
    private encodeWav(samples: Float32Array, sampleRate: number): Blob {
        const buffer = new ArrayBuffer(44 + samples.length * 2)
        const view = new DataView(buffer)

        // RIFF header
        this.writeString(view, 0, 'RIFF')
        view.setUint32(4, 36 + samples.length * 2, true)
        this.writeString(view, 8, 'WAVE')

        // fmt chunk
        this.writeString(view, 12, 'fmt ')
        view.setUint32(16, 16, true) // chunk size
        view.setUint16(20, 1, true) // PCM format
        view.setUint16(22, 1, true) // mono
        view.setUint32(24, sampleRate, true)
        view.setUint32(28, sampleRate * 2, true) // byte rate
        view.setUint16(32, 2, true) // block align
        view.setUint16(34, 16, true) // bits per sample

        // data chunk
        this.writeString(view, 36, 'data')
        view.setUint32(40, samples.length * 2, true)

        // Write audio data
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

    /**
     * Convert audio blob to WAV format
     */
    private async convertToWav(audioBlob: Blob): Promise<Blob> {
        // If already WAV, return as-is
        if (audioBlob.type.includes('wav')) {
            return audioBlob
        }

        const audioContext = new AudioContext()
        try {
            const arrayBuffer = await audioBlob.arrayBuffer()
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

            // Get audio data (mix to mono if needed)
            const channelData = audioBuffer.numberOfChannels > 1
                ? this.mixToMono(audioBuffer)
                : audioBuffer.getChannelData(0)

            // Resample to 16kHz if needed
            const targetSampleRate = 16000
            let resampledData: Float32Array
            if (audioBuffer.sampleRate !== targetSampleRate) {
                resampledData = this.resample(channelData, audioBuffer.sampleRate, targetSampleRate)
            } else {
                resampledData = channelData
            }

            return this.encodeWav(resampledData, targetSampleRate)
        } finally {
            await audioContext.close()
        }
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
     * Transcribe a WAV blob using OpenAI-compatible API
     */
    private async transcribeWav(wavBlob: Blob): Promise<FasterWhisperTranscriptionResult | null> {
        const endpoint = this.getEndpoint()
        const language = this.config.language || 'en'
        const model = this.getModelId()

        const file = new File([wavBlob], `fasterwhisper-chunk-${Date.now()}.wav`, {
            type: 'audio/wav',
        })

        const formData = new FormData()
        formData.append('file', file)
        formData.append('model', model)
        formData.append('language', language)
        formData.append('response_format', 'json')

        // Enable VAD filter to reduce hallucinations during silence
        if (this.config.vadFilter !== false) {
            formData.append('vad_filter', 'true')
        }

        // Add hotwords for better biblical term recognition
        if (this.config.hotwords) {
            formData.append('hotwords', this.config.hotwords)
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

        try {
            const response = await fetch(`${endpoint}/v1/audio/transcriptions`, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                const errorText = await response.text().catch(() => '')
                console.error('[FasterWhisper] Request failed:', response.status, errorText)
                return null
            }

            const json = await response.json() as FasterWhisperResponse
            console.log('[FasterWhisper] Response:', json.text?.substring(0, 100))

            return {
                text: json.text || '',
                language: json.language || language,
                segments: json.segments,
            }
        } catch (error) {
            clearTimeout(timeoutId)
            if (error instanceof Error && error.name === 'AbortError') {
                console.error('[FasterWhisper] Request timed out after', REQUEST_TIMEOUT_MS, 'ms')
            } else {
                console.error('[FasterWhisper] Transcription error:', error)
            }
            return null
        }
    }

    private async requestTranscription(wavBlob: Blob): Promise<{ text: string; language?: string; segments?: FasterWhisperResponse['segments'] }> {
        const result = await this.transcribeWav(wavBlob)
        if (!result) {
            throw new Error('Transcription failed')
        }
        return {
            text: result.text,
            language: result.language,
            segments: result.segments,
        }
    }

    private cleanupMedia(): void {
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
            this.mediaStream = null
        }

        this.audioBuffer = []
    }
}

export const fasterWhisperTranscriptionService = new FasterWhisperTranscriptionService()

export default fasterWhisperTranscriptionService
