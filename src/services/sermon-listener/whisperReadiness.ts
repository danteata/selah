import { isDesktop } from '../../platform'

type Listener = (state: WhisperReadiness) => void

export interface WhisperReadiness {
    ready: boolean
    endpoint: string | null
    model: string | null
    error: string | null
}

const INITIAL_STATE: WhisperReadiness = {
    ready: false,
    endpoint: null,
    model: null,
    error: null,
}

let state: WhisperReadiness = { ...INITIAL_STATE }
const listeners = new Set<Listener>()
let subscribed = false

function notify() {
    const snapshot = { ...state }
    for (const fn of listeners) fn(snapshot)
}

async function checkWhisperReadyViaRust(): Promise<boolean> {
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        const result = await invoke<{ ready: boolean; model?: string }>('check_whisper_ready')
        if (result.model && !state.model) {
            state = { ...state, model: result.model }
        }
        return result.ready === true
    } catch {
        return false
    }
}

async function ensureSubscribed(): Promise<void> {
    if (subscribed) return
    if (!isDesktop()) return
    subscribed = true
    try {
        const { listen } = await import('@tauri-apps/api/event')

        await listen<{ endpoint?: string; model?: string; elapsed_ms?: number }>(
            'whisper-server://ready',
            (event) => {
                const payload = event.payload || {}
                console.log('[WhisperReadiness] ready event:', payload)
                state = {
                    ...state,
                    ready: true,
                    endpoint: payload.endpoint ?? state.endpoint,
                    model: typeof payload.model === 'string' ? payload.model : state.model,
                    error: null,
                }
                notify()
            },
        )

        await listen<{ error?: string }>('whisper-server://error', (event) => {
            state = {
                ...state,
                ready: false,
                error: event.payload?.error || 'whisper sidecar error',
            }
            notify()
        })

        // One-shot check — in case the Tauri event was already emitted
        // before we subscribed (race condition). Uses the Rust-side cache
        // (no HTTP) so this is instant.
        if (!state.ready) {
            const ready = await checkWhisperReadyViaRust()
            if (ready) {
                state = { ...state, ready: true, endpoint: 'http://127.0.0.1:17493', error: null }
                notify()
            }
        }
    } catch {
        subscribed = false
    }
}

export function getWhisperReadiness(): WhisperReadiness {
    void ensureSubscribed()
    return state
}

export function subscribeWhisperReadiness(fn: Listener): () => void {
    void ensureSubscribed()
    listeners.add(fn)
    fn({ ...state })
    return () => {
        listeners.delete(fn)
    }
}

export function __resetWhisperReadiness(): void {
    state = { ...INITIAL_STATE }
    subscribed = false
    listeners.clear()
}

export async function setSermonListenerEnabled(enabled: boolean): Promise<boolean> {
    if (!isDesktop()) return false
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        return await invoke<boolean>('set_sermon_listener_enabled', { enabled })
    } catch {
        return false
    }
}

export async function getSermonListenerEnabled(): Promise<boolean> {
    if (!isDesktop()) return true
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        return await invoke<boolean>('get_sermon_listener_enabled')
    } catch {
        return true
    }
}
