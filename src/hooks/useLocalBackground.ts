import { useState, useEffect } from 'react'
import { isDesktop } from '../platform'

// Matches Unix absolute paths (e.g. /Users/..., /home/...) and Windows paths (C:\..., C:/...)
const LOCAL_PATH_RE = /^(\/[^\s]|[A-Za-z]:[\\/])/
// Matches Tauri v2 asset URLs:
//   - macOS/Linux dev & prod:  asset://localhost/<encoded-path>
//   - Windows:                 http(s)://asset.localhost/<encoded-path>
const ASSET_PROTOCOL_RE = /^(asset:\/\/|https?:\/\/asset\.localhost\/)/i

let convertFileSrcFn: ((filePath: string) => string) | null = null
let convertFileSrcReady: Promise<void> | null = null

function ensureConvertFileSrc(): Promise<void> {
    if (convertFileSrcFn) return Promise.resolve()
    if (convertFileSrcReady) return convertFileSrcReady
    convertFileSrcReady = (async () => {
        try {
            const mod = await import('@tauri-apps/api/core')
            convertFileSrcFn = mod.convertFileSrc
        } catch {
            convertFileSrcFn = getConvertFileSrcSync()
        }
    })()
    return convertFileSrcReady
}

function getConvertFileSrcSync(): ((filePath: string) => string) | null {
    try {
        const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
        if (internals && typeof internals === 'object' && 'convertFileSrc' in internals) {
            return (internals as { convertFileSrc: (p: string) => string }).convertFileSrc
        }
    } catch {}
    return null
}

if (typeof window !== 'undefined') {
    const syncFn = getConvertFileSrcSync()
    if (syncFn) {
        convertFileSrcFn = syncFn
    } else if (isDesktop()) {
        ensureConvertFileSrc()
    }
}

/**
 * Strip a process-scoped `blob:` background out of a slide snapshot.
 *
 * `URL.createObjectURL` handles are only meaningful inside the process that
 * minted them. Persisting one into a template means every later session — and
 * every restart — reloads a slide pointing at a URL that no longer resolves,
 * which showed up as `net::ERR_FILE_NOT_FOUND` on a blob: URL immediately
 * after the slide went live, with the *same* UUID recurring across runs.
 *
 * `backgroundStorageId` is the durable handle and is left intact, so dropping
 * the URL lets the background be re-resolved from storage (or fall back to the
 * default) instead of rendering nothing. Applied both when writing a template
 * and when reading one, so templates already saved with a dead URL recover.
 */
export function stripEphemeralBackground<T>(slide: T): T {
    if (!slide || typeof slide !== 'object') return slide
    const candidate = slide as { background?: unknown }
    if (typeof candidate.background === 'string' && candidate.background.startsWith('blob:')) {
        return { ...(slide as object), background: '' } as T
    }
    return slide
}

export function isLocalFilePath(url: string): boolean {
    if (!url) return false
    if (ASSET_PROTOCOL_RE.test(url)) return true
    if (LOCAL_PATH_RE.test(url)) return true
    return false
}

export function resolveLocalUrl(url: string, localFilePath?: string): string {
    if (!url || !isDesktop()) return url

    const fn = convertFileSrcFn || getConvertFileSrcSync()
    if (!fn) return url

    const pathToResolve = localFilePath || url
    if (LOCAL_PATH_RE.test(pathToResolve)) return fn(pathToResolve)
    if (ASSET_PROTOCOL_RE.test(url)) return url

    return url
}

function resolveBackground(background: string, localFilePath?: string): string {
    if (!background) return background

    if (background.startsWith('data:') || background.startsWith('blob:')) return background
    if (background.startsWith('linear-gradient') || background.startsWith('radial-gradient') || background.startsWith('#')) return background

    if (!isDesktop()) {
        if (LOCAL_PATH_RE.test(background) || LOCAL_PATH_RE.test(localFilePath || '')) return ''
        if (ASSET_PROTOCOL_RE.test(background)) return ''
        return background
    }

    if (ASSET_PROTOCOL_RE.test(background)) return background
    if (background.startsWith('http://') || background.startsWith('https://')) return background

    const pathToResolve = localFilePath || background
    if (LOCAL_PATH_RE.test(pathToResolve)) {
        const fn = convertFileSrcFn || getConvertFileSrcSync()
        if (fn) return fn(pathToResolve)
        return ''
    }

    return background
}

export function useLocalBackground(background: string | undefined, localFilePath?: string): string {
    const [resolved, setResolved] = useState<string>(() => {
        const initial = resolveBackground(background || '', localFilePath)
        if (initial) return initial

        if (isDesktop() && LOCAL_PATH_RE.test(localFilePath || background || '')) {
            const path = localFilePath || background || ''
            const syncFn = convertFileSrcFn || getConvertFileSrcSync()
            if (syncFn) return syncFn(path)
        }

        return initial
    })

    useEffect(() => {
        const result = resolveBackground(background || '', localFilePath)
        if (result) {
            setResolved(result)
            return
        }

        if (!isDesktop()) {
            setResolved('')
            return
        }

        const pathToResolve = localFilePath || background || ''
        if (LOCAL_PATH_RE.test(pathToResolve)) {
            ensureConvertFileSrc().then(() => {
                const fn = convertFileSrcFn || getConvertFileSrcSync()
                if (fn) {
                    setResolved(fn(pathToResolve))
                } else {
                    setResolved('')
                }
            })
            return
        }

        setResolved(background || '')
    }, [background, localFilePath])

    return resolved
}