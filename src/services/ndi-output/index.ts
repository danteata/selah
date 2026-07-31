/**
 * NDI Output Service
 * 
 * TypeScript interface for NDI (Network Device Interface) output.
 * Communicates with the Rust backend via Tauri IPC.
 */

export interface NdiOutputConfig {
    sourceName: string
    includeAudio: boolean
    audioSampleRate: number
    audioChannels: number
}

export interface NdiOutputState {
    isAvailable: boolean
    isRunning: boolean
    sourceName: string
    framesSent: number
    error: string | null
}

export interface NdiSourceInfo {
    name: string
    address: string
}

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

async function getInvoke() {
    if (!isTauri()) return null
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        return invoke
    } catch {
        return null
    }
}

class NdiOutputService {
    async isAvailable(): Promise<boolean> {
        const invoke = await getInvoke()
        if (!invoke) return false
        try {
            return await invoke<boolean>('ndi_is_available')
        } catch {
            return false
        }
    }

    /**
     * Whether this build has NDI compiled in — distinct from whether the runtime
     * is installed on the machine. Releases ship with it since 0.1.12, so in
     * practice this is only false in a build that deliberately dropped the
     * feature; the difference decides what the UI tells the operator to do.
     */
    async isSupported(): Promise<boolean> {
        const invoke = await getInvoke()
        if (!invoke) return false
        try {
            return await invoke<boolean>('ndi_is_supported')
        } catch {
            // An older binary without the command — infer from availability.
            return false
        }
    }

    async getState(): Promise<NdiOutputState> {
        const invoke = await getInvoke()
        if (!invoke) {
            return {
                isAvailable: false,
                isRunning: false,
                sourceName: '',
                framesSent: 0,
                error: null,
            }
        }
        try {
            const state = await invoke<NdiOutputState>('ndi_get_state')
            return state
        } catch {
            return {
                isAvailable: false,
                isRunning: false,
                sourceName: '',
                framesSent: 0,
                error: null,
            }
        }
    }

    async startOutput(config?: Partial<NdiOutputConfig>): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) throw new Error('NDI output requires desktop app')

        const fullConfig: NdiOutputConfig = {
            sourceName: config?.sourceName || 'Selah Live Output',
            // Opt-in: see NdiOutputConfig::default in Rust. Requesting audio makes
            // macOS ask to record "screen and audio" rather than just the screen.
            includeAudio: config?.includeAudio ?? false,
            audioSampleRate: config?.audioSampleRate || 48000,
            audioChannels: config?.audioChannels || 2,
        }

        await invoke('ndi_start_output', { config: fullConfig })
    }

    async stopOutput(): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) throw new Error('NDI output requires desktop app')
        await invoke('ndi_stop_output')
    }

    async sendVideoFrame(data: Uint8Array, width: number, height: number): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) return
        await invoke('ndi_send_video_frame', {
            data: Array.from(data),
            width,
            height,
        })
    }

    async sendAudioFrame(data: Float32Array, sampleRate: number, channels: number, numSamples: number): Promise<void> {
        const invoke = await getInvoke()
        if (!invoke) return
        await invoke('ndi_send_audio_frame', {
            data: Array.from(data),
            sampleRate,
            channels,
            numSamples,
        })
    }

    async discoverSources(timeoutSecs?: number): Promise<NdiSourceInfo[]> {
        const invoke = await getInvoke()
        if (!invoke) return []
        try {
            return await invoke<NdiSourceInfo[]>('ndi_discover_sources', {
                timeoutSecs: timeoutSecs || 5,
            })
        } catch {
            return []
        }
    }
}

export const ndiOutputService = new NdiOutputService()