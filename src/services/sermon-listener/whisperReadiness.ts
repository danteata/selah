/**
 * Whisper Sidecar Readiness Bridge
 *
 * Subscribes once to the Tauri `whisper-server://ready` event emitted from
 * `src-tauri/src/main.rs` and re-exposes it as a small reactive API.
 *
 * The Rust side eagerly launches the bundled `selah-whisper-server` sidecar
 * at app boot via `prewarm_whisper_server()`, then emits `whisper-server://ready`
 * with `{ endpoint, model? }` once `/health` returns `model_loaded: true`.
 *
 * Without this bridge, the React side had to wait 8 s and then poll the HTTP
 * endpoint itself. With this bridge, `providerReady` flips the moment the
 * model is hot, typically < 3 s after launch.
 *
 * On web (non-Tauri) builds this is a no-op and `isReady()` always returns
 * `false` so the existing fallback paths (web-speech) keep working.
 */

import { isDesktop } from '../../platform'

type Listener = (state: WhisperReadiness) => void

export interface WhisperReadiness {
    /** Whether the sidecar `/health` endpoint reported `model_loaded: true`. */
    ready: boolean
    /** HTTP endpoint of the sidecar (typically `http://127.0.0.1:17493`). */
    endpoint: string | null
    /** Last reported model name, when available. */
    model: string | null
    /** Whether the sidecar started but never confirmed model load (still polling). */
    degraded: boolean
    /** Last error reported by the sidecar (e.g. failed to spawn). */
    error: string | null
}

const INITIAL_STATE: WhisperReadiness = {
    ready: false,
    endpoint: null,
    model: null,
    degraded: false,
    error: null,
}

let state: WhisperReadiness = { ...INITIAL_STATE }
const listeners = new Set<Listener>()
let subscribed = false

function notify() {
    const snapshot = { ...state }
    for (const fn of listeners) fn(snapshot)
}

async function ensureSubscribed(): Promise<void> {
    if (subscribed) return
    if (!isDesktop()) return
    subscribed = true
    try {
        const { listen } = await import('@tauri-apps/api/event')

        await listen<{ endpoint?: string; model?: string; degraded?: boolean }>(
            'whisper-server://ready',
            (event) => {
                const payload = event.payload || {}
                state = {
                    ...state,
                    ready: !payload.degraded,
                    endpoint: payload.endpoint ?? state.endpoint,
                    model: typeof payload.model === 'string' ? payload.model : state.model,
                    degraded: Boolean(payload.degraded),
                    error: null,
                }
                notify()
            },
        )

        await listen<{ error?: string }>('whisper-server://error', (event) => {
            state = {
                ...state,
                ready: false,
                degraded: false,
                error: event.payload?.error || 'whisper sidecar error',
            }
            notify()
        })
    } catch {
        // listen() will fail in non-Tauri contexts; we silently ignore.
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
    // Replay current state so late subscribers don't miss a `ready` event.
    fn({ ...state })
    return () => {
        listeners.delete(fn)
    }
}

/**
 * Test-only reset. Not exported for production use.
 */
export function __resetWhisperReadiness(): void {
    state = { ...INITIAL_STATE }
    subscribed = false
    listeners.clear()
}
