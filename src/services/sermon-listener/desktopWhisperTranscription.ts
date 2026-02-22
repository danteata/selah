/**
 * Desktop Whisper Transcription Service
 *
 * Provides transcription using the bundled faster-whisper server
 * in the Tauri desktop app. This service wraps the desktopWhisperService
 * to provide a consistent interface with other transcription providers.
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

const DEFAULT_CHUNK_DURATION_MS = 3000; // 3 seconds
const DESKTOP_WHISPER_PORT = 17493;
const DESKTOP_WHISPER_URL = `http://127.0.0.1:${DESKTOP_WHISPER_PORT}`;

export interface DesktopWhisperTranscriptionConfig extends DesktopWhisperConfig {
    chunkDurationMs?: number;
    onProgress?: (progress: number) => void;
    onStatus?: (status: string) => void;
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
 */
class DesktopWhisperTranscriptionService {
    private isInitialized = false;
    private isRecording = false;
    private config: DesktopWhisperTranscriptionConfig = {};
    private mediaStream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private chunkInterval: ReturnType<typeof setInterval> | null = null;
    private serverEndpoint: string | null = null;

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
        this.config.onStatus?.('Initializing desktop whisper service...');

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

        this.serverEndpoint = endpoint;
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
     * Start realtime transcription
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

        try {
            // Get microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                },
            });

            // Create audio context
            this.audioContext = new AudioContext({ sampleRate: 16000 });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Create audio worklet for capturing PCM data
            const workletBlob = new Blob(
                [
                    `
                    class AudioCaptureProcessor extends AudioWorkletProcessor {
                        constructor() {
                            super();
                            this.buffer = [];
                            this.bufferSize = 48000; // 3 seconds at 16kHz
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
            await this.audioContext.audioWorklet.addModule(workletUrl);

            this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-capture-processor');
            source.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);

            // Handle audio chunks
            this.workletNode.port.onmessage = async (event) => {
                if (event.data.buffer) {
                    const pcmData = event.data.buffer as Float32Array;
                    await this.processChunk(pcmData, onResult, onError);
                }
            };

            this.isRecording = true;
            console.log('Desktop whisper transcription started');
            return true;
        } catch (error) {
            console.error('Failed to start desktop whisper transcription:', error);
            onError(error instanceof Error ? error.message : 'Failed to start recording');
            return false;
        }
    }

    /**
     * Process an audio chunk
     */
    private async processChunk(
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
            console.error('Error processing audio chunk:', error);
            onError(error instanceof Error ? error.message : 'Transcription error');
        }
    }

    /**
     * Convert Float32 PCM to WAV Blob
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

        // Clear interval
        if (this.chunkInterval) {
            clearInterval(this.chunkInterval);
            this.chunkInterval = null;
        }

        // Disconnect worklet
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        // Close audio context
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }

        // Stop media stream
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
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
        this.serverEndpoint = null;
    }
}

export const desktopWhisperTranscriptionService = new DesktopWhisperTranscriptionService();
