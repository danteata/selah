/**
 * Native Audio Capture Service
 *
 * Provides native audio capture for the desktop app using Tauri.
 * Supports both microphone and system audio (loopback) capture.
 *
 * Benefits over web-based capture:
 * - Lower latency (direct OS API access)
 * - System audio capture (what's playing through speakers)
 * - No browser permission prompts
 * - Direct 16kHz output for Whisper
 */

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// Type definitions
export type CaptureType = 'microphone' | 'system' | 'both'

export interface AudioDeviceInfo {
    name: string
    is_default: boolean
    sample_rate: number
    channels: number
    device_type: 'Input' | 'Output' | 'Loopback'
}

export interface AudioChunk {
    samples: number[]
    duration_ms: number
    sample_rate: number
}

export interface NativeCaptureConfig {
    captureType: CaptureType
    chunkDurationMs?: number
    onChunk?: (chunk: AudioChunk) => void
    onStatus?: (status: CaptureStatus) => void
    onError?: (error: string) => void
}

/**
 * Event-driven capture config (preferred for desktop)
 * Uses Tauri events for audio chunks — no polling needed
 */
export interface NativeCaptureEventConfig {
    captureType: CaptureType
    chunkDurationMs?: number
    /** Called with base64 WAV data (already encoded Rust-side) */
    onWavChunk?: (wavBase64: string, durationMs: number) => void
    onStatus?: (status: CaptureStatus) => void
    onError?: (error: string) => void
}

/** Payload shape for vad-audio-chunk Tauri events (VAD-based) */
interface VadAudioChunkEvent {
    wav_base64: string
    duration_ms: number
    is_speaking: boolean
}

export type CaptureStatus = 'idle' | 'starting' | 'capturing' | 'stopping' | 'error'

/**
 * Check if we're running in Tauri (desktop app)
 */
export function isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

/**
 * Check if system audio capture is supported
 */
export async function isSystemAudioSupported(): Promise<boolean> {
    if (!isTauriAvailable()) return false

    try {
        return await invoke<boolean>('is_system_audio_supported')
    } catch {
        return false
    }
}

/**
 * List available audio devices
 */
export async function listAudioDevices(): Promise<AudioDeviceInfo[]> {
    if (!isTauriAvailable()) {
        throw new Error('Native audio capture is only available in the desktop app')
    }

    return await invoke<AudioDeviceInfo[]>('list_audio_devices')
}

/**
 * Native Audio Capture Service
 *
 * Uses Tauri's IPC to communicate with native Rust audio capture.
 */
class NativeAudioCaptureService {
    private isCapturing = false
    private pollInterval: ReturnType<typeof setInterval> | null = null
    private eventUnlisten: UnlistenFn | null = null
    private config: NativeCaptureConfig | null = null
    private eventConfig: NativeCaptureEventConfig | null = null

    /**
     * Check if currently capturing
     */
    isActive(): boolean {
        return this.isCapturing
    }

    /**
     * Start audio capture with VAD-based event delivery (preferred)
     *
     * Uses Tauri events instead of polling — Rust emits `vad-audio-chunk`
     * events with base64 WAV payloads when complete speech segments are detected.
     * This is more efficient than time-based chunking as it only sends speech.
     */
    async startWithEvents(config: NativeCaptureEventConfig): Promise<boolean> {
        if (!isTauriAvailable()) {
            config.onError?.('Native audio capture is only available in the desktop app')
            return false
        }

        if (this.isCapturing) {
            config.onError?.('Already capturing')
            return false
        }

        this.eventConfig = config
        this.isCapturing = true
        config.onStatus?.('starting')

        try {
            // Listen for VAD-based audio chunk events from Rust
            this.eventUnlisten = await listen<VadAudioChunkEvent>(
                'vad-audio-chunk',
                (event) => {
                    // Only process chunks with actual audio data
                    if (this.isCapturing && event.payload.wav_base64 && event.payload.is_speaking) {
                        config.onWavChunk?.(
                            event.payload.wav_base64,
                            event.payload.duration_ms
                        )
                    }
                }
            )

            // Start the VAD-based capture in Rust
            await invoke('start_capture_with_vad', {
                captureType: config.captureType,
            })

            config.onStatus?.('capturing')
            console.log(`[NativeCapture] Started VAD-based ${config.captureType} capture`)

            return true
        } catch (error) {
            this.isCapturing = false
            this.eventUnlisten?.();
            this.eventUnlisten = null
            config.onStatus?.('error')
            config.onError?.(String(error))
            console.error('[NativeCapture] Failed to start VAD-based capture:', error)
            return false
        }
    }

    /**
     * Start audio capture with polling (fallback)
     */
    async start(config: NativeCaptureConfig): Promise<boolean> {
        if (!isTauriAvailable()) {
            config.onError?.('Native audio capture is only available in the desktop app')
            return false
        }

        if (this.isCapturing) {
            config.onError?.('Already capturing')
            return false
        }

        this.config = config
        this.isCapturing = true
        config.onStatus?.('starting')

        try {
            // Start the native capture
            await invoke('start_capture', {
                captureType: config.captureType,
                chunkDurationMs: config.chunkDurationMs || 3000,
            })

            config.onStatus?.('capturing')
            console.log(`[NativeCapture] Started ${config.captureType} capture`)

            // Start polling for audio chunks
            this.startPolling()

            return true
        } catch (error) {
            this.isCapturing = false
            config.onStatus?.('error')
            config.onError?.(String(error))
            console.error('[NativeCapture] Failed to start:', error)
            return false
        }
    }

    /**
     * Stop audio capture
     */
    async stop(): Promise<void> {
        if (!this.isCapturing) return

        this.config?.onStatus?.('stopping')
        this.eventConfig?.onStatus?.('stopping')

        // Stop polling
        if (this.pollInterval) {
            clearInterval(this.pollInterval)
            this.pollInterval = null
        }

        // Stop event listener
        if (this.eventUnlisten) {
            this.eventUnlisten()
            this.eventUnlisten = null
        }

        try {
            await invoke('stop_capture')
            console.log('[NativeCapture] Stopped capture')
        } catch (error) {
            console.error('[NativeCapture] Error stopping:', error)
        }

        this.isCapturing = false
        this.config?.onStatus?.('idle')
        this.eventConfig?.onStatus?.('idle')
    }

    /**
     * Get current buffer size
     */
    async getBufferSize(): Promise<number> {
        return await invoke<number>('get_buffer_size')
    }

    /**
     * Get audio chunk if available
     */
    async getAudioChunk(): Promise<AudioChunk | null> {
        return await invoke<AudioChunk | null>('get_audio_chunk')
    }

    /**
     * Get audio chunk as WAV (base64 encoded)
     */
    async getAudioChunkAsWav(): Promise<string | null> {
        return await invoke<string | null>('get_audio_chunk_as_wav')
    }

    /**
     * Flush all buffered audio
     */
    async flushBuffer(): Promise<AudioChunk> {
        return await invoke<AudioChunk>('flush_buffer')
    }

    /**
     * Flush buffer as WAV (base64 encoded)
     */
    async flushBufferAsWav(): Promise<string> {
        return await invoke<string>('flush_buffer_as_wav')
    }

    /**
     * Clear the audio buffer
     */
    async clearBuffer(): Promise<void> {
        await invoke('clear_buffer')
    }

    /**
     * Get current capture type
     */
    async getCaptureType(): Promise<CaptureType> {
        return await invoke<CaptureType>('get_capture_type')
    }

    /**
     * Start polling for audio chunks
     */
    private startPolling(): void {
        const pollIntervalMs = (this.config?.chunkDurationMs || 3000) / 2

        this.pollInterval = setInterval(async () => {
            if (!this.isCapturing) return

            try {
                const chunk = await this.getAudioChunk()
                if (chunk && chunk.samples.length > 0) {
                    this.config?.onChunk?.(chunk)
                }
            } catch (error) {
                console.error('[NativeCapture] Poll error:', error)
            }
        }, pollIntervalMs)
    }
}

// Export singleton instance
export const nativeAudioCapture = new NativeAudioCaptureService()

// Alias for backward compatibility
export const nativeAudioCaptureManager = nativeAudioCapture

/**
 * Check if native audio capture is available
 */
export function isNativeAudioCaptureAvailable(): boolean {
    return isTauriAvailable()
}

/**
 * Convert Float32Array samples to WAV format (base64 encoded)
 * This is a utility function for web-based audio processing
 */
export function float32SamplesToWav(samples: Float32Array, sampleRate: number = 16000): string {
    const numChannels = 1
    const bitsPerSample = 16

    // Convert Float32 to Int16
    const int16Samples = new Int16Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]))
        int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }

    // Create WAV file
    const byteRate = sampleRate * numChannels * bitsPerSample / 8
    const blockAlign = numChannels * bitsPerSample / 8
    const dataSize = int16Samples.length * 2
    const headerSize = 44
    const totalSize = headerSize + dataSize

    const buffer = new ArrayBuffer(totalSize)
    const view = new DataView(buffer)

    // RIFF header
    writeString(view, 0, 'RIFF')
    view.setUint32(4, totalSize - 8, true)
    writeString(view, 8, 'WAVE')

    // fmt chunk
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true) // chunk size
    view.setUint16(20, 1, true) // PCM format
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitsPerSample, true)

    // data chunk
    writeString(view, 36, 'data')
    view.setUint32(40, dataSize, true)

    // Write audio data
    const dataOffset = 44
    for (let i = 0; i < int16Samples.length; i++) {
        view.setInt16(dataOffset + i * 2, int16Samples[i], true)
    }

    // Convert to base64
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
    }
}

/**
 * Hook for using native audio capture in React components
 */
export function useNativeAudioCapture() {
    const [isCapturing, setIsCapturing] = useState<boolean>(false)
    const [status, setStatus] = useState<CaptureStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const [isSupported, setIsSupported] = useState<boolean>(false)
    const [systemAudioSupported, setSystemAudioSupported] = useState<boolean>(false)

    // Check availability on mount
    useEffect(() => {
        const checkAvailability = async () => {
            const tauriAvailable = isTauriAvailable()
            setIsSupported(tauriAvailable)

            if (tauriAvailable) {
                const systemSupported = await isSystemAudioSupported()
                setSystemAudioSupported(systemSupported)
            }
        }

        checkAvailability()
    }, [])

    const start = async (config: Omit<NativeCaptureConfig, 'onChunk' | 'onStatus' | 'onError'> & {
        onChunk?: (chunk: AudioChunk) => void
    }): Promise<boolean> => {
        setError(null)

        const result = await nativeAudioCapture.start({
            ...config,
            onChunk: (chunk) => {
                setIsCapturing(true)
                config.onChunk?.(chunk)
            },
            onStatus: (s) => {
                setStatus(s)
                if (s === 'capturing') setIsCapturing(true)
                else if (s === 'idle') setIsCapturing(false)
            },
            onError: (e) => {
                setError(e)
                setStatus('error')
            },
        })

        return result
    }

    const stop = async () => {
        await nativeAudioCapture.stop()
        setIsCapturing(false)
        setStatus('idle')
    }

    const getWavChunk = async (): Promise<string | null> => {
        return await nativeAudioCapture.getAudioChunkAsWav()
    }

    const flushWav = async (): Promise<string> => {
        return await nativeAudioCapture.flushBufferAsWav()
    }

    return {
        isCapturing,
        status,
        error,
        isSupported,
        systemAudioSupported,
        start,
        stop,
        getWavChunk,
        flushWav,
        listAudioDevices,
    }
}
