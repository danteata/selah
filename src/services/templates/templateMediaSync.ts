/**
 * Template backgrounds: uploaded from the computer that has them, downloaded
 * ahead of time by every other.
 *
 * The desktop app used to save a template's background as a path on the
 * computer it was made on (`C:\\Users\\…\\Downloads\\clip.mp4`). The template
 * synced to the church; the file never did, so on every other computer, on
 * the web, and on the same computer once the file moved, the background was
 * black. Now:
 *
 *  - upload: on desktop, a church template whose background is a local file
 *    this computer has, and that has no uploaded copy yet, is marked as on
 *    this computer only. It uploads and attaches (`templates.attachBackground`)
 *    when someone asks for it (`uploadTemplateBackground`), never just because
 *    the app is online. The church's total is capped (100 MB); past it the
 *    template is marked over the limit and keeps working on the computer that
 *    has the file.
 *  - prefetch: on every device, uploaded backgrounds are downloaded into the
 *    template cache while online, so a template works offline and doesn't
 *    wait on the network when it goes live.
 *
 * Per-template outcomes are kept for the template picker's badges.
 */
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { isDesktop } from '../../platform'
import { prefetchTemplateBackground } from '../../hooks/useTemplates'

export type TemplateMediaState =
    /** The background is a file on this computer, not uploaded. */
    | 'local'
    | 'uploading'
    | 'uploaded'
    /** The background is a file on another computer. */
    | 'missing'
    /** The church's template backgrounds are at their limit. */
    | 'over-limit'
    | 'failed'

export interface TemplateLike {
    _id: string
    createdBy?: string
    backgroundStorageId?: string
    slideId: unknown
}

interface Snapshot {
    background?: string
    backgroundType?: string
    backgroundStorageId?: string | null
    localFilePath?: string
}

const states = new Map<string, TemplateMediaState>()
const listeners = new Set<() => void>()
let version = 0

function setState(templateId: string, state: TemplateMediaState): void {
    if (states.get(templateId) === state) return
    states.set(templateId, state)
    version++
    for (const l of listeners) l()
}

export function subscribeTemplateMedia(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function templateMediaVersion(): number {
    return version
}

export function templateMediaState(templateId: string): TemplateMediaState | undefined {
    return states.get(templateId)
}

export function snapshotOf(template: TemplateLike): Snapshot | null {
    const raw = template.slideId
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as Snapshot
        } catch {
            return null
        }
    }
    return raw && typeof raw === 'object' ? (raw as Snapshot) : null
}

const ASSET_URL = /^(asset:\/\/|https?:\/\/asset\.localhost\/)/i
const LOCAL_PATH = /^(\/[^\s]|[A-Za-z]:[\\/])/

/** The uploaded background's id, wherever the template keeps it. */
export function storageIdOf(template: TemplateLike): string | null {
    return template.backgroundStorageId || snapshotOf(template)?.backgroundStorageId || null
}

/** The local file a template's background is, if it is one: a path, or an asset URL. */
export function localSourceOf(template: TemplateLike): { path?: string; assetUrl?: string } | null {
    const snap = snapshotOf(template)
    if (!snap) return null
    if (snap.localFilePath && LOCAL_PATH.test(snap.localFilePath)) return { path: snap.localFilePath }
    if (snap.background && ASSET_URL.test(snap.background)) return { assetUrl: snap.background }
    if (snap.background && LOCAL_PATH.test(snap.background)) return { path: snap.background }
    return null
}

/** Read a local file through the asset protocol, or null if this computer doesn't have it. */
async function readLocal(source: { path?: string; assetUrl?: string }): Promise<Blob | null> {
    try {
        let url = source.assetUrl
        if (source.path) {
            const { convertFileSrc } = await import('@tauri-apps/api/core')
            url = convertFileSrc(source.path)
        }
        if (!url) return null
        const response = await fetch(url)
        if (!response.ok) return null
        const blob = await response.blob()
        return blob.size > 0 ? blob : null
    } catch {
        return null
    }
}

/** Whether this computer has the file, without reading a whole video to find out. */
async function hasLocal(source: { path?: string; assetUrl?: string }): Promise<boolean> {
    try {
        let url = source.assetUrl
        if (source.path) {
            const { convertFileSrc } = await import('@tauri-apps/api/core')
            url = convertFileSrc(source.path)
        }
        if (!url) return false
        const response = await fetch(url, { headers: { Range: 'bytes=0-0' } })
        void response.body?.cancel().catch(() => {})
        return response.ok
    } catch {
        return false
    }
}

/** A background on this computer that has no uploaded copy yet: one the church could sync. */
export function canUploadBackground(template: TemplateLike): boolean {
    return isDesktop() && !!template.createdBy && !storageIdOf(template) && !!localSourceOf(template)
}

async function uploadOne(convex: ConvexReactClient, template: TemplateLike, remaining: { bytes: number }): Promise<void> {
    const source = localSourceOf(template)
    if (!source) return
    const blob = await readLocal(source)
    if (!blob) {
        setState(template._id, 'missing')
        return
    }
    if (blob.size > remaining.bytes) {
        setState(template._id, 'over-limit')
        return
    }
    setState(template._id, 'uploading')
    try {
        const uploadUrl = await convex.mutation(api.templates.generateUploadUrl, {})
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': blob.type || 'application/octet-stream' },
            body: blob,
        })
        if (!response.ok) throw new Error(`upload failed (${response.status})`)
        const { storageId } = (await response.json()) as { storageId: string }
        const result = await convex.mutation(api.templates.attachBackground, { templateId: template._id, storageId })
        if (!result.ok) {
            remaining.bytes = 0
            setState(template._id, 'over-limit')
            return
        }
        remaining.bytes = result.limitBytes - result.usedBytes
        setState(template._id, 'uploaded')
    } catch (err) {
        console.warn('[templateMedia] could not upload a template background:', err)
        setState(template._id, 'failed')
    }
}

let running: Promise<void> | null = null

/**
 * Upload one template's background from this computer, because someone asked
 * to. Its outcome lands in the template's state.
 */
export async function uploadTemplateBackground(convex: ConvexReactClient, template: TemplateLike): Promise<void> {
    if (!canUploadBackground(template) || states.get(template._id) === 'uploading') return
    setState(template._id, 'uploading')
    try {
        const usage = await convex.query(api.templates.backgroundUsage, { excludingTemplateId: template._id })
        await uploadOne(convex, template, { bytes: usage.limitBytes - usage.usedBytes })
    } catch (err) {
        console.warn('[templateMedia] could not upload a template background:', err)
        setState(template._id, 'failed')
    }
}

/** Outcomes of an upload someone asked for, kept until they try again. */
const ASKED: ReadonlySet<TemplateMediaState | undefined> = new Set(['uploading', 'over-limit', 'failed'])

/**
 * Mark which local backgrounds this computer has, then download the uploaded
 * ones it lacks. Uploads nothing: see `uploadTemplateBackground`. Single-flight.
 */
export function syncTemplateMedia(convex: ConvexReactClient, templates: TemplateLike[]): Promise<void> {
    if (running) return running
    running = (async () => {
        try {
            if (isDesktop()) {
                for (const t of templates) {
                    if (!canUploadBackground(t) || ASKED.has(states.get(t._id))) continue
                    setState(t._id, (await hasLocal(localSourceOf(t)!)) ? 'local' : 'missing')
                }
            } else {
                // The web can't read files on disk: such a background is elsewhere.
                for (const t of templates) {
                    if (!storageIdOf(t) && localSourceOf(t)) setState(t._id, 'missing')
                }
            }

            const ids = new Set(templates.map(storageIdOf).filter((id): id is string => !!id))
            for (const id of ids) await prefetchTemplateBackground(convex, id)
        } finally {
            running = null
        }
    })()
    return running
}

/** For tests. */
export function resetTemplateMedia(): void {
    states.clear()
    running = null
    version++
}
