/**
 * Desktop Whisper Service
 * 
 * Provides transcription using the bundled faster-whisper server
 * in the Tauri desktop app. Falls back to web-based services when
 * not running in desktop mode.
 */

import { platform, isDesktop } from '@/platform';

const DESKTOP_WHISPER_PORT = 17493;
const DESKTOP_WHISPER_URL = `http://127.0.0.1:${DESKTOP_WHISPER_PORT}`;

export interface DesktopWhisperConfig {
    model?: string;
    language?: string;
    vadFilter?: boolean;
    hotwords?: string;
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
 * Check if the desktop whisper server is available
 */
export async function isDesktopWhisperAvailable(): Promise<boolean> {
    if (!isDesktop()) {
        return false;
    }

    try {
        const response = await fetch(`${DESKTOP_WHISPER_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000),
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
        // Use Tauri command to get status
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
 * Transcribe audio using the desktop whisper server
 */
export async function transcribeWithDesktopWhisper(
    audioBlob: Blob,
    config?: DesktopWhisperConfig
): Promise<DesktopWhisperResult | null> {
    if (!isDesktop()) {
        return null;
    }

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
            signal: AbortSignal.timeout(120000), // 2 minute timeout for longer audio
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DesktopWhisperService] Server error response:', errorText);
            throw new Error(`Transcription failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json() as DesktopWhisperResult;
        return result;
    } catch (error) {
        // Don't log timeout errors - they're expected occasionally
        if (error instanceof Error && !error.name.includes('Timeout')) {
            console.error('[DesktopWhisperService] Transcription failed:', error);
        }
        throw error;
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
