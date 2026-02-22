/**
 * Desktop Whisper Transcription Service
 *
 * Provides transcription using the bundled faster-whisper server
 * in the Tauri desktop app. Uses native audio capture for superior
 * quality compared to web-based capture.
 */

import { isDesktop } from '@/platform';
import {
    startDesktopWhisperServer,
    stopDesktopWhisperServer,
    transcribeWithDesktopWhisper,
    getDesktopWhisperStatus,
    isDesktopWhisperAvailable,
    type DesktopWhisperConfig,
    type DesktopWhisperResult,
    type WhisperServerStatus,
} from './desktopWhisperService';
import {
    nativeAudioCaptureManager,
    float32SamplesToWav,
    isNativeAudioCaptureAvailable,
    type AudioChunk,
} from './nativeAudioCapture';

const DEFAULT_CHUNK_DURATION_MS = 3000; // 3 seconds

export interface DesktopWhisperTranscriptionConfig extends DesktopWhisperConfig {
    chunkDurationMs?: number;
    onProgress?: (progress: number) => void;
    onStatus?: (status: string) => void;
    useNativeAudio?: boolean; // Option to use native audio capture
}

export interface DesktopWhisperTranscriptionResult {
    text: string;
    language?: string;
    segments?: Array<{
        start: number;
        end: number;
        text: string;
    }>;
}

type ResultCallback = (result: DesktopWhisperTranscriptionResult) => void;
type ErrorCallback = (error: string) => void;

/**
 * Desktop Whisper Transcription Service
 *
 * Manages the bundled whisper server in Tauri desktop app
 * with native audio capture for superior quality.
 */
class DesktopWhisperTranscriptionService {
    private isInitialized = false;
    private isRecording = false;
    private config: DesktopWhisperTranscriptionConfig = {};
    private useNativeCapture = true; // Default to native capture

    /**
     * Check if running in desktop mode
     */
    private checkDesktop(): boolean {
        if (!isDesktop()) {
            console.warn('Desktop whisper is only available in desktop mode');
            return false;
        }
        return true;
    }

    /**
     * Check if the service is configured and available
     */
    async isConfigured(): Promise<boolean> {
        if (!this.checkDesktop()) return false;
        return isDesktopWhisperAvailable();
    }

    /**
     * Initialize the desktop whisper service
     */
    async init(config: DesktopWhisperTranscriptionConfig = {}): Promise<boolean> {
        if (!this.checkDesktop()) return false;

        this.config = { ...config };
        this.useNativeCapture = config.useNativeAudio !== false; // Default to true

        this.config.onStatus?.('Initializing desktop whisper service...');

        // Check if native audio capture is available
        if (this.useNativeCapture) {
            const nativeAvailable = await isNativeAudioCaptureAvailable();
            if (!nativeAvailable) {
                console.warn('Native audio capture not available, falling back to web audio');
                this.useNativeCapture = false;
            }
        }

        // Start the whisper server
        this.config.onStatus?.('Starting whisper server...');
        this.config.onProgress?.(0.2);

        const endpoint = await startDesktopWhisperServer({
            model: config.model || 'base.en',
            language: config.language,
            vadFilter: config.vadFilter,
            hotwords: config.hotwords,
        });

        if (!endpoint) {
            this.config.onStatus?.('Failed to start whisper server');
            return false;
        }

        this.config.onProgress?.(0.5);
        this.config.onStatus?.('Whisper server started, waiting for model to load...');

        // Wait for server to be ready (model loading takes time)
        const maxAttempts = 30; // 30 seconds max
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const available = await isDesktopWhisperAvailable();
            if (available) {
                this.isInitialized = true;
                this.config.onProgress?.(1);
                this.config.onStatus?.('Ready');
                return true;
            }
            // Wait 1 second between attempts
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.config.onProgress?.(0.5 + (attempt / maxAttempts) * 0.5);
        }

        this.config.onStatus?.('Whisper server not responding after 30 seconds');
        return false;
    }

    /**
     * Get server status
     */
    async getStatus(): Promise<WhisperServerStatus | null> {
        if (!this.checkDesktop()) return null;
        return getDesktopWhisperStatus();
    }

    /**
     * Start realtime transcription using native audio capture
     */
    async startRealtimeTranscription(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs?: number
    ): Promise<boolean> {
        if (!this.checkDesktop()) {
            onError('Desktop whisper is only available in desktop mode');
            return false;
        }

        if (this.isRecording) {
            console.warn('Already recording');
            return false;
        }

        // Ensure server is running
        if (!this.isInitialized) {
            const initialized = await this.init(this.config);
            if (!initialized) {
                onError('Failed to initialize desktop whisper service');
                return false;
            }
        }

        const duration = chunkDurationMs || this.config.chunkDurationMs || DEFAULT_CHUNK_DURATION_MS;

        // Use native audio capture if available
        if (this.useNativeCapture) {
            return this.startNativeCapture(onResult, onError, duration);
        } else {
            return this.startWebAudioCapture(onResult, onError, duration);
        }
    }

    /**
     * Start native audio capture (Rust-based)
     */
    private async startNativeCapture(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs: number
    ): Promise<boolean> {
        try {
            const started = await nativeAudioCaptureManager.start(
                async (chunk: AudioChunk) => {
                    await this.processNativeChunk(chunk, onResult, onError);
                },
                (error: Error) => {
                    onError(error.message);
                },
                {
                    chunkDurationMs,
                    pollIntervalMs: 500, // Poll every 500ms
                }
            );

            if (started) {
                this.isRecording = true;
                console.log('Desktop whisper transcription started (native audio capture)');
                return true;
            } else {
                onError('Failed to start native audio capture');
                return false;
            }
        } catch (error) {
            console.error('Failed to start native audio capture:', error);
            onError(error instanceof Error ? error.message : 'Failed to start native audio capture');
            return false;
        }
    }

    /**
     * Process a native audio chunk
     */
    private async processNativeChunk(
        chunk: AudioChunk,
        onResult: ResultCallback,
        onError: ErrorCallback
    ): Promise<void> {
        try {
            // Convert Float32 samples to WAV
            const wavBlob = float32SamplesToWav(chunk.samples, chunk.sample_rate);

            // Send to desktop whisper server
            const result = await transcribeWithDesktopWhisper(wavBlob, {
                language: this.config.language,
                vadFilter: this.config.vadFilter,
                hotwords: this.config.hotwords,
            });

            if (result && result.text.trim()) {
                onResult({
                    text: result.text.trim(),
                    language: result.language,
                    segments: result.segments,
                });
            }
        } catch (error) {
            console.error('Error processing native audio chunk:', error);
            onError(error instanceof Error ? error.message : 'Transcription error');
        }
    }

    /**
     * Start web audio capture (fallback)
     */
    private async startWebAudioCapture(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs: number
    ): Promise<boolean> {
        // Fallback to web audio capture
        // This is the original implementation using AudioWorklet
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                },
            });

            const audioContext = new AudioContext({ sampleRate: 16000 });
            const source = audioContext.createMediaStreamSource(mediaStream);

            // Create audio worklet for capturing PCM data
            const workletBlob = new Blob(
                [
                    `
                    class AudioCaptureProcessor extends AudioWorkletProcessor {
                        constructor() {
                            super();
                            this.buffer = [];
                            this.bufferSize = ${16000 * (chunkDurationMs / 1000)}; // Dynamic buffer size
                        }
                        
                        process(inputs, outputs, parameters) {
                            const input = inputs[0];
                            if (input.length > 0) {
                                const channelData = input[0];
                                for (let i = 0; i < channelData.length; i++) {
                                    this.buffer.push(channelData[i]);
                                }
                                
                                // Send buffer when full
                                if (this.buffer.length >= this.bufferSize) {
                                    this.port.postMessage({ buffer: new Float32Array(this.buffer) });
                                    this.buffer = [];
                                }
                            }
                            return true;
                        }
                    }
                    registerProcessor('audio-capture-processor', AudioCaptureProcessor);
                    `,
                ],
                { type: 'application/javascript' }
            );

            const workletUrl = URL.createObjectURL(workletBlob);
            await audioContext.audioWorklet.addModule(workletUrl);

            const workletNode = new AudioWorkletNode(audioContext, 'audio-capture-processor');
            source.connect(workletNode);
            workletNode.connect(audioContext.destination);

            // Handle audio chunks
            workletNode.port.onmessage = async (event) => {
                if (event.data.buffer) {
                    const pcmData = event.data.buffer as Float32Array;
                    await this.processWebChunk(pcmData, onResult, onError);
                }
            };

            // Store references for cleanup
            this._webMediaStream = mediaStream;
            this._webAudioContext = audioContext;
            this._webWorkletNode = workletNode;

            this.isRecording = true;
            console.log('Desktop whisper transcription started (web audio capture fallback)');
            return true;
        } catch (error) {
            console.error('Failed to start web audio capture:', error);
            onError(error instanceof Error ? error.message : 'Failed to start recording');
            return false;
        }
    }

    // Store web audio references for cleanup
    private _webMediaStream: MediaStream | null = null;
    private _webAudioContext: AudioContext | null = null;
    private _webWorkletNode: AudioWorkletNode | null = null;

    /**
     * Process a web audio chunk
     */
    private async processWebChunk(
        pcmData: Float32Array,
        onResult: ResultCallback,
        onError: ErrorCallback
    ): Promise<void> {
        try {
            // Convert Float32 PCM to WAV
            const wavBlob = this.pcmToWav(pcmData);

            // Send to desktop whisper server
            const result = await transcribeWithDesktopWhisper(wavBlob, {
                language: this.config.language,
                vadFilter: this.config.vadFilter,
                hotwords: this.config.hotwords,
            });

            if (result && result.text.trim()) {
                onResult({
                    text: result.text.trim(),
                    language: result.language,
                    segments: result.segments,
                });
            }
        } catch (error) {
            console.error('Error processing web audio chunk:', error);
            onError(error instanceof Error ? error.message : 'Transcription error');
        }
    }

    /**
     * Convert Float32 PCM to WAV Blob (for web audio fallback)
     */
    private pcmToWav(float32Array: Float32Array): Blob {
        const buffer = new ArrayBuffer(44 + float32Array.length * 2);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + float32Array.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // Subchunk1Size
        view.setUint16(20, 1, true); // AudioFormat (PCM)
        view.setUint16(22, 1, true); // NumChannels (mono)
        view.setUint32(24, 16000, true); // SampleRate
        view.setUint32(28, 32000, true); // ByteRate
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
     * Stop transcription
     */
    async stop(): Promise<void> {
        this.isRecording = false;

        // Stop native audio capture
        if (this.useNativeCapture) {
            await nativeAudioCaptureManager.stop();
        }

        // Stop web audio capture (if used)
        if (this._webWorkletNode) {
            this._webWorkletNode.disconnect();
            this._webWorkletNode = null;
        }

        if (this._webAudioContext) {
            await this._webAudioContext.close();
            this._webAudioContext = null;
        }

        if (this._webMediaStream) {
            this._webMediaStream.getTracks().forEach((track) => track.stop());
            this._webMediaStream = null;
        }

        console.log('Desktop whisper transcription stopped');
    }

    /**
     * Shutdown the whisper server
     */
    async shutdown(): Promise<void> {
        await this.stop();
        await stopDesktopWhisperServer();
        this.isInitialized = false;
    }

    /**
     * Check if using native audio capture
     */
    isUsingNativeCapture(): boolean {
        return this.useNativeCapture;
    }
}

export const desktopWhisperTranscriptionService = new DesktopWhisperTranscriptionService();
