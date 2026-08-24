/**
 * Thin wrapper over the Rust global-shortcut registry (`src-tauri/src/shortcuts.rs`).
 *
 * The registry owns every system-wide binding in the app — dictation's
 * push-to-talk key and, when it lands, presentation control. Callers hand it a
 * complete set rather than registering individually, because a binding that
 * nothing else can see is a binding nothing else can detect a conflict with.
 *
 * Everything here no-ops off the desktop: the browser build has no global
 * shortcuts and asking for them should not throw at a call site that has no
 * reason to care which platform it is on.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isDesktop } from '../../platform'

/**
 * Logical action names. Kept as a const map rather than free strings so a typo
 * is a compile error on both ends of the boundary — Rust treats the action as
 * opaque and will happily forward a misspelling forever.
 */
export const ShortcutAction = {
    /** Hold to dictate; release to commit. */
    DictationPushToTalk: 'dictation.push-to-talk',
    /** Press once to start, again to stop. */
    DictationToggle: 'dictation.toggle',
} as const

export type ShortcutActionName = (typeof ShortcutAction)[keyof typeof ShortcutAction]

export interface ShortcutBinding {
    action: ShortcutActionName
    /** Tauri accelerator, e.g. `"CommandOrControl+Shift+D"`. */
    accelerator: string
    /**
     * Whether this action needs key-release as well as key-press. Only
     * push-to-talk does; sending both for a one-shot action fires it twice.
     */
    wantsRelease?: boolean
}

/** One binding the OS refused, and why. */
export interface ShortcutFailure {
    action: string
    accelerator: string
    reason: string
}

export interface ShortcutTriggeredEvent {
    action: ShortcutActionName
    state: 'pressed' | 'released'
}

/** Rust uses snake_case on the wire; the TS side stays camelCase. */
interface WireBinding {
    action: string
    accelerator: string
    wants_release: boolean
}

function toWire(binding: ShortcutBinding): WireBinding {
    return {
        action: binding.action,
        accelerator: binding.accelerator,
        wants_release: binding.wantsRelease ?? false,
    }
}

/**
 * Replace every registered global shortcut with `bindings`.
 *
 * Returns the bindings that could not be applied — almost always because
 * another application already owns the combination. An empty array means they
 * all took. This never throws for a merely-unavailable key; a rejected
 * accelerator is a thing to show the operator, not an exception to handle.
 */
export async function setGlobalShortcuts(
    bindings: ShortcutBinding[],
): Promise<ShortcutFailure[]> {
    if (!isDesktop()) return []
    try {
        return await invoke<ShortcutFailure[]>('set_global_shortcuts', {
            bindings: bindings.map(toWire),
        })
    } catch (err) {
        console.error('[shortcuts] set_global_shortcuts failed:', err)
        // A failure here means the whole set is in an unknown state. Report each
        // one as failed rather than letting the caller believe they registered.
        const reason = err instanceof Error ? err.message : String(err)
        return bindings.map((binding) => ({
            action: binding.action,
            accelerator: binding.accelerator,
            reason,
        }))
    }
}

/** Drop every global shortcut. Safe to call when none are registered. */
export async function clearGlobalShortcuts(): Promise<void> {
    if (!isDesktop()) return
    try {
        await invoke('clear_global_shortcuts')
    } catch (err) {
        console.warn('[shortcuts] clear_global_shortcuts failed:', err)
    }
}

/** What is bound right now — for the settings UI and for diagnosis. */
export async function listGlobalShortcuts(): Promise<ShortcutBinding[]> {
    if (!isDesktop()) return []
    try {
        const wire = await invoke<WireBinding[]>('list_global_shortcuts')
        return wire.map((binding) => ({
            action: binding.action as ShortcutActionName,
            accelerator: binding.accelerator,
            wantsRelease: binding.wants_release,
        }))
    } catch (err) {
        console.warn('[shortcuts] list_global_shortcuts failed:', err)
        return []
    }
}

/** Subscribe to shortcut presses. Returns an unlisten function. */
export async function onShortcut(
    handler: (event: ShortcutTriggeredEvent) => void,
): Promise<UnlistenFn> {
    if (!isDesktop()) return () => {}
    return listen<ShortcutTriggeredEvent>('shortcut://triggered', (event) => {
        handler(event.payload)
    })
}

/**
 * The default dictation key.
 *
 * Deliberately not `Cmd/Alt+Space`, which is what most dictation tools reach for
 * first: on macOS that is Spotlight, and on Windows `Alt+Space` opens the window
 * menu. Both would register successfully on some machines and be swallowed on
 * others, which is worse than a duller key that always works. `Shift+D` for
 * "dictate" is free on every platform we ship.
 */
export const DEFAULT_DICTATION_HOTKEY = 'CommandOrControl+Shift+D'
