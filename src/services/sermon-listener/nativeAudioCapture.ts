/**
 * Native Audio Capture Service
 *
 * Provides high-quality audio capture using native Tauri commands.
 * This service uses the Rust-based audio capture (cpal) for superior
 * audio quality compared to web-based capture.
 */

import { isDesktop } from '@/platform';

// Types for audio device info
export interface AudioDeviceInfo {
    name: string;
    isDefault: boolean;
    sampleRate: number;
    channels: number;
}

// Types for audio chunk
export interface AudioChunk {
    samples: number[];  // Float32 PCM samples
    duration_ms: number;
    sample_rate: number;
}

/**
 * Check if native audio capture is available
 */
export async function isNativeAudioCaptureAvailable(): Promise<boolean> {
    if (!isDesktop()) return false;

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return true;
    } catch {
        return false;
    }
}

/**
 * List available audio input devices
 */
export async function listAudioDevices(): Promise<AudioDeviceInfo[]> {
    if (!isDesktop()) {
        throw new Error('Native audio capture is only available in desktop mode');
    }

    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<AudioDeviceInfo[]>('list_audio_devices');
}

/**
 * Start native audio capture
 */
export async function startNativeAudioCapture(chunkDurationMs?: number): Promise<void> {
    if (!isDesktop()) {
        throw new Error('Native audio capture is only available in desktop mode');
    }

    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('start_audio_capture', {
        chunkDurationMs: chunkDurationMs || 3000
    });
}

/**
 * Stop native audio capture
 */
export async function stopNativeAudioCapture(): Promise<void> {
    if (!isDesktop()) return;

    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_audio_capture');
}

/**
 * Check if audio is currently being captured
 */
export async function isAudioCapturing(): Promise<boolean> {
    if (!isDesktop()) return false;

    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('is_audio_capturing');
}

/**
 * Get an audio chunk if available
 */
export async function getAudioChunk(): Promise<AudioChunk | null> {
    if (!isDesktop()) return null;

    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<AudioChunk | null>('get_audio_chunk');
}

/**
 * Get current audio buffer size
 */
export async function getAudioBufferSize(): Promise<number> {
    if (!isDesktop()) return 0;

    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<number>('get_audio_buffer_size');
}

/**
 * Flush all buffered audio
 */
export async function flushAudioBuffer(): Promise<AudioChunk> {
    if (!isDesktop()) {
        throw new Error('Native audio capture is only available in desktop mode');
    }

    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<AudioChunk>('flush_audio_buffer');
}

/**
 * Clear the audio buffer
 */
export async function clearAudioBuffer(): Promise<void> {
    if (!isDesktop()) return;

    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_audio_buffer');
}

/**
 * Convert Float32 PCM samples to WAV Blob
 */
export function float32SamplesToWav(samples: number[], sampleRate: number = 16000): Blob {
    const float32Array = new Float32Array(samples);
    const buffer = new ArrayBuffer(44 + float32Array.length * 2);
    const view = new DataView(buffer);

    // Helper to write string
    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    // WAV header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + float32Array.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, 1, true); // NumChannels (mono)
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true); // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample
    writeString(36, 'data');
    view.setUint32(40, float32Array.length * 2, true);

    // Convert Float32 to Int16
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++) {
        const sample = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Native Audio Capture Manager
 * 
 * Provides a high-level interface for capturing audio with automatic
 * chunk polling and callback-based processing.
 */
export class NativeAudioCaptureManager {
    private isCapturing = false;
    private pollInterval: ReturnType<typeof setInterval> | null = null;
    private onChunkCallback: ((chunk: AudioChunk) => void) | null = null;
    private onErrorCallback: ((error: Error) => void) | null = null;

    /**
     * Start capturing audio with callbacks
     */
    async start(
        onChunk: (chunk: AudioChunk) => void,
        onError: (error: Error) => void,
        options: {
            chunkDurationMs?: number;
            pollIntervalMs?: number;
        } = {}
    ): Promise<boolean> {
        if (this.isCapturing) {
            console.warn('Already capturing');
            return false;
        }

        try {
            // Start capture
            await startNativeAudioCapture(options.chunkDurationMs || 3000);

            this.isCapturing = true;
            this.onChunkCallback = onChunk;
            this.onErrorCallback = onError;

            // Start polling for audio chunks
            const pollInterval = options.pollIntervalMs || 500; // Poll every 500ms by default
            this.pollInterval = setInterval(() => this.pollForChunks(), pollInterval);

            console.log('Native audio capture started');
            return true;
        } catch (error) {
            console.error('Failed to start native audio capture:', error);
            onError(error instanceof Error ? error : new Error(String(error)));
            return false;
        }
    }

    /**
     * Stop capturing audio
     */
    async stop(): Promise<void> {
        if (!this.isCapturing) return;

        // Stop polling
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        // Stop native capture
        await stopNativeAudioCapture();

        // Process any remaining audio
        try {
            const remainingChunk = await flushAudioBuffer();
            if (remainingChunk.samples.length > 0 && this.onChunkCallback) {
                this.onChunkCallback(remainingChunk);
            }
        } catch (error) {
            console.error('Error flushing audio buffer:', error);
        }

        this.isCapturing = false;
        this.onChunkCallback = null;
        this.onErrorCallback = null;

        console.log('Native audio capture stopped');
    }

    /**
     * Check if currently capturing
     */
    isActive(): boolean {
        return this.isCapturing;
    }

    /**
     * Poll for available audio chunks
     */
    private async pollForChunks(): Promise<void> {
        if (!this.isCapturing || !this.onChunkCallback) return;

        try {
            const chunk = await getAudioChunk();
            if (chunk && chunk.samples.length > 0) {
                this.onChunkCallback(chunk);
            }
        } catch (error) {
            console.error('Error polling for audio chunks:', error);
            if (this.onErrorCallback) {
                this.onErrorCallback(error instanceof Error ? error : new Error(String(error)));
            }
        }
    }
}

// Singleton instance
export const nativeAudioCaptureManager = new NativeAudioCaptureManager();