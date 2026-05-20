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

// Module-level promise to deduplicate concurrent init() calls (e.g. React StrictMode)
let initPromise: Promise<boolean> | null = null

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
    private pendingVADTranscription: Promise<void> = Promise.resolve();

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

        if (this.isInitialized) {
            console.log('[DesktopWhisper] Already initialized, skipping duplicate init');
            this.config.onProgress?.(1);
            this.config.onStatus?.('Ready');
            return true;
        }

        // Deduplicate concurrent init() calls (React StrictMode calls effects twice)
        if (initPromise) {
            console.log('[DesktopWhisper] Init already in progress, awaiting existing promise');
            return initPromise;
        }

        initPromise = this._doInit(config);
        try {
            return await initPromise;
        } finally {
            initPromise = null;
        }
    }

    private async _doInit(config: DesktopWhisperTranscriptionConfig = {}): Promise<boolean> {
        this.config = { ...config };
        this.useVAD = config.useVAD !== false;
        this.useNativeCapture = config.useNativeAudio !== false;

        this.config.onStatus?.('Initializing desktop whisper service...');

        if (this.useVAD) {
            this.config.onStatus?.('Loading VAD library...');
            const vadLoaded = await this.loadVADScripts();
            if (!vadLoaded) {
                console.warn('VAD library failed to load, falling back to time-based chunking');
                this.useVAD = false;
            }
        }

        if (!this.useVAD && this.useNativeCapture) {
            const nativeAvailable = await isNativeAudioCaptureAvailable();
            if (!nativeAvailable) {
                console.warn('Native audio capture not available, falling back to web audio');
                this.useNativeCapture = false;
            }
        }

        this.config.onStatus?.('Starting whisper server...');
        this.config.onProgress?.(0.2);

        let endpoint: string | null = null;
        try {
            endpoint = await startDesktopWhisperServer({
                model: config.model || 'base.en',
                language: config.language,
                vadFilter: false,
                hotwords: config.hotwords,
            });
        } catch (err) {
            console.warn('[DesktopWhisper] startDesktopWhisperServer threw, server may already be running from prewarm:', err);
        }

        if (endpoint) {
            console.log('[DesktopWhisper] Server endpoint:', endpoint);
        } else {
            console.log('[DesktopWhisper] No endpoint from invoke — server may already be running from prewarm');
        }

        this.isInitialized = true;
        this.config.onProgress?.(0.6);
        this.config.onStatus?.('Server starting, will be ready shortly...');
        console.log('[DesktopWhisper] Init complete, waiting for readiness event');
        return true;
    }

    /**
     * Load VAD library scripts dynamically
     */
    private async loadVADScripts(): Promise<boolean> {
        if (this.vadLoaded && window.vad?.MicVAD && window.vad?.utils) {
            return true;
        }

        // Skip if loader script is already in the DOM
        if (document.querySelector('script[src="/vad-loader.js"]')) {
            let attempts = 0;
            const maxAttempts = 50;
            while (attempts < maxAttempts) {
                if (window.vad?.MicVAD && window.vad?.utils) {
                    this.vadLoaded = true;
                    return true;
                }
                attempts++;
                await new Promise(r => setTimeout(r, 100));
            }
            console.error('[DesktopWhisper] Timeout waiting for existing VAD loader');
            return false;
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

            const requestedDeviceId = this.config.microphoneDeviceId;

            const getStreamWithFallback = async (): Promise<MediaStream> => {
                if (requestedDeviceId) {
                    try {
                        return await navigator.mediaDevices.getUserMedia({
                            audio: {
                                deviceId: { exact: requestedDeviceId },
                                channelCount: 1,
                                noiseSuppression: { ideal: true },
                                echoCancellation: { ideal: true },
                                autoGainControl: { ideal: true },
                            },
                        });
                    } catch (err) {
                        if (err instanceof OverconstrainedError) {
                            console.warn('[DesktopWhisper] Microphone device not available, falling back to default:', err.message);
                        } else {
                            console.warn('[DesktopWhisper] Failed to get specified microphone, falling back to default:', err);
                        }
                    }
                }
                return navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        noiseSuppression: { ideal: true },
                        echoCancellation: { ideal: true },
                        autoGainControl: { ideal: true },
                    },
                });
            };

            const vadOptions: Parameters<MicVADStatic['new']>[0] = {
                baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
                onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
                getStream: getStreamWithFallback,
                onSpeechStart: () => {
                    console.log('[DesktopWhisper] Speech started');
                    this.config.onSpeechStart?.();
                    this.config.onStatus?.('speech');
                },
                onSpeechEnd: async (audio: Float32Array) => {
                    console.log('[DesktopWhisper] Speech ended, audio length:', audio.length);
                    this.config.onSpeechEnd?.();
                    this.config.onStatus?.('processing');
                    this.pendingVADTranscription = this.pendingVADTranscription
                        .then(() => this.processVADUtterance(audio, onResult, onError))
                        .catch((error) => {
                            console.error('[DesktopWhisper] Queued VAD processing error:', error);
                        });
                    await this.pendingVADTranscription;
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

            const result = await this.transcribeBlobWithRetry(blob, utteranceId);

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

    private async transcribeBlobWithRetry(audioBlob: Blob, traceId: string): Promise<DesktopWhisperResult | null> {
        const language = (this.config.language || 'en').split('-')[0];
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await transcribeWithDesktopWhisper(audioBlob, {
                    language,
                    vadFilter: false,
                    hotwords: this.config.hotwords,
                    initialPrompt: this.config.initialPrompt,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const retriable = /failed to fetch|could not connect|networkerror|timed out|aborted|fetch/i.test(message);
                if (!retriable || attempt === maxAttempts) {
                    throw error;
                }
                const backoffMs = 250 * attempt;
                console.warn(`[DesktopWhisper] Transcribe retry ${attempt}/${maxAttempts} for ${traceId}: ${message}`);
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }

        return null;
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

      const result = await this.transcribeBlobWithRetry(wavBlob, `native-${Date.now()}`);

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
            let mediaStream: MediaStream;
            try {
                const audioConstraints: boolean | MediaTrackConstraints = this.config.microphoneDeviceId
                    ? { deviceId: { exact: this.config.microphoneDeviceId }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, sampleRate: 16000 }
                    : { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, sampleRate: 16000 }
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
            } catch (err) {
                if (err instanceof OverconstrainedError && this.config.microphoneDeviceId) {
                    console.warn('[DesktopWhisper] Microphone device not available for web capture, falling back to default:', err.message);
                    mediaStream = await navigator.mediaDevices.getUserMedia({
                        audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, sampleRate: 16000 }
                    })
                } else {
                    throw err;
                }
            }

            const audioContext = new AudioContext({ sampleRate: 16000 });
            const source = audioContext.createMediaStreamSource(mediaStream);

            // Create audio worklet for capturing and encoding PCM data to WAV directly
            const workletBlob = new Blob(
                [
                    `
                    class AudioCaptureProcessor extends AudioWorkletProcessor {
                        constructor() {
                            super();
                            this.buffer = [];
                            this.bufferSize = ${16000 * (chunkDurationMs / 1000)};
                        }
                        
                        process(inputs, outputs, parameters) {
                            const input = inputs[0];
                            if (input.length > 0) {
                                const channelData = input[0];
                                const copy = new Float32Array(channelData.length);
                                for (let i = 0; i < channelData.length; i++) {
                                    copy[i] = channelData[i];
                                }
                                this.buffer.push(copy);
                                
                                if (this.buffer.length >= this.bufferSize) {
                                    const totalSamples = this.buffer.reduce((sum, arr) => sum + arr.length, 0);
                                    const combined = new Float32Array(totalSamples);
                                    let offset = 0;
                                    for (const chunk of this.buffer) {
                                        combined.set(chunk, offset);
                                        offset += chunk.length;
                                    }
                                    this.buffer = [];
                                    
                                    // Encode to WAV in the worklet to avoid main-thread blocking
                                    const wavBlob = this.encodeWav(combined, 16000);
                                    this.port.postMessage({ wavBlob });
                                }
                            }
                            return true;
                        }
                        
                        encodeWav(samples, sampleRate) {
                            const buffer = new ArrayBuffer(44 + samples.length * 2);
                            const view = new DataView(buffer);
                            
                            const writeString = (offset, str) => {
                                for (let i = 0; i < str.length; i++) {
                                    view.setUint8(offset + i, str.charCodeAt(i));
                                }
                            };
                            
                            writeString(0, 'RIFF');
                            view.setUint32(4, 36 + samples.length * 2, true);
                            writeString(8, 'WAVE');
                            writeString(12, 'fmt ');
                            view.setUint32(16, 16, true);
                            view.setUint16(20, 1, true);
                            view.setUint16(22, 1, true);
                            view.setUint32(24, sampleRate, true);
                            view.setUint32(28, sampleRate * 2, true);
                            view.setUint16(32, 2, true);
                            view.setUint16(34, 16, true);
                            writeString(36, 'data');
                            view.setUint32(40, samples.length * 2, true);
                            
                            let offset = 44;
                            for (let i = 0; i < samples.length; i++) {
                                const s = Math.max(-1, Math.min(1, samples[i]));
                                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
                                offset += 2;
                            }
                            
                            return new Blob([buffer], { type: 'audio/wav' });
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

            // Handle audio chunks — WAV blob already encoded in the worklet
            workletNode.port.onmessage = async (event) => {
                if (event.data.wavBlob) {
                    await this.transcribeBlobWithRetry(event.data.wavBlob, `web-${Date.now()}`)
                        .then((result) => {
                            if (result && result.text.trim()) {
                                onResult({
                                    text: result.text.trim(),
                                    language: result.language,
                                    segments: result.segments,
                                })
                            }
                        })
                        .catch((error) => {
                            console.error('Error processing web audio chunk:', error)
                            onError(error instanceof Error ? error.message : 'Transcription error')
                        })
                }
            }

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

    getMediaStream(): MediaStream | null {
        return this._webMediaStream
    }
}

export const desktopWhisperTranscriptionService = new DesktopWhisperTranscriptionService();
