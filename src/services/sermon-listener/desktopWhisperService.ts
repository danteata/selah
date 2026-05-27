/**
 * Desktop Whisper Service
 * 
 * Provides transcription using the bundled faster-whisper server
 * in the Tauri desktop app. Falls back to web-based services when
 * not running in desktop mode.
 * 
 * Includes automatic server health-check and restart on crash
 * (max 3 restarts per session) to prevent silent transcription
 * failure during a live sermon.
 */

import { platform, isDesktop } from '@/platform';

const DESKTOP_WHISPER_PORT = 17493;
const DESKTOP_WHISPER_URL = `http://127.0.0.1:${DESKTOP_WHISPER_PORT}`;

const MAX_RESTART_ATTEMPTS = 3
const HEALTH_CHECK_TIMEOUT_MS = 3000
const RESTART_COOLDOWN_MS = 5000

let restartAttempts = 0
let lastRestartTime = 0

export interface DesktopWhisperConfig {
  model?: string;
  language?: string;
  vadFilter?: boolean;
  hotwords?: string;
  initialPrompt?: string;
}

export interface DesktopWhisperResult {
    text: string;
    language?: string;
    language_probability?: number;
    segments?: Array<{
        start: number;
        end: number;
        text: string;
    }>;
}

export interface WhisperStreamEvent {
    type: 'segment' | 'result' | 'error';
    start?: number;
    end?: number;
    text?: string;
    progress?: number;
    code?: string;
    message?: string;
    language?: string;
    language_probability?: number;
    segments?: Array<{ start: number; end: number; text: string }>;
}

export interface StreamingTranscriptionCallbacks {
    onSegment?: (segment: { start: number; end: number; text: string }) => void;
    onResult?: (result: DesktopWhisperResult) => void;
    onError?: (error: { code: string; message: string }) => void;
}

export interface WhisperServerStatus {
    running: boolean;
    port: number;
    health?: {
        status: string;
        model: string;
        model_loaded: boolean;
    };
}

/**
 * Check if the local whisper server is healthy.
 */
async function checkServerHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${DESKTOP_WHISPER_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Attempt to restart the whisper server if it appears to have crashed.
 * Respects a per-session limit (MAX_RESTART_ATTEMPTS) and a per-attempt
 * cooldown so we don't hammer the system.
 */
export async function restartServerIfNeeded(): Promise<boolean> {
    if (!isDesktop()) return false;

    // Respect per-session restart limit
    if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
        console.warn('[DesktopWhisperService] Max restart attempts reached — not retrying');
        return false;
    }

    // Respect cooldown between restart attempts
    const now = Date.now();
    if (now - lastRestartTime < RESTART_COOLDOWN_MS) {
        console.log('[DesktopWhisperService] Restart cooldown active, skipping');
        return false;
    }

    lastRestartTime = now;
    restartAttempts++;

    console.log(`[DesktopWhisperService] Attempting server restart (${restartAttempts}/${MAX_RESTART_ATTEMPTS})`);

    try {
        const endpoint = await startDesktopWhisperServer({
            model: 'base.en',
        });

        if (endpoint) {
            // Give the server a moment to become ready
            await new Promise(resolve => setTimeout(resolve, 2000));

            const healthy = await checkServerHealth();
            if (healthy) {
                console.log('[DesktopWhisperService] Server restarted successfully');
                return true;
            }
        }

        console.warn('[DesktopWhisperService] Server restart did not produce a healthy server');
        return false;
    } catch (error) {
        console.error('[DesktopWhisperService] Server restart failed:', error);
        return false;
    }
}

/**
 * Reset the restart counter (called when a full session starts fresh).
 */
export function resetRestartAttempts(): void {
    restartAttempts = 0;
}

/**
 * Transcribe audio using the desktop whisper server.
 * 
 * If the server appears to be down (connection refused / timeout),
 * attempts an automatic restart before retrying the request.
 */
export async function transcribeWithDesktopWhisper(
    audioBlob: Blob,
    config?: DesktopWhisperConfig
): Promise<DesktopWhisperResult | null> {
    if (!isDesktop()) {
        return null;
    }

    let lastError: Error | null = null;

    // Try transcription, auto-restart on server failure
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'audio.wav');

            if (config?.language) {
                formData.append('language', config.language);
            }
            if (config?.vadFilter !== undefined) {
                formData.append('vad_filter', config.vadFilter.toString());
            }
            if (config?.hotwords) {
                formData.append('hotwords', config.hotwords);
            }
            if (config?.initialPrompt) {
                formData.append('initial_prompt', config.initialPrompt);
            }

            // Only log occasionally to reduce noise
            if (Math.random() < 0.1) {
                console.log('[DesktopWhisperService] Sending transcription request:', {
                    url: `${DESKTOP_WHISPER_URL}/transcribe`,
                    blobSize: audioBlob.size,
                });
            }

            const response = await fetch(`${DESKTOP_WHISPER_URL}/transcribe`, {
                method: 'POST',
                body: formData,
                signal: AbortSignal.timeout(120000),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[DesktopWhisperService] Server error response:', errorText);

                // Server is up but returned an error — this is not a crash
                const error = new Error(`Transcription failed: ${response.status} - ${errorText}`);

                // Classify: 4xx = user error (bad audio, wrong format), don't retry
                if (response.status >= 400 && response.status < 500) {
                    throw error;
                }

                // 5xx = server error, might be worth retrying after restart
                if (attempt === 0 && response.status >= 500) {
                    console.log('[DesktopWhisperService] 5xx error, attempting server restart');
                    const restarted = await restartServerIfNeeded();
                    if (restarted) continue;
                }

                throw error;
            }

            const result = await response.json() as DesktopWhisperResult;
            return result;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Network errors (connection refused, timeout) suggest the server crashed
            const isNetworkError = /failed to fetch|could not connect|networkerror|timed out|aborted|fetch/i.test(lastError.message);

            if (isNetworkError && attempt === 0) {
                console.log('[DesktopWhisperService] Network error — server may have crashed, attempting restart');
                const restarted = await restartServerIfNeeded();
                if (restarted) continue;
            }

            // Non-retryable or second attempt failed
            break;
        }
    }

    throw lastError || new Error('Transcription failed');
}

/**
 * Check if the desktop whisper server is available
 */
export async function isDesktopWhisperAvailable(): Promise<boolean> {
    if (!isDesktop()) {
        return false;
    }

    try {
        const response = await fetch(`${DESKTOP_WHISPER_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Get the status of the desktop whisper server
 */
export async function getDesktopWhisperStatus(): Promise<WhisperServerStatus | null> {
    if (!isDesktop()) {
        return null;
    }

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<WhisperServerStatus>('get_whisper_server_status');
        return status;
    } catch (error) {
        console.error('Failed to get whisper server status:', error);
        return null;
    }
}

/**
 * Start the desktop whisper server
 */
export async function startDesktopWhisperServer(config?: DesktopWhisperConfig): Promise<string | null> {
    if (!isDesktop()) {
        console.log('Not running in desktop mode, cannot start whisper server');
        return null;
    }

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const endpoint = await invoke<string>('start_whisper_server', {
            model: config?.model || 'base.en',
        });
        console.log('Whisper server started:', endpoint);
        return endpoint;
    } catch (error) {
        console.error('Failed to start whisper server:', error);
        return null;
    }
}

/**
 * Stop the desktop whisper server
 */
export async function stopDesktopWhisperServer(): Promise<void> {
    if (!isDesktop()) {
        return;
    }

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('stop_whisper_server');
        console.log('Whisper server stopped');
    } catch (error) {
        console.error('Failed to stop whisper server:', error);
    }
}

/**
 * Transcribe raw PCM audio data
 */
export async function transcribeRawAudio(
    pcmData: ArrayBuffer,
    sampleRate: number = 16000,
    config?: DesktopWhisperConfig
): Promise<DesktopWhisperResult | null> {
    if (!isDesktop()) {
        return null;
    }

    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'X-Sample-Rate': sampleRate.toString(),
        };

        if (config?.language) {
            headers['X-Language'] = config.language;
        }
        if (config?.vadFilter !== undefined) {
            headers['X-VAD-Filter'] = config.vadFilter.toString();
        }

        const response = await fetch(`${DESKTOP_WHISPER_URL}/transcribe-raw`, {
            method: 'POST',
            headers,
            body: pcmData,
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            throw new Error(`Transcription failed: ${response.status}`);
        }

        const result = await response.json() as DesktopWhisperResult;
        return result;
    } catch (error) {
        console.error('Desktop whisper transcription failed:', error);
        return null;
    }
}

/**
 * List available models on the desktop whisper server
 */
export async function listDesktopWhisperModels(): Promise<Array<{
    id: string;
    size: string;
    description: string;
}>> {
    try {
        const response = await fetch(`${DESKTOP_WHISPER_URL}/models`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            throw new Error(`Failed to list models: ${response.status}`);
        }

        const data = await response.json() as { models: Array<{ id: string; size: string; description: string }> };
        return data.models;
    } catch (error) {
        console.error('Failed to list whisper models:', error);
        return [];
    }
}

/**
 * Load a specific model on the desktop whisper server
 */
export async function loadDesktopWhisperModel(modelId: string): Promise<boolean> {
    try {
        const response = await fetch(`${DESKTOP_WHISPER_URL}/load-model`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: modelId }),
            signal: AbortSignal.timeout(60000), // 60 second timeout for model loading
        });

        return response.ok;
    } catch (error) {
        console.error('Failed to load whisper model:', error);
        return false;
    }
}

/**
 * Parse a line-buffered ndjson stream from the whisper server.
 * Handles partial lines across chunk boundaries correctly.
 */
function parseNdjsonStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    callbacks: StreamingTranscriptionCallbacks,
    decoder: TextDecoder
): Promise<DesktopWhisperResult | null> {
    let buffer = '';
    let finalResult: DesktopWhisperResult | null = null;

    return (async () => {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                try {
                    const event = JSON.parse(trimmed) as WhisperStreamEvent;

                    if (event.type === 'segment' && event.start !== undefined && event.end !== undefined && event.text !== undefined) {
                        callbacks.onSegment?.({ start: event.start, end: event.end, text: event.text });
                    } else if (event.type === 'result') {
                        finalResult = {
                            text: event.text ?? '',
                            language: event.language,
                            language_probability: event.language_probability,
                            segments: event.segments,
                        };
                        callbacks.onResult?.(finalResult);
                    } else if (event.type === 'error') {
                        callbacks.onError?.({
                            code: event.code ?? 'streaming_error',
                            message: event.message ?? 'Unknown streaming error',
                        });
                    }
                } catch {
                    console.warn('[DesktopWhisperService] Failed to parse ndjson line:', trimmed);
                }
            }
        }

        const remaining = buffer.trim();
        if (remaining) {
            try {
                const event = JSON.parse(remaining) as WhisperStreamEvent;
                if (event.type === 'result') {
                    finalResult = {
                        text: event.text ?? '',
                        language: event.language,
                        language_probability: event.language_probability,
                        segments: event.segments,
                    };
                    callbacks.onResult?.(finalResult);
                } else if (event.type === 'error') {
                    callbacks.onError?.({
                        code: event.code ?? 'streaming_error',
                        message: event.message ?? 'Unknown streaming error',
                    });
                }
            } catch {
                console.warn('[DesktopWhisperService] Failed to parse final ndjson line:', remaining);
            }
        }

        return finalResult;
    })();
}

/**
 * Transcribe audio using the desktop whisper server with ndjson streaming.
 *
 * Streams segment events as they're decoded, enabling progressive display.
 * Falls back to non-streaming mode if streaming fails.
 */
export async function transcribeWithDesktopWhisperStreaming(
    audioBlob: Blob,
    callbacks: StreamingTranscriptionCallbacks,
    config?: DesktopWhisperConfig
): Promise<DesktopWhisperResult | null> {
    if (!isDesktop()) {
        return null;
    }

    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.wav');
        formData.append('response_format', 'ndjson');

        if (config?.language) {
            formData.append('language', config.language);
        }
        if (config?.vadFilter !== undefined) {
            formData.append('vad_filter', config.vadFilter.toString());
        }
        if (config?.hotwords) {
            formData.append('hotwords', config.hotwords);
        }
        if (config?.initialPrompt) {
            formData.append('initial_prompt', config.initialPrompt);
        }

        const response = await fetch(`${DESKTOP_WHISPER_URL}/transcribe`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(120000),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DesktopWhisperService] Streaming transcription error:', errorText);
            callbacks.onError?.({
                code: response.status >= 500 ? 'server_error' : 'client_error',
                message: `Transcription failed: ${response.status} - ${errorText}`,
            });

            if (response.status >= 500) {
                const restarted = await restartServerIfNeeded();
                if (restarted) {
                    return transcribeWithDesktopWhisperStreaming(audioBlob, callbacks, config);
                }
            }

            throw new Error(`Streaming transcription failed: ${response.status}`);
        }

        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('application/x-ndjson') || contentType.includes('text/') || contentType.includes('application/json')) {
            if (!response.body) {
                console.warn('[DesktopWhisperService] No readable stream, falling back to JSON parse');
                const json = await response.json() as DesktopWhisperResult;
                callbacks.onResult?.(json);
                return json;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const result = await parseNdjsonStream(reader, callbacks, decoder);
            return result;
        }

        const json = await response.json() as DesktopWhisperResult;
        callbacks.onResult?.(json);
        return json;
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const isNetworkError = /failed to fetch|could not connect|networkerror|timed out|aborted|fetch/i.test(err.message);

        if (isNetworkError) {
            console.log('[DesktopWhisperService] Network error in streaming — server may have crashed, attempting restart');
            const restarted = await restartServerIfNeeded();
            if (restarted) {
                return transcribeWithDesktopWhisperStreaming(audioBlob, callbacks, config);
            }
        }

        throw err;
    }
}

/**
 * Hook for using desktop whisper in React components
 */
export function useDesktopWhisper() {
    const startServer = async (model?: string) => {
        return startDesktopWhisperServer({ model });
    };

    const stopServer = async () => {
        await stopDesktopWhisperServer();
    };

    const getStatus = async () => {
        return getDesktopWhisperStatus();
    };

    const transcribe = async (audio: Blob | ArrayBuffer, config?: DesktopWhisperConfig) => {
        if (audio instanceof ArrayBuffer) {
            return transcribeRawAudio(audio, 16000, config);
        }
        return transcribeWithDesktopWhisper(audio, config);
    };

    const isAvailable = async () => {
        return isDesktopWhisperAvailable();
    };

    return {
        startServer,
        stopServer,
        getStatus,
        transcribe,
        isAvailable,
        listModels: listDesktopWhisperModels,
        loadModel: loadDesktopWhisperModel,
    };
}
