/**
 * Voice search in the phone app (Tauri on Android). Its web view has no Web
 * Speech, so the app asks Android's speech recognizer for one phrase instead
 * (mobile/src-tauri: `speech_listen`, SpeechPlugin.kt).
 */

import { isTauriMobile } from '../../platform'

export function phoneSpeechAvailable(): boolean {
    return isTauriMobile()
}

/** Listen for one phrase; resolves to what was said, or '' for nothing. */
export async function listenOnPhone(): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('speech_listen')
}

/** Stop early: `listenOnPhone` then resolves with what was heard. */
export async function stopListeningOnPhone(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('speech_stop')
}
