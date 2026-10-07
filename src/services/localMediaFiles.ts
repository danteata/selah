/**
 * Local media library file storage (desktop only).
 *
 * Uploaded images/videos are copied into the app's own data directory so
 * they persist independent of Convex — the free, default path (see
 * `useMediaLibrary`'s local-first design). Mirrors the same
 * `appDataDir()` + `join()` pattern already used by
 * `src/services/sermon-listener/devAccuracyReport.ts` for writing files
 * outside the webview sandbox.
 */
import { writeFile, readFile, mkdir, remove } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { isDesktop } from '../platform'

const MEDIA_DIR = 'media-library'

async function mediaDir(): Promise<string> {
    const dir = await join(await appDataDir(), MEDIA_DIR)
    await mkdir(dir, { recursive: true })
    return dir
}

function extensionFor(filename: string): string {
    const parts = filename.split('.')
    return parts.length > 1 ? parts[parts.length - 1] : 'bin'
}

/** Copies `file`'s bytes into the app's local media directory, returning the absolute path. */
export async function saveFileToLocalMediaLibrary(file: File, id: string): Promise<string> {
    if (!isDesktop()) {
        throw new Error('Local media files are only supported on desktop')
    }

    const dir = await mediaDir()
    const path = await join(dir, `${id}.${extensionFor(file.name)}`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeFile(path, bytes)
    return path
}

/**
 * Copy a file the user picked from anywhere on disk into the app's media
 * directory and return the copy's path. Templates keep the copy, so moving or
 * deleting the original from Downloads no longer turns their background black.
 *
 * Read through the asset protocol (scoped to every path, see tauri.conf.json):
 * the fs plugin may only read Selah's own directories.
 */
export async function copyIntoMediaLibrary(sourcePath: string, idPrefix = 'template-bg'): Promise<string> {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const response = await fetch(convertFileSrc(sourcePath))
    if (!response.ok) throw new Error(`Could not read ${sourcePath}`)
    const blob = await response.blob()
    const name = sourcePath.split(/[\\/]/).pop() || 'background'
    const id = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return saveFileToLocalMediaLibrary(new File([blob], name, { type: blob.type }), id)
}

/** Reads a previously-saved local media file's bytes back (e.g. to sync it to Convex). */
export async function readLocalMediaFile(path: string, contentType: string): Promise<Blob> {
    if (!isDesktop()) {
        throw new Error('Local media files are only supported on desktop')
    }
    const bytes = await readFile(path)
    return new Blob([bytes], { type: contentType })
}

export async function deleteLocalMediaFile(path: string): Promise<void> {
    if (!isDesktop()) return
    try {
        await remove(path)
    } catch {
        // Already gone or otherwise unreadable — non-fatal, the library
        // entry is being deleted either way.
    }
}
