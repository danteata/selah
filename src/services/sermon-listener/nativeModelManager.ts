/**
 * Native (in-process) transcription model manager — frontend bridge to the Rust
 * `transcription::commands`. Replaces the Python-sidecar model manager: the
 * catalog now lives in Rust, downloads are resumable/verified and report
 * progress via the `model-download-progress` event.
 *
 * Whisper models are GGUF files; Parakeet is a multilingual ONNX model with
 * automatic language detection. The actual engine load happens in Rust once the
 * `native-transcription` build is wired (Phase 3b); this module covers listing,
 * downloading, and selection.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isDesktop } from '@/platform'

export type NativeEngineType =
    | 'transcribecpp'
    | 'parakeet'
    | 'moonshine'
    | 'moonshinestreaming'
    | 'sensevoice'
    | 'gigaam'
    | 'canary'
    | 'cohere'
export type NativeModelFormat = 'file' | 'directory'

/** Mirrors Rust `ModelStatus` (catalog entry + runtime state). */
export interface NativeModelStatus {
    id: string
    name: string
    description: string
    engine_type: NativeEngineType
    format: NativeModelFormat
    filename: string
    url: string | null
    sha256: string | null
    size_bytes: number
    languages: string[]
    accuracy: number
    speed: number
    supports_translation: boolean
    supports_language_selection: boolean
    recommended: boolean
    bundled: boolean
    supports_streaming: boolean
    is_downloaded: boolean
    is_downloading: boolean
}

/** Mirrors Rust `DownloadProgress` (the `model-download-progress` payload). */
export interface NativeDownloadProgress {
    model_id: string
    downloaded: number
    total: number | null
    done: boolean
    error: string | null
}

/** The bundled, offline-capable default. */
export const DEFAULT_NATIVE_MODEL_ID = 'whisper-base.en'

/** List the model catalog with per-model downloaded/downloading state. */
export async function listNativeModels(): Promise<NativeModelStatus[]> {
    if (!isDesktop()) return []
    try {
        return await invoke<NativeModelStatus[]>('list_native_models')
    } catch (err) {
        console.warn('[nativeModelManager] list failed:', err)
        return []
    }
}

/** Start a (resumable) download. Progress arrives via `onDownloadProgress`. */
export async function downloadNativeModel(modelId: string): Promise<void> {
    await invoke('download_native_model', { modelId })
}

/** Cancel an in-flight download. */
export async function cancelNativeDownload(modelId: string): Promise<void> {
    if (!isDesktop()) return
    try {
        await invoke('cancel_native_download', { modelId })
    } catch (err) {
        console.warn('[nativeModelManager] cancel failed:', err)
    }
}

/** Delete a downloaded model from disk (bundled model can't be deleted). */
export async function deleteNativeModel(modelId: string): Promise<void> {
    await invoke('delete_native_model', { modelId })
}

/** A human label for a model's language coverage. */
export function languageLabel(model: NativeModelStatus): string {
    if (model.languages.length === 0) return 'Multi-language'
    if (model.languages.length === 1) {
        return model.languages[0] === 'en' ? 'English only' : model.languages[0]
    }
    return 'Multi-language'
}

/** Whether a model is present on disk. */
export async function isNativeModelDownloaded(modelId: string): Promise<boolean> {
    if (!isDesktop()) return false
    try {
        return await invoke<boolean>('is_native_model_downloaded', { modelId })
    } catch {
        return false
    }
}

/**
 * Subscribe to download-progress events. Returns an unsubscribe function.
 * No-op off desktop.
 */
export function onDownloadProgress(callback: (p: NativeDownloadProgress) => void): () => void {
    if (typeof window === 'undefined' || !('__TAURI__' in window)) return () => {}
    let unlisten: (() => void) | undefined
    let cancelled = false
    listen<NativeDownloadProgress>('model-download-progress', (event) => callback(event.payload))
        .then((fn) => {
            if (cancelled) fn()
            else unlisten = fn
        })
        .catch(() => { /* event API unavailable */ })
    return () => {
        cancelled = true
        unlisten?.()
    }
}

/** Human-readable size, e.g. "466 MB" / "3.1 GB". */
export function formatModelSize(bytes: number): string {
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1) return `${gb.toFixed(1)} GB`
    return `${Math.round(bytes / (1024 * 1024))} MB`
}
