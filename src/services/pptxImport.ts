/**
 * The desktop PowerPoint import commands (`src-tauri/src/pptx_import.rs`).
 * Desktop only: callers check `isDesktop()` first.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
    PPTX_PROGRESS_EVENT,
    type PptxImportError,
    type PptxImportMode,
    type PptxImportProgress,
    type PptxImportResult,
} from '../lib/import/pptxToSlides'

export interface PptxCapabilities {
    editable: boolean
    images: boolean
}

export async function getPptxCapabilities(): Promise<PptxCapabilities> {
    try {
        return await invoke<PptxCapabilities>('pptx_import_capabilities')
    } catch {
        // An older desktop build without the command: nothing to offer.
        return { editable: false, images: false }
    }
}

/** A fresh id naming one import (its progress events and its media folder). */
export function newPptxImportId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Anything thrown by the command, as the shape it rejects with. */
export function asPptxImportError(error: unknown): PptxImportError {
    if (error && typeof error === 'object' && 'kind' in error && 'message' in error) {
        return error as PptxImportError
    }
    return { kind: 'io', message: error instanceof Error ? error.message : String(error) }
}

/**
 * Run an import, reporting progress until it settles. Rejects with a
 * `PptxImportError`.
 */
export async function runPptxImport(
    path: string,
    mode: PptxImportMode,
    importId: string,
    onProgress: (progress: PptxImportProgress) => void,
): Promise<PptxImportResult> {
    const unlisten = await listen<PptxImportProgress>(PPTX_PROGRESS_EVENT, (event) => {
        if (event.payload?.importId === importId) onProgress(event.payload)
    })
    try {
        return await invoke<PptxImportResult>('pptx_import', { path, mode, importId })
    } catch (error) {
        throw asPptxImportError(error)
    } finally {
        unlisten()
    }
}

export async function cancelPptxImport(importId: string): Promise<void> {
    try {
        await invoke('pptx_import_cancel', { importId })
    } catch {
        // Nothing running under that id any more.
    }
}
