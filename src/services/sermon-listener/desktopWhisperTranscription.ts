/**
 * Desktop Whisper Transcription Service
 *
 * Provides transcription using the bundled faster-whisper server
 * in the Tauri desktop app. Uses VAD-based audio capture for
 * superior quality - only sends complete utterances to the server.
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
    isNativeAudioCaptureAvailable,
} from './nativeAudioCapture';

const DEFAULT_CHUNK_DURATION_MS = 3000; // 3 seconds (fallback for non-VAD mode)

// Type definitions for the VAD library (loaded from CDN)
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

export interface DesktopWhisperTranscriptionConfig extends DesktopWhisperConfig {
    chunkDurationMs?: number;
    onProgress?: (progress: number) => void;
    onStatus?: (status: string) => void;
    useNativeAudio?: boolean;
    useVAD?: boolean;
    microphoneDeviceId?: string;
    positiveSpeechThreshold?: number;
    negativeSpeechThreshold?: number;
    minSpeechMs?: number;
    preSpeechPadMs?: number;
    redemptionMs?: number;
    onSpeechStart?: () => void;
    onSpeechEnd?: () => void;
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
 * with VAD-based audio capture for superior quality.
 */
class DesktopWhisperTranscriptionService {
    private isInitialized = false;
    private isRecording = false;
    private config: DesktopWhisperTranscriptionConfig = {};
    private useNativeCapture = true; // Fallback for non-VAD mode
    private useVAD = true; // Default to VAD-based chunking
    private vad: MicVADInstance | null = null;
    private vadLoaded = false;
    private utteranceCount = 0;
    private abortController: AbortController | null = null;

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
     * 
     * In the desktop app, the whisper server is bundled as a sidecar
     * and will be started by init(). We don't require it to already
     * be running for the provider to be considered available.
     */
    async isConfigured(): Promise<boolean> {
        if (!this.checkDesktop()) return false;
        return true;
    }

    /**
     * Initialize the desktop whisper service
     */
    async init(config: DesktopWhisperTranscriptionConfig = {}): Promise<boolean> {
        if (!this.checkDesktop()) return false;

        this.config = { ...config };
        this.useVAD = config.useVAD !== false; // Default to true
        this.useNativeCapture = config.useNativeAudio !== false; // Fallback for non-VAD mode

        this.config.onStatus?.('Initializing desktop whisper service...');

        // Load VAD scripts if using VAD mode
        if (this.useVAD) {
            this.config.onStatus?.('Loading VAD library...');
            const vadLoaded = await this.loadVADScripts();
            if (!vadLoaded) {
                console.warn('VAD library failed to load, falling back to time-based chunking');
                this.useVAD = false;
            }
        }

        // Check if native audio capture is available (for fallback)
        if (!this.useVAD && this.useNativeCapture) {
            const nativeAvailable = await isNativeAudioCaptureAvailable();
            if (!nativeAvailable) {
                console.warn('Native audio capture not available, falling back to web audio');
                this.useNativeCapture = false;
            }
        }

        // Start the whisper server
        this.config.onStatus?.('Starting whisper server...');
        this.config.onProgress?.(0.2);

        // Note: Server-side VAD is disabled because the silero_vad_v6.onnx model
        // is not bundled with the PyInstaller executable. The frontend uses its own
        // WASM-based VAD for audio chunking at speech pauses.
        const endpoint = await startDesktopWhisperServer({
            model: config.model || 'base.en',
            language: config.language,
            vadFilter: false, // Always disable server-side VAD (model not bundled)
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
     * Load VAD library scripts dynamically
     */
    private async loadVADScripts(): Promise<boolean> {
        // Already loaded
        if (this.vadLoaded && window.vad?.MicVAD && window.vad?.utils) {
            return true;
        }

        return new Promise((resolve) => {
            // Use the loader script that handles the loading order
            const loaderScript = document.createElement('script');
            loaderScript.src = '/vad-loader.js';
            loaderScript.type = 'text/javascript';

            loaderScript.onerror = () => {
                console.error('[DesktopWhisper] Failed to load VAD loader script');
                resolve(false);
            };

            loaderScript.onload = () => {
                console.log('[DesktopWhisper] Loader script executed, checking for VAD...');

                // Wait a bit for the async loading to complete
                let attempts = 0;
                const maxAttempts = 50; // 5 seconds max
                const checkInterval = setInterval(() => {
                    attempts++;

                    if (window.vad?.MicVAD && window.vad?.utils) {
                        clearInterval(checkInterval);
                        this.vadLoaded = true;
                        console.log('[DesktopWhisper] VAD library ready');
                        resolve(true);
                    } else if (attempts >= maxAttempts) {
                        clearInterval(checkInterval);
                        console.error('[DesktopWhisper] Timeout waiting for VAD library');
                        resolve(false);
                    }
                }, 100);
            };

            document.head.appendChild(loaderScript);
        });
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
        chunkDurationMs?: number,
        captureType: 'microphone' | 'system' = 'microphone'
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

        // Use VAD-based capture if available (preferred for microphone)
        // If captureType is 'system', we MUST use native capture as browser VAD 
        // doesn't support system audio loopback easily.
        if (captureType === 'microphone' && this.useVAD && this.vadLoaded) {
            return this.startVADCapture(onResult, onError);
        }

        // Fall back to native audio capture if available
        if (this.useNativeCapture) {
            return this.startNativeCapture(onResult, onError, duration, captureType);
        } else {
            return this.startWebAudioCapture(onResult, onError, duration);
        }
    }

    /**
     * Start VAD-based audio capture (preferred method)
     * Uses browser-based VAD to detect speech boundaries
     */
    private async startVADCapture(
        onResult: ResultCallback,
        onError: ErrorCallback
    ): Promise<boolean> {
        if (!window.vad?.MicVAD || !window.vad?.utils) {
            onError('VAD library not loaded');
            return false;
        }

        try {
            console.log('[DesktopWhisper] Starting VAD-based capture');

            const vadOptions: Parameters<MicVADStatic['new']>[0] = {
                baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
                onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
                onSpeechStart: () => {
                    console.log('[DesktopWhisper] Speech started');
                    this.config.onSpeechStart?.();
                    this.config.onStatus?.('speech');
                },
                onSpeechEnd: async (audio: Float32Array) => {
                    console.log('[DesktopWhisper] Speech ended, audio length:', audio.length);
                    this.config.onSpeechEnd?.();
                    this.config.onStatus?.('processing');

                    await this.processVADUtterance(audio, onResult, onError);
                },
                onVADMisfire: () => {
                    console.log('[DesktopWhisper] VAD misfire - too short, ignoring');
                    this.config.onStatus?.('listening');
                },
                positiveSpeechThreshold: this.config.positiveSpeechThreshold ?? 0.65,
                negativeSpeechThreshold: this.config.negativeSpeechThreshold ?? 0.45,
                minSpeechMs: this.config.minSpeechMs ?? 500,
                preSpeechPadMs: this.config.preSpeechPadMs ?? 500,
                redemptionMs: this.config.redemptionMs ?? 1000,
            };

            if (this.config.microphoneDeviceId) {
                vadOptions.getStream = async () => {
                    return navigator.mediaDevices.getUserMedia({
                        audio: {
                            deviceId: { exact: this.config.microphoneDeviceId! },
                            channelCount: 1,
                            noiseSuppression: true,
                            echoCancellation: true,
                            autoGainControl: true,
                        },
                    });
                };
            }

            this.vad = await window.vad.MicVAD.new(vadOptions);

            this.vad.start();
            this.isRecording = true;
            this.config.onStatus?.('listening');
            console.log('[DesktopWhisper] VAD-based capture started successfully');
            return true;
        } catch (error) {
            console.error('[DesktopWhisper] Failed to start VAD capture:', error);
            onError('Failed to initialize VAD: ' + (error instanceof Error ? error.message : String(error)));
            return false;
        }
    }

    /**
     * Process a VAD utterance (complete speech segment)
     */
    private async processVADUtterance(
        audio: Float32Array,
        onResult: ResultCallback,
        onError: ErrorCallback
    ): Promise<void> {
        const utteranceId = `utt-${Date.now()}-${++this.utteranceCount}`;
        const startTime = Date.now();

        try {
            // Convert Float32 PCM to WAV using VAD utils
            if (!window.vad?.utils) {
                throw new Error('VAD utils not available');
            }
            const wavBuffer = window.vad.utils.encodeWAV(audio);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });

            console.log('[DesktopWhisper] Utterance', utteranceId, 'size:', blob.size, 'bytes');

      // Send to desktop whisper server
      // Convert 'en-US' to 'en' - faster-whisper only accepts 2-letter codes
      const language = (this.config.language || 'en').split('-')[0];
      const result = await transcribeWithDesktopWhisper(blob, {
        language,
        vadFilter: false, // Always disable server-side VAD (model not bundled)
        hotwords: this.config.hotwords,
        initialPrompt: this.config.initialPrompt,
      });

            if (result && result.text.trim()) {
                const duration = Date.now() - startTime;
                console.log('[DesktopWhisper] Transcription complete in', duration, 'ms:', result.text.substring(0, 50) + '...');
                onResult({
                    text: result.text.trim(),
                    language: result.language,
                    segments: result.segments,
                });
            }

            this.config.onStatus?.('listening');
        } catch (error) {
            console.error('[DesktopWhisper] Error processing VAD utterance:', error);
            onError(error instanceof Error ? error.message : String(error));
            this.config.onStatus?.('error');
        }
    }

    /**
     * Start native audio capture (Rust-based)
     */
    private async startNativeCapture(
        onResult: ResultCallback,
        onError: ErrorCallback,
        chunkDurationMs: number,
        captureType: 'microphone' | 'system' = 'microphone'
    ): Promise<boolean> {
        try {
            console.log(`[DesktopWhisper] Starting native capture with type: ${captureType}`);
            const started = await nativeAudioCaptureManager.startWithEvents({
                captureType,
                chunkDurationMs,
                deviceName: this.config.microphoneDeviceId || undefined,
                onWavChunk: async (wavBase64: string, durationMs: number) => {
                    await this.processWavChunk(wavBase64, durationMs, onResult, onError);
                },
                onError: (errorMsg: string) => {
                    onError(errorMsg);
                },
            });

            if (started) {
                this.isRecording = true;
                console.log('Desktop whisper transcription started (event-driven native capture)');
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
     * Process a WAV chunk received from Rust via Tauri event
     * The WAV data is already base64-encoded Rust-side — just decode to Blob
     */
  private async processWavChunk(
    wavBase64: string,
    durationMs: number,
    onResult: ResultCallback,
    onError: ErrorCallback
  ): Promise<void> {
    try {
      if (!wavBase64 || wavBase64.length === 0) {
        console.log('[DesktopWhisper] Empty WAV chunk, skipping');
        return;
      }

      console.log('[DesktopWhisper] Processing WAV chunk:', {
        base64Length: wavBase64.length,
        duration_ms: durationMs,
      });

      // Convert base64 WAV to Blob (single conversion — no float32 dance)
      const binaryString = atob(wavBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const wavBlob = new Blob([bytes], { type: 'audio/wav' });

      console.log('[DesktopWhisper] WAV blob created:', {
        size: wavBlob.size,
        type: wavBlob.type,
      });

      // Send to desktop whisper server
      // Convert 'en-US' to 'en' - faster-whisper only accepts 2-letter codes
      const language = (this.config.language || 'en').split('-')[0];
      const result = await transcribeWithDesktopWhisper(wavBlob, {
        language,
        vadFilter: false, // Always disable server-side VAD (model not bundled)
        hotwords: this.config.hotwords,
        initialPrompt: this.config.initialPrompt,
      });

      if (result && result.text.trim()) {
        console.log('[DesktopWhisper] Transcription result:', result.text);
        onResult({
          text: result.text.trim(),
          language: result.language,
          segments: result.segments,
        });
      }
    } catch (error) {
            // Don't spam errors for timeouts - they're expected occasionally
            const isTimeout = error instanceof Error && (
                error.name === 'TimeoutError' ||
                error.message.includes('timed out')
            );

            if (!isTimeout) {
                console.error('[DesktopWhisper] Error processing WAV chunk:', error);
                onError(error instanceof Error ? error.message : 'Transcription error');
            } else {
                // Just log timeout occasionally
                if (Math.random() < 0.1) {
                    console.warn('[DesktopWhisper] Transcription timeout (server busy), skipping chunk');
                }
            }
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
            const audioConstraints: boolean | MediaTrackConstraints = this.config.microphoneDeviceId
                ? { deviceId: { exact: this.config.microphoneDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 }
                : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 }
            const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })

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
      // Convert 'en-US' to 'en' - faster-whisper only accepts 2-letter codes
      const language = (this.config.language || 'en').split('-')[0];
      const result = await transcribeWithDesktopWhisper(wavBlob, {
        language,
        vadFilter: false, // Always disable server-side VAD (model not bundled)
        hotwords: this.config.hotwords,
        initialPrompt: this.config.initialPrompt,
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

        // Abort any pending request
        this.abortController?.abort();
        this.abortController = null;

        // Stop VAD capture
        if (this.vad) {
            this.vad.pause();
            await this.vad.destroy();
            this.vad = null;
        }

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

        this.config.onStatus?.('stopped');
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
     * Check if using VAD-based capture
     */
    isUsingVAD(): boolean {
        return this.useVAD && this.vadLoaded;
    }

    /**
     * Check if using native audio capture
     */
    isUsingNativeCapture(): boolean {
        return this.useNativeCapture;
    }
}

export const desktopWhisperTranscriptionService = new DesktopWhisperTranscriptionService();
