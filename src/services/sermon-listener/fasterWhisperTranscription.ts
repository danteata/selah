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

/**
 * Audio capture mode for transcription
 * - 'browser-wav': Current approach - capture PCM via AudioContext, encode to WAV in browser
 * - 'server-decode': Alternative - capture webm/opus via MediaRecorder, let server decode
 */
export type AudioCaptureMode = 'browser-wav' | 'server-decode'

export interface FasterWhisperConfig {
  endpoint?: string
  language?: string
  model?: string
  chunkDurationMs?: number
  onProgress?: (progress: number) => void
  onStatus?: (status: string) => void
  vadFilter?: boolean
  hotwords?: string
  initialPrompt?: string
  audioCaptureMode?: AudioCaptureMode
  disableBrowserAudioProcessing?: boolean
  microphoneDeviceId?: string
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

// Default initial prompt to bias transcription toward church vocabulary
// This helps prevent hallucination of offensive words that sound similar
const DEFAULT_INITIAL_PROMPT = 'This is a church sermon about Jesus Christ, God, the Bible, and the Christian faith. The speaker is a pastor preaching about Scripture, prayer, salvation, and the Gospel.'

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

/** Timing metrics for performance comparison */
export interface TranscriptionMetrics {
    captureMode: AudioCaptureMode
    audioCaptureTime: number // ms to capture audio
    encodingTime: number // ms to encode (0 for server-decode)
    networkTime: number // ms for network request
    serverTime: number // ms for server processing (if reported)
    totalTime: number // total ms from capture to result
    audioSize: number // bytes sent to server
    textLength: number // characters in result
}

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

    // MediaRecorder-based capture (for server-decode mode)
    private mediaRecorder: MediaRecorder | null = null
    private recorderChunks: Blob[] = []
    private recorderInterval: ReturnType<typeof setInterval> | null = null

    // Metrics tracking
    private lastMetrics: TranscriptionMetrics | null = null

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
      initialPrompt: DEFAULT_INITIAL_PROMPT, // Bias toward church vocabulary
      audioCaptureMode: 'browser-wav', // Default to current approach
      disableBrowserAudioProcessing: false,
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

    /**
     * Get the last transcription metrics for performance comparison
     */
    getLastMetrics(): TranscriptionMetrics | null {
        return this.lastMetrics
    }

    /**
     * Get the current audio capture mode
     */
    getAudioCaptureMode(): AudioCaptureMode {
        return this.config.audioCaptureMode || 'browser-wav'
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

        // Choose capture mode
        const captureMode = this.config.audioCaptureMode || 'browser-wav'
        console.log(`[FasterWhisper] Starting realtime transcription with mode: ${captureMode}`)

        // Configure audio constraints based on mode
        const disableProcessing = this.config.disableBrowserAudioProcessing && captureMode === 'server-decode'
        const audioConstraints: MediaTrackConstraints = {
            channelCount: 1,
            noiseSuppression: disableProcessing ? false : true,
            echoCancellation: disableProcessing ? false : true,
            autoGainControl: disableProcessing ? false : true,
        }

        if (this.config.microphoneDeviceId) {
            audioConstraints.deviceId = { exact: this.config.microphoneDeviceId }
        }

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints,
            })
        } catch {
            onError('Microphone permission is required for transcription')
            return false
        }

        // Route to appropriate capture method
        if (captureMode === 'server-decode') {
            return this.startMediaRecorderCapture(onResult, onError, chunkDurationMs)
        } else {
            return this.startAudioContextCapture(onResult, onError, chunkDurationMs)
        }
    }

    /**
     * MediaRecorder-based capture (server-decode mode)
     * Captures webm/opus and sends directly to server for decoding
     */
    private async startMediaRecorderCapture(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs?: number
    ): Promise<boolean> {
        try {
            const mimeType = this.getSupportedMimeType()
            if (!mimeType) {
                onError('No supported audio MIME type found for MediaRecorder')
                return false
            }

            console.log('[FasterWhisper] Using MediaRecorder with MIME type:', mimeType)

            const chunkDuration = chunkDurationMs || this.config.chunkDurationMs || DEFAULT_CHUNK_DURATION_MS

            // Audio level monitoring for debugging
            let audioContext: AudioContext | null = null
            let analyser: AnalyserNode | null = null
            try {
                audioContext = new AudioContext()
                const source = audioContext.createMediaStreamSource(this.mediaStream!)
                analyser = audioContext.createAnalyser()
                analyser.fftSize = 256
                source.connect(analyser)
            } catch (e) {
                console.warn('[FasterWhisper] Could not create audio analyser:', e)
            }

            this.mediaRecorder = new MediaRecorder(this.mediaStream!, {
                mimeType,
                // Request higher audio quality
                audioBitsPerSecond: 128000,
            })
            this.recorderChunks = []

            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    this.recorderChunks.push(event.data)
                    console.log('[FasterWhisper] MediaRecorder data available:', event.data.size, 'bytes')
                }
            }

            this.mediaRecorder.onstop = async () => {
                // Process any remaining chunks when recorder stops
                if (this.recorderChunks.length > 0) {
                    const captureEndTime = performance.now()
                    const chunks = [...this.recorderChunks]
                    this.recorderChunks = []
                    await this.processMediaRecorderChunk(chunks, captureEndTime, onResult, onError)
                }
            }

            // Audio level monitoring
            const checkAudioLevel = () => {
                if (!this.isStreaming || !analyser) return

                const dataArray = new Uint8Array(analyser.frequencyBinCount)
                analyser.getByteFrequencyData(dataArray)
                const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
                console.log('[FasterWhisper] Audio level:', average.toFixed(1), '(0-255)')

                if (average < 5) {
                    console.warn('[FasterWhisper] Very low audio level - microphone may not be capturing')
                }
            }

            // Process chunks at regular intervals using ondataavailable
            // MediaRecorder will fire ondataavailable every 'timeslice' ms
            this.recorderInterval = setInterval(() => {
                if (!this.isStreaming || this.recorderChunks.length === 0) return

                // Check audio level
                checkAudioLevel()

                const captureEndTime = performance.now()
                const chunks = [...this.recorderChunks]
                this.recorderChunks = []

                // Only process if we have meaningful data (at least 10KB)
                const totalSize = chunks.reduce((sum, c) => sum + c.size, 0)
                if (totalSize < 10000) {
                    console.log('[FasterWhisper] Skipping small chunk:', totalSize, 'bytes')
                    return
                }

                if (this.activeRequests < this.maxConcurrentRequests) {
                    this.activeRequests++
                    this.processMediaRecorderChunk(chunks, captureEndTime, onResult, onError)
                        .finally(() => {
                            this.activeRequests--
                        })
                }
            }, chunkDuration)

            this.mediaRecorder.onerror = (event) => {
                console.error('[FasterWhisper] MediaRecorder error:', event)
                onError('MediaRecorder encountered an error')
            }

            // Start recording with timeslice to get regular data
            // Use a smaller timeslice for more frequent data
            this.mediaRecorder.start(Math.min(chunkDuration, 1000))

            this.isStreaming = true
            this.config.onStatus?.(`faster-whisper realtime transcription started (server-decode mode, ${mimeType})`)
            console.log('[FasterWhisper] Started MediaRecorder capture')

            return true
        } catch (error) {
            console.error('[FasterWhisper] Failed to setup MediaRecorder capture:', error)
            onError('Failed to initialize MediaRecorder capture')
            this.cleanupMedia()
            return false
        }
    }

    /**
     * Process a MediaRecorder chunk - send webm directly to server
     */
    private async processMediaRecorderChunk(
        chunks: Blob[],
        captureEndTime: number,
        onResult: ResultCallback,
        onError: ErrorCallback
    ): Promise<void> {
        const captureStartTime = captureEndTime - (this.config.chunkDurationMs || DEFAULT_CHUNK_DURATION_MS)
        const audioCaptureTime = captureEndTime - captureStartTime

        try {
            // Combine chunks into single blob
            const mimeType = this.getSupportedMimeType() || 'audio/webm'
            const audioBlob = new Blob(chunks, { type: mimeType })

            console.log('[FasterWhisper] MediaRecorder chunk:', {
                size: audioBlob.size,
                type: audioBlob.type,
                chunks: chunks.length,
            })

            // Send directly to server for decoding
            const result = await this.transcribeAudioDirect(audioBlob, audioCaptureTime)

            if (result?.text) {
                onResult(result)
            }
        } catch (error) {
            console.error('[FasterWhisper] MediaRecorder chunk processing failed:', error)
            onError('Failed to process audio chunk')
        }
    }

    /**
     * AudioContext-based capture (browser-wav mode) - original implementation
     */
    private async startAudioContextCapture(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs?: number
    ): Promise<boolean> {
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

            const source = this.audioContext.createMediaStreamSource(this.mediaStream!)

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
            // Stop MediaRecorder if active
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop()
            }

            // Clear recorder interval
            if (this.recorderInterval) {
                clearInterval(this.recorderInterval)
                this.recorderInterval = null
            }

            // Stop ScriptProcessor if active
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
        const captureStartTime = performance.now()
        try {
            // Log audio level for debugging
            const maxAmp = this.getMaxAmplitude(combined)
            console.log('[FasterWhisper] Audio level:', maxAmp.toFixed(4), '| Samples:', combined.length)

            // Resample if needed
            const encodeStartTime = performance.now()
            const resampled = needsResampling
                ? this.resample(combined, nativeSampleRate, targetSampleRate)
                : combined

            // Encode as WAV
            const wavBlob = this.encodeWav(resampled, targetSampleRate)
            const encodingTime = performance.now() - encodeStartTime

            console.log('[FasterWhisper] Sending chunk:', {
                samples: resampled.length,
                duration: (resampled.length / targetSampleRate).toFixed(2) + 's',
                size: wavBlob.size,
                encodingTime: encodingTime.toFixed(1) + 'ms',
            })

            const networkStartTime = performance.now()
            const result = await this.transcribeWav(wavBlob)
            const networkTime = performance.now() - networkStartTime

            // Record metrics
            this.lastMetrics = {
                captureMode: 'browser-wav',
                audioCaptureTime: 0, // Calculated differently for AudioContext
                encodingTime,
                networkTime,
                serverTime: 0, // Not reported by server
                totalTime: performance.now() - captureStartTime,
                audioSize: wavBlob.size,
                textLength: result?.text?.length || 0,
            }

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
        // Use 'en' for English-only models, not 'en-US'
        const language = (this.config.language || 'en').split('-')[0]
        const model = this.getModelId()

        const file = new File([wavBlob], `fasterwhisper-chunk-${Date.now()}.wav`, {
            type: 'audio/wav',
        })

        console.log('[FasterWhisper] Sending WAV transcription request:', {
            size: file.size,
            language,
            model,
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

  // Add initial prompt to bias transcription toward church vocabulary
  if (this.config.initialPrompt) {
    formData.append('initial_prompt', this.config.initialPrompt)
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

    /**
     * Transcribe audio blob directly (server-decode mode)
     * Sends webm/opus directly to server for FFmpeg decoding
     */
    private async transcribeAudioDirect(
        audioBlob: Blob,
        audioCaptureTime: number
    ): Promise<FasterWhisperTranscriptionResult | null> {
        const startTime = performance.now()
        const endpoint = this.getEndpoint()
        // Use 'en' for English-only models, not 'en-US'
        const language = (this.config.language || 'en').split('-')[0]
        const model = this.getModelId()

        // Determine file extension based on MIME type
        const extension = this.getFileExtension(audioBlob.type)
        const filename = `fasterwhisper-chunk-${Date.now()}${extension}`

        const file = new File([audioBlob], filename, {
            type: audioBlob.type || 'audio/webm',
        })

        console.log('[FasterWhisper] Sending direct transcription request:', {
            filename,
            type: file.type,
            size: file.size,
            language,
            model,
        })

        const formData = new FormData()
        formData.append('file', file)
        formData.append('model', model)
        formData.append('language', language)
        formData.append('response_format', 'json')

        // Disable VAD filter for server-decode mode - VAD is too aggressive with webm/opus
        // Note: speaches uses 'vad_filter' parameter, but we need to NOT send it at all
        // to disable VAD, or send vad_filter=false as string
        // 
        // For server-decode mode, we skip VAD entirely since the audio is already compressed
        // and VAD thresholds are calibrated for raw PCM/WAV
        // 
        // IMPORTANT: Do NOT append vad_filter at all for server-decode mode

  // Add hotwords for better biblical term recognition
  if (this.config.hotwords) {
    formData.append('hotwords', this.config.hotwords)
  }

  // Add initial prompt to bias transcription toward church vocabulary
  if (this.config.initialPrompt) {
    formData.append('initial_prompt', this.config.initialPrompt)
  }

  // Increase timeout for server-side decoding (FFmpeg needs time)
        const timeout = 30000 // 30 seconds
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        try {
            const networkStartTime = performance.now()
            const response = await fetch(`${endpoint}/v1/audio/transcriptions`, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            })

            clearTimeout(timeoutId)
            const networkTime = performance.now() - networkStartTime

            if (!response.ok) {
                const errorText = await response.text().catch(() => '')
                console.error('[FasterWhisper] Direct request failed:', response.status, errorText)
                return null
            }

            const json = await response.json() as FasterWhisperResponse
            console.log('[FasterWhisper] Direct response:', json.text?.substring(0, 100))

            // Record metrics
            this.lastMetrics = {
                captureMode: 'server-decode',
                audioCaptureTime,
                encodingTime: 0, // No browser encoding
                networkTime,
                serverTime: 0, // Not reported by server
                totalTime: performance.now() - startTime,
                audioSize: audioBlob.size,
                textLength: json.text?.length || 0,
            }

            return {
                text: json.text || '',
                language: json.language || language,
                segments: json.segments,
            }
        } catch (error) {
            clearTimeout(timeoutId)
            if (error instanceof Error && error.name === 'AbortError') {
                console.error('[FasterWhisper] Direct request timed out after', REQUEST_TIMEOUT_MS, 'ms')
            } else {
                console.error('[FasterWhisper] Direct transcription error:', error)
            }
            return null
        }
    }

    /**
     * Get supported MIME type for MediaRecorder
     */
    private getSupportedMimeType(): string | null {
        const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
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

    /**
     * Get file extension from MIME type
     */
    private getFileExtension(mimeType: string): string {
        const extensions: Record<string, string> = {
            'audio/webm': '.webm',
            'audio/webm;codecs=opus': '.webm',
            'audio/ogg': '.ogg',
            'audio/ogg;codecs=opus': '.ogg',
            'audio/mp4': '.m4a',
            'audio/wav': '.wav',
        }
        return extensions[mimeType] || '.webm'
    }

    private cleanupMedia(): void {
        // Clean up MediaRecorder
        if (this.mediaRecorder) {
            if (this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop()
            }
            this.mediaRecorder.ondataavailable = null
            this.mediaRecorder.onerror = null
            this.mediaRecorder = null
        }

        // Clear recorder interval
        if (this.recorderInterval) {
            clearInterval(this.recorderInterval)
            this.recorderInterval = null
        }

        // Clean up recorder chunks
        this.recorderChunks = []

        // Clean up ScriptProcessor
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
