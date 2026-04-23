/**
 * VAD-based Transcription Service
 * 
 * Uses browser-based Voice Activity Detection (VAD) to detect speech boundaries
 * and only sends complete utterances to the transcription server.
 * 
 * This eliminates the problem of words being cut off at chunk boundaries.
 * 
 * Uses @ricky0123/vad-web which runs Silero VAD via ONNX in a Web Worker.
 */

// Type definitions for the VAD library
type MicVADInstance = {
    start: () => void
    pause: () => void
    destroy: () => Promise<void>
    listening: boolean
}

type MicVADStatic = {
    new: (options: {
        baseAssetPath?: string
        onnxWASMBasePath?: string
        getStream?: () => Promise<MediaStream>
        onSpeechStart?: () => void
        onSpeechEnd?: (audio: Float32Array) => void
        onVADMisfire?: () => void
        positiveSpeechThreshold?: number
        negativeSpeechThreshold?: number
        minSpeechMs?: number
        preSpeechPadMs?: number
        redemptionMs?: number
    }) => Promise<MicVADInstance>
}

type VADUtils = {
    encodeWAV: (audio: Float32Array) => ArrayBuffer
}

type VADGlobal = {
    MicVAD: MicVADStatic
    utils: VADUtils
}

// Extend Window interface
declare global {
    interface Window {
        vad?: VADGlobal
        ort?: unknown
    }
}

export type VADTranscriptionConfig = {
  /** Language for transcription */
  language?: string
  /** Faster-Whisper server endpoint */
  endpoint?: string
  /** Model to use for transcription */
  model?: string
  /** Initial prompt to bias transcription vocabulary */
  initialPrompt?: string
  /** Called when transcription result is received */
  onResult?: (text: string, isFinal: boolean) => void
  /** Called on error */
  onError?: (error: string) => void
  /** Called when VAD status changes */
  onStatus?: (status: string) => void
  /** Called when speech is detected */
  onSpeechStart?: () => void
  /** Called when speech ends */
  onSpeechEnd?: () => void
  /** VAD sensitivity - higher = more sensitive */
  positiveSpeechThreshold?: number
  /** VAD negative threshold - lower = more aggressive silence detection */
  negativeSpeechThreshold?: number
  /** Minimum speech frames to trigger speech detection */
  minSpeechFrames?: number
  /** Frames to prepend before speech */
  preSpeechPadFrames?: number
  /** Frames of silence before cutting */
  redemptionFrames?: number
  /** Max utterance duration in seconds before forcing a cut */
  maxUtteranceSeconds?: number
  /** Microphone device ID for specific device selection */
  microphoneDeviceId?: string
}

export interface VADUtterance {
    id: string
    audio: Float32Array
    startTime: number
    endTime: number
    duration: number
}

const DEFAULT_ENDPOINT = '/faster-whisper'
const DEFAULT_LANGUAGE = 'en'
const DEFAULT_MODEL = 'Systran/faster-whisper-base.en' // Full HuggingFace ID as expected by faster-whisper-server

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

/**
 * Resolve model name to full HuggingFace ID for faster-whisper-server API
 * The server expects full IDs like 'Systran/faster-whisper-base.en'
 */
function resolveModelId(model: string): string {
    // If it's already a full ID, return as-is
    if (model.includes('/')) {
        return model
    }
    // Convert short name to full HuggingFace ID
    return MODEL_ID_MAP[model] || model
}

// Track if scripts are loading
let scriptsLoading = false
let scriptsLoaded = false
const scriptLoadCallbacks: Array<(success: boolean) => void> = []

/**
 * Load the VAD library scripts dynamically
 */
function loadVADScripts(): Promise<boolean> {
    return new Promise((resolve) => {
        // Already loaded
        if (scriptsLoaded && window.vad?.MicVAD && window.vad?.utils) {
            resolve(true)
            return
        }

        // Already loading - wait for it
        if (scriptsLoading) {
            scriptLoadCallbacks.push(resolve)
            return
        }

        scriptsLoading = true

        // Use the loader script that handles the loading order
        const loaderScript = document.createElement('script')
        loaderScript.src = '/vad-loader.js'
        loaderScript.type = 'text/javascript'

        loaderScript.onerror = () => {
            console.error('[VAD] Failed to load VAD loader script')
            scriptsLoading = false
            resolve(false)
        }

        loaderScript.onload = () => {
            console.log('[VAD] Loader script executed, checking for VAD...')

            // Wait a bit for the async loading to complete
            let attempts = 0
            const maxAttempts = 50 // 5 seconds max
            const checkInterval = setInterval(() => {
                attempts++

                if (window.vad?.MicVAD && window.vad?.utils) {
                    clearInterval(checkInterval)
                    scriptsLoaded = true
                    scriptsLoading = false
                    console.log('[VAD] VAD library ready')
                    resolve(true)

                    // Resolve all waiting callbacks
                    scriptLoadCallbacks.forEach(cb => cb(true))
                    scriptLoadCallbacks.length = 0
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval)
                    console.error('[VAD] Timeout waiting for VAD library')
                    scriptsLoading = false
                    resolve(false)
                }
            }, 100)
        }

        document.head.appendChild(loaderScript)
    })
}

/**
 * VAD-based Transcription Service
 * 
 * Captures audio only when speech is detected, then sends complete utterances
 * to the transcription server. This eliminates boundary artifacts.
 */
class VADTranscriptionService {
    private vad: MicVADInstance | null = null
    private isStreaming = false
    private config: VADTranscriptionConfig = {}
    private utteranceCount = 0
    private lastUtteranceTime = 0
    private abortController: AbortController | null = null

    /**
     * Initialize the VAD service
     */
    async init(config: VADTranscriptionConfig): Promise<boolean> {
        this.config = config
        console.log('[VAD] Initializing VAD transcription service')

        // Pre-load scripts
        const loaded = await loadVADScripts()
        if (!loaded) {
            console.error('[VAD] Failed to load VAD scripts')
            return false
        }

        return true
    }

    /**
     * Check if the service is configured
     */
    isConfigured(): boolean {
        return scriptsLoaded && window.vad?.MicVAD !== undefined
    }

    /**
     * Start VAD-based transcription
     */
    async startRealtimeTranscription(
        onResult: (result: { text: string }) => void,
        onError: (error: string) => void,
        _chunkDurationMs?: number
    ): Promise<boolean> {
        if (this.isStreaming) {
            console.warn('[VAD] Already streaming')
            return false
        }

        // Ensure scripts are loaded
        const loaded = await loadVADScripts()
        if (!loaded || !window.vad?.MicVAD || !window.vad?.utils) {
            onError('Failed to load VAD library')
            return false
        }

        try {
            console.log('[VAD] Starting VAD capture')

            const vadOpts: Parameters<MicVADStatic['new']>[0] = {
                baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
                onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
                onSpeechStart: () => {
                    console.log('[VAD] Speech started')
                    this.config.onSpeechStart?.()
                    this.config.onStatus?.('speech')
                },
                onSpeechEnd: async (audio: Float32Array) => {
                    console.log('[VAD] Speech ended, audio length:', audio.length)
                    this.config.onSpeechEnd?.()
                    this.config.onStatus?.('processing')

                    await this.processUtterance(audio, onResult, onError)
                },
                onVADMisfire: () => {
                    console.log('[VAD] Misfire - too short, ignoring')
                    this.config.onStatus?.('listening')
                },
                positiveSpeechThreshold: this.config.positiveSpeechThreshold ?? 0.6,
                negativeSpeechThreshold: this.config.negativeSpeechThreshold ?? 0.4,
                minSpeechMs: 250,
                preSpeechPadMs: 500,
                redemptionMs: 750,
            }

            if (this.config.microphoneDeviceId) {
                vadOpts.getStream = async () => {
                    return navigator.mediaDevices.getUserMedia({
                        audio: {
                            deviceId: { exact: this.config.microphoneDeviceId! },
                            channelCount: 1,
                            noiseSuppression: true,
                            echoCancellation: true,
                            autoGainControl: true,
                        },
                    })
                }
            }

            this.vad = await window.vad.MicVAD.new(vadOpts)

            this.vad.start()
            this.isStreaming = true
            this.config.onStatus?.('listening')
            console.log('[VAD] VAD started successfully')
            return true
        } catch (error) {
            console.error('[VAD] Failed to start VAD:', error)
            onError('Failed to initialize VAD: ' + (error instanceof Error ? error.message : String(error)))
            return false
        }
    }

    /**
     * Process a speech utterance
     */
    private async processUtterance(
        audio: Float32Array,
        onResult: (result: { text: string }) => void,
        onError: (error: string) => void
    ): Promise<void> {
        const utteranceId = `utt-${Date.now()}-${++this.utteranceCount}`
        const startTime = Date.now()

        try {
            // Convert Float32 PCM to WAV
            if (!window.vad?.utils) {
                throw new Error('VAD utils not available')
            }
            const wavBuffer = window.vad.utils.encodeWAV(audio)
            const blob = new Blob([wavBuffer], { type: 'audio/wav' })

            console.log('[VAD] Utterance', utteranceId, 'size:', blob.size, 'bytes')

            // Send to transcription server
            const text = await this.transcribeWav(blob, utteranceId)

            if (text) {
                const duration = Date.now() - startTime
                console.log('[VAD] Transcription complete in', duration, 'ms:', text.substring(0, 50) + '...')
                onResult({ text })
                this.lastUtteranceTime = Date.now()
            }

            this.config.onStatus?.('listening')
        } catch (error) {
            console.error('[VAD] Error processing utterance:', error)
            onError(error instanceof Error ? error.message : String(error))
            this.config.onStatus?.('error')
        }
    }

    /**
     * Send WAV to transcription server
     */
    private async transcribeWav(blob: Blob, utteranceId: string): Promise<string | null> {
        const endpoint = this.config.endpoint || DEFAULT_ENDPOINT
        const language = this.config.language || DEFAULT_LANGUAGE
        const model = resolveModelId(this.config.model || DEFAULT_MODEL)

    const formData = new FormData()
    formData.append('file', blob, `${utteranceId}.wav`)
    formData.append('language', language.split('-')[0]) // Convert 'en-US' to 'en'
    formData.append('response_format', 'json')
    formData.append('model', model)

    // Add initial prompt to bias transcription toward church vocabulary
    if (this.config.initialPrompt) {
      formData.append('initial_prompt', this.config.initialPrompt)
    }

    const url = `${endpoint}/v1/audio/transcriptions`
        console.log('[VAD] Sending to:', url)

        this.abortController = new AbortController()
        const timeoutId = setTimeout(() => this.abortController?.abort(), 30000)

        try {
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                signal: this.abortController.signal,
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Server error: ${response.status} - ${errorText}`)
            }

            const result = await response.json()
            return result.text?.trim() || null
        } catch (error) {
            clearTimeout(timeoutId)
            if (error instanceof Error && error.name === 'AbortError') {
                console.warn('[VAD] Request timed out for', utteranceId)
                throw new Error('Request timed out')
            }
            throw error
        }
    }

    /**
     * Stop VAD transcription
     */
    async stop(): Promise<void> {
        console.log('[VAD] Stopping VAD')

        // Abort any pending request
        this.abortController?.abort()
        this.abortController = null

        if (this.vad) {
            this.vad.pause()
            await this.vad.destroy()
            this.vad = null
        }

        this.isStreaming = false
        this.config.onStatus?.('stopped')
    }

    /**
     * Check if currently streaming
     */
    isActive(): boolean {
        return this.isStreaming
    }

    /**
     * Get time since last utterance
     */
    getTimeSinceLastUtterance(): number {
        if (this.lastUtteranceTime === 0) return 0
        return Date.now() - this.lastUtteranceTime
    }
}

// Export singleton instance
export const vadTranscriptionService = new VADTranscriptionService()
