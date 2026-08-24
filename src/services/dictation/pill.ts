/**
 * The dictation pill, from the React side.
 *
 * The window itself is built in Rust (`src-tauri/src/dictation_pill.rs`) — it
 * has to be, since it needs `focused(false)` and click-through at creation
 * time. This module is the remote control: create it warm, show it, tell it
 * what the session is doing, put it away.
 *
 * Everything no-ops off the desktop, so `useDictation` does not have to branch.
 */
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { isDesktop } from '../../platform'

export type PillState = 'listening' | 'transcribing'

/**
 * Failures here are deliberately warnings rather than throws. A missing
 * indicator is a cosmetic problem; letting it abort `begin()` would turn it
 * into a dictation that never records.
 */
function warn(action: string, err: unknown) {
    console.warn(`[dictation-pill] ${action} failed:`, err)
}

/**
 * Build the pill hidden, so the first dictation does not wait on a webview.
 * Called when the feature is switched on. Safe to call repeatedly.
 */
export async function preloadPill(): Promise<void> {
    if (!isDesktop()) return
    try {
        await invoke('ensure_dictation_pill')
    } catch (err) {
        warn('preload', err)
    }
}

/** Position on the current display and show. */
export async function showPill(state: PillState = 'listening'): Promise<void> {
    if (!isDesktop()) return
    try {
        // State first, then show: the page reads its label from the event, and
        // showing first would flash "Listening…" before a pill that opened
        // straight into transcribing.
        await setPillState(state)
        await invoke('show_dictation_pill')
    } catch (err) {
        warn('show', err)
    }
}

export async function hidePill(): Promise<void> {
    if (!isDesktop()) return
    try {
        await invoke('hide_dictation_pill')
    } catch (err) {
        warn('hide', err)
    }
}

/** Destroy the webview — for when dictation is switched off. */
export async function destroyPill(): Promise<void> {
    if (!isDesktop()) return
    try {
        await invoke('close_dictation_pill')
    } catch (err) {
        warn('destroy', err)
    }
}

/**
 * Tell the pill what the session is doing.
 *
 * A broadcast rather than `emitTo`: the pill may not exist yet on the very
 * first call, and a broadcast to a window that is not there is a no-op instead
 * of an error.
 */
export async function setPillState(state: PillState): Promise<void> {
    if (!isDesktop()) return
    try {
        await emit('dictation://state', { state })
    } catch (err) {
        warn('setState', err)
    }
}
