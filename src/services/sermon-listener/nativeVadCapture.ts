/**
 * Native VAD Audio Capture Service
 *
 * Provides audio capture with native Silero VAD processing.
 * Uses Rust-based VAD for lower latency and better accuracy.
 */

import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface VadAudioChunkEvent {
    wav_base64: string
    duration_ms: number
    is_speaking: boolean
}

export interface NativeVadConfig {
    captureType: 'microphone' | 'system'
    onSpeechChunk: (wavBase64: string, durationMs: number) => void
    onSpeakingChange?: (isSpeaking: boolean) => void
    onError?: (error: string) => void
}

/**
 * Check if native VAD is available
 */
export function isNativeVadAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

/**
 * Start native audio capture with VAD processing
 */
export async function startNativeVadCapture(config: NativeVadConfig): Promise<() => Promise<void>> {
    if (!isNativeVadAvailable()) {
        throw new Error('Native VAD is only available in the desktop app')
    }

    // Listen for VAD audio chunk events
    const unlisten = await listen<VadAudioChunkEvent>('vad-audio-chunk', (event) => {
        const { wav_base64, duration_ms, is_speaking } = event.payload

        if (wav_base64 && duration_ms > 0) {
            config.onSpeechChunk(wav_base64, duration_ms)
        }

        if (config.onSpeakingChange) {
            config.onSpeakingChange(is_speaking)
        }
    })

    try {
        // Initialize VAD
        await invoke('init_vad')

        // Start capture with VAD
        await invoke('start_capture_with_vad', {
            captureType: config.captureType,
        })

        console.log('[NativeVadCapture] Started with capture type:', config.captureType)
    } catch (error) {
        unlisten()
        throw error
    }

    // Return stop function
    return async () => {
        try {
            await invoke('stop_capture')
        } finally {
            unlisten()
        }
    }
}

/**
 * Enable or disable VAD processing
 */
export async function setVadEnabled(enabled: boolean): Promise<void> {
    await invoke('set_vad_enabled', { enabled })
}

/**
 * Hook for using native VAD capture in React components
 */
export function useNativeVadCapture() {
    const [isCapturing, setIsCapturing] = useState(false)
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isSupported, setIsSupported] = useState(false)
    const stopRef = useRef<(() => Promise<void>) | null>(null)

    useEffect(() => {
        setIsSupported(isNativeVadAvailable())
    }, [])

    const start = async (config: Omit<NativeVadConfig, 'onSpeechChunk' | 'onSpeakingChange' | 'onError'> & {
        onSpeechChunk?: (wavBase64: string, durationMs: number) => void
    }): Promise<boolean> => {
        setError(null)

        try {
            const stop = await startNativeVadCapture({
                ...config,
                onSpeechChunk: (wav, duration) => {
                    setIsCapturing(true)
                    config.onSpeechChunk?.(wav, duration)
                },
                onSpeakingChange: (speaking) => {
                    setIsSpeaking(speaking)
                },
                onError: (err) => {
                    setError(err)
                    setIsCapturing(false)
                },
            })

            stopRef.current = stop
            setIsCapturing(true)
            return true
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            return false
        }
    }

    const stop = async () => {
        if (stopRef.current) {
            await stopRef.current()
            stopRef.current = null
        }
        setIsCapturing(false)
        setIsSpeaking(false)
    }

    return {
        isCapturing,
        isSpeaking,
        error,
        isSupported,
        start,
        stop,
        setVadEnabled,
    }
}
