import { isDesktop } from '../platform'
import { openFileDialog } from './fileDialog'
import { saveLocalMediaBlob, saveLocalMediaItem } from '../hooks/useIndexedDB'

export type BackgroundAssetKind = 'image' | 'video'

export interface PickedBackgroundAsset {
    /** URL ready to be used as a `<img src>` / `<video src>` / CSS background-image */
    background: string
    backgroundType: BackgroundAssetKind
    /** Original filesystem path on desktop. Empty on web. */
    localFilePath?: string
    /** Web: the local media library item holding the file, so any window can load it. */
    localMediaId?: string
    /** Display name. */
    name: string
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp']
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg', 'm4v']

const IMAGE_MAX_BYTES = 25 * 1024 * 1024 // 25 MB
const VIDEO_MAX_BYTES = 500 * 1024 * 1024 // 500 MB (loose; videos are blob/asset-streamed)

async function loadConvertFileSrc(): Promise<((p: string) => string) | null> {
    try {
        const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
        if (internals && typeof internals === 'object' && 'convertFileSrc' in internals) {
            return (internals as { convertFileSrc: (p: string) => string }).convertFileSrc
        }
    } catch { /* ignore */ }
    try {
        const mod = await import('@tauri-apps/api/core')
        return mod.convertFileSrc
    } catch { /* ignore */ }
    return null
}

function basename(path: string): string {
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

/**
 * Reads a File as a data URL (used for images on web so they survive reload via persisted slide state).
 */
function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
        reader.readAsDataURL(file)
    })
}

/**
 * Open a native file dialog (desktop) or browser picker (web) for an image or video,
 * and return a URL safe to assign to `<img>`, `<video>`, or CSS `background-image`.
 *
 * Desktop:
 *   - Picks via Tauri dialog
 *   - Converts the absolute filesystem path to an `asset://` URL via `convertFileSrc`
 *   - Returns the original path as `localFilePath` so consumers can re-resolve later
 *     (e.g. across app restarts when `convertFileSrc` cache may differ).
 *
 * Web:
 *   - Images become data URLs (persistable across reloads if stored in IndexedDB/localStorage)
 *   - Videos become blob URLs (transient; only valid for the current session)
 */
export async function pickLocalBackgroundAsset(kind: BackgroundAssetKind): Promise<PickedBackgroundAsset | null> {
    if (isDesktop()) {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog')
            const exts = kind === 'image' ? IMAGE_EXTS : VIDEO_EXTS
            const filterName = kind === 'image' ? 'Images' : 'Videos'

            const selected = await open({
                multiple: false,
                filters: [{ name: filterName, extensions: exts }],
            })

            if (!selected) return null
            const filePath = typeof selected === 'string' ? selected : (selected as unknown as string)
            if (!filePath) return null

            const convertFileSrc = await loadConvertFileSrc()
            if (!convertFileSrc) {
                console.error('[pickBackgroundAsset] Tauri convertFileSrc unavailable')
                return null
            }

            const assetUrl = convertFileSrc(filePath)
            return {
                background: assetUrl,
                backgroundType: kind,
                localFilePath: filePath,
                name: basename(filePath),
            }
        } catch (err) {
            console.error('[pickBackgroundAsset] desktop dialog failed:', err)
            return null
        }
    }

    // ---- Web path ----
    const accept = kind === 'image' ? 'image/*' : 'video/*'
    const files = await openFileDialog({ multiple: false, accept })
    if (!files || files.length === 0) return null
    const file = files[0]

    const maxBytes = kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES
    if (file.size > maxBytes) {
        const limitMb = Math.round(maxBytes / (1024 * 1024))
        alert(`${kind === 'image' ? 'Image' : 'Video'} must be smaller than ${limitMb}MB`)
        return null
    }

    if (kind === 'image') {
        const dataUrl = await readAsDataUrl(file)
        return {
            background: dataUrl,
            backgroundType: 'image',
            name: file.name,
        }
    }

    // Videos as data URLs would be huge. They used to become a bare object
    // URL, which only works in the tab that made it: the projector window, a
    // reload, and every other device got nothing. The file goes into the
    // local media library instead, which any window of this browser can read;
    // the object URL is only for this tab's preview.
    // Same id scheme as the media library's own uploads (useMediaLibrary).
    const id = crypto.randomUUID?.() ?? `media_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const now = new Date().toISOString()
    await saveLocalMediaBlob(id, file)
    await saveLocalMediaItem({
        id, name: file.name, type: 'video', hasBlob: true,
        size: file.size, contentType: file.type, createdAt: now, updatedAt: now,
    })
    return {
        background: URL.createObjectURL(file),
        backgroundType: 'video',
        localMediaId: id,
        name: file.name,
    }
}
