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
