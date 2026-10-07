import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useConvex, useQuery, useMutation } from 'convex/react'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { stripEphemeralBackground } from './useLocalBackground'
import {
    saveLocalTemplate,
    getLocalTemplates,
    deleteLocalTemplate as deleteLocalTemplateFromDB,
    updateLocalTemplate as updateLocalTemplateFromDB,
    getCachedTemplateBlob,
    cacheTemplateBlob,
    type LocalTemplate,
} from './useIndexedDB'

export type SlideType = 'bible' | 'song' | 'hymn' | 'dictionary' | 'text' | 'media' | 'announcement' | 'sermon' | 'prayer' | 'countdown' | 'any'

/**
 * `appliesTo` answers "which slide types can use this template?", so every
 * option has to be a type a slide can actually have. Slides are created with
 * `bible | song | hymn | dictionary | text | media | countdown | alert`, which
 * is why `sermon`, `prayer` and `announcement` are absent here: no slide is ever
 * created with those types, so a template restricted to one of them matched
 * nothing and simply vanished from every picker.
 *
 * They remain accepted by the schema and the mutations below — templates saved
 * before this list was corrected still carry them, and rewriting a user's
 * choice behind their back is worse than showing it back to them as the stale
 * badge it is. They are just no longer offered.
 *
 * `alert` is a real slide type but is deliberately NOT offered yet: nothing in
 * the alert flow can apply a template, so listing it would recreate exactly the
 * dead-option problem this list is fixing. Add it here together with a
 * `TemplateSelector` in `AddAlertModal`.
 */
export const TEMPLATE_SLIDE_TYPE_OPTIONS: ReadonlyArray<{ id: SlideType; label: string }> = [
    { id: 'bible', label: 'Bible Verses' },
    { id: 'song', label: 'Songs' },
    { id: 'hymn', label: 'Hymns' },
    { id: 'dictionary', label: 'Definitions' },
    { id: 'text', label: 'Text Slides' },
    { id: 'media', label: 'Media' },
    { id: 'countdown', label: 'Countdowns' },
    { id: 'any', label: 'Any Type' },
]

export type TemplateCategory = 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'

/**
 * The template categories, with their presentation.
 *
 * `category` and `appliesTo` are two independent axes and are easy to confuse —
 * `announcement` is a value in both, and `sermon`/`prayer` read like slide types
 * but are categories only. Category answers "how is this template filed?";
 * `appliesTo` answers "which slide types may use it?".
 *
 * Single source of truth because there were four hand-maintained copies of this
 * table (the browser's badge config, the selector's dot colours, and one in each
 * of the two authoring modals) and they had drifted: both modals coloured Sermon
 * amber — identical to Worship — while the badge on the resulting card was
 * orange, so the swatch you picked was not the swatch you got.
 */
export const TEMPLATE_CATEGORIES: ReadonlyArray<{
    id: TemplateCategory
    label: string
    /** Single letter for the collapsed (inline) sidebar. */
    abbr: string
    /** Raw colour, for canvas/SVG and inline styles. */
    hex: string
    /** Tailwind background for a solid swatch. */
    dotClass: string
    /** Tailwind classes for the tinted badge on a template card. */
    badgeClass: string
}> = [
    { id: 'announcement', label: 'Announcement', abbr: 'A', hex: '#3B82F6', dotClass: 'bg-blue-500', badgeClass: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
    { id: 'worship', label: 'Worship', abbr: 'W', hex: '#F59E0B', dotClass: 'bg-amber-500', badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
    { id: 'sermon', label: 'Sermon', abbr: 'S', hex: '#F97316', dotClass: 'bg-orange-500', badgeClass: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
    { id: 'prayer', label: 'Prayer', abbr: 'P', hex: '#10B981', dotClass: 'bg-emerald-500', badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
    { id: 'general', label: 'General', abbr: 'G', hex: '#6B7280', dotClass: 'bg-gray-500', badgeClass: 'bg-gray-500/15 text-gray-700 dark:text-gray-300' },
]

export function templateCategory(id: string) {
    return TEMPLATE_CATEGORIES.find((c) => c.id === id)
}

/** Everything the `templates.appliesTo` schema union accepts, including the
 *  legacy values no longer offered. Used to reject genuine garbage without
 *  discarding values that are still valid on the wire. */
const TEMPLATE_APPLIES_TO_VALUES = new Set<SlideType>([
    'bible', 'song', 'hymn', 'dictionary', 'text', 'media', 'countdown', 'any',
    // Legacy — see TEMPLATE_SLIDE_TYPE_OPTIONS.
    'announcement', 'sermon', 'prayer',
])

/**
 * Drop values the backend would reject, and nothing else.
 *
 * This used to filter out `sermon`/`prayer` and then fall back to `['any']` when
 * that emptied the list — so a template the operator had restricted to Sermon
 * (an option `SaveAsTemplateModal` offered) was silently saved as applying to
 * *everything*. The narrowest possible choice became the widest. Returning
 * `undefined` for an empty result is the honest answer: `getTemplatesForSlideType`
 * already reads a missing `appliesTo` as unconstrained, so nothing downstream
 * needs the sentinel.
 */
export function normalizeAppliesTo(appliesTo?: SlideType[]): SlideType[] | undefined {
    if (!appliesTo) return undefined
    const normalized = appliesTo.filter((type) => TEMPLATE_APPLIES_TO_VALUES.has(type))
    return normalized.length > 0 ? normalized : undefined
}

export type TemplateItem = {
    _id: string
    name: string
    description?: string
    slideId: string | unknown
    category: TemplateCategory
    appliesTo?: SlideType[]
    thumbnail?: string
    createdBy?: string
    favoritedBy?: string[]
    backgroundStorageId?: string
    createdAt: string
    updatedAt: string
}

export type UseTemplatesReturn = {
    templates: TemplateItem[] | undefined
    customTemplates: TemplateItem[] | undefined
    isLoading: boolean
    createTemplate: (data: {
        name: string
        description?: string
        slideId: string | unknown
        category: TemplateCategory
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }) => Promise<string>
    updateTemplate: (templateId: string, updates: {
        name?: string
        description?: string
        slideId?: string | unknown
        category?: TemplateCategory
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }) => Promise<string>
    deleteTemplate: (templateId: string) => Promise<boolean>
    toggleFavorite: (templateId: string) => Promise<boolean>
    generateUploadUrl: () => Promise<string>
    getFileUrl: (storageId: string | null) => string | null
    seedDefaultTemplates: () => Promise<{ seeded: boolean; count?: number; message?: string }>
    resetDefaultTemplates: () => Promise<{ seeded: boolean; count?: number; message?: string }>
    getTemplatesForSlideType: (slideType: SlideType) => TemplateItem[]
}

function localTemplateToTemplateItem(local: LocalTemplate): TemplateItem {
    return {
        _id: local.id,
        name: local.name,
        description: local.description,
        slideId: local.slideId,
        category: local.category as TemplateItem['category'],
        appliesTo: local.appliesTo as SlideType[] || undefined,
        thumbnail: local.thumbnail,
        createdBy: local.createdBy,
        favoritedBy: local.favoritedBy,
        backgroundStorageId: local.backgroundStorageId,
        createdAt: local.createdAt,
        updatedAt: local.updatedAt,
    }
}

// ---------------------------------------------------------------------------
// Local-first file URL resolver
// ---------------------------------------------------------------------------
// Resolves a Convex storageId to a usable URL with the following cache chain:
//
//   1. In-memory signed-URL cache (50-min TTL, slightly shorter than the
//      Convex signed-URL expiry of ~1 hour) — avoids refiring the query on
//      re-renders and stops the browser from re-downloading the file when
//      the URL rotates between subscriptions.
//   2. IndexedDB blob cache — bytes fetched on the first Convex hit, then
//      served via URL.createObjectURL(blob) forever after. Convex never
//      touched again on the same browser.
//   3. Convex `getFileUrl` query — fires AT MOST ONCE per storageId per
//      browser. The resolved URL is memoised in (1) and the bytes are
//      background-fetched and cached in (2) for subsequent renders.

const SIGNED_URL_CACHE_TTL_MS = 50 * 60 * 1000
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()
const inFlightSignedUrls = new Map<string, Promise<string | null>>()

function getCachedSignedUrl(storageId: string): string | null {
    const cached = signedUrlCache.get(storageId)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) {
        signedUrlCache.delete(storageId)
        return null
    }
    return cached.url
}

function setCachedSignedUrl(storageId: string, url: string) {
    signedUrlCache.set(storageId, { url, expiresAt: Date.now() + SIGNED_URL_CACHE_TTL_MS })
}

async function fetchSignedUrlFromConvex(
    convex: ConvexReactClient,
    storageId: string,
): Promise<string | null> {
    const existing = inFlightSignedUrls.get(storageId)
    if (existing) return existing

    const promise = convex
        .query(api.templates.getFileUrl, { storageId })
        .then((url) => {
            inFlightSignedUrls.delete(storageId)
            return url ?? null
        })
        .catch((err) => {
            inFlightSignedUrls.delete(storageId)
            throw err
        })

    inFlightSignedUrls.set(storageId, promise)
    return promise
}

/**
 * Keep process-scoped `blob:` URLs out of a persisted slide snapshot.
 *
 * A template is saved from a live slide, whose background may currently be an
 * object URL resolved from the blob cache. That URL dies with the process, so
 * storing it guarantees a broken background on every later run — see
 * `stripEphemeralBackground`. Handles both snapshot shapes this API accepts:
 * an already-stringified slide, or the object itself.
 */
function sanitizeSlideSnapshot(slideId: string | unknown): string | unknown {
    if (typeof slideId === 'string') {
        try {
            const parsed = JSON.parse(slideId)
            const cleaned = stripEphemeralBackground(parsed)
            // stripEphemeralBackground returns the same reference when there
            // was nothing to strip, so this avoids a pointless re-stringify.
            return cleaned === parsed ? slideId : JSON.stringify(cleaned)
        } catch {
            // Not JSON — nothing to inspect, pass through untouched.
            return slideId
        }
    }
    return stripEphemeralBackground(slideId)
}

async function backgroundCacheBlob(storageId: string, signedUrl: string) {
    try {
        const response = await fetch(signedUrl)
        if (!response.ok) return
        const blob = await response.blob()
        if (blob.size === 0) return
        await cacheTemplateBlob(storageId, blob)
    } catch {
        // Non-fatal: if the bytes can't be cached we still have the signed URL
        // for the rest of its TTL.
    }
}

/**
 * Object URLs for cached template blobs, keyed by storageId and shared by
 * every consumer for the lifetime of the session.
 *
 * These URLs escape the hook that mints them: a template resolved here gets
 * baked into a slide that is pushed live and keeps rendering long after the
 * component unmounts. When each consumer owned its own URL and revoked it on
 * unmount or template switch, the live slide's background died with it —
 * `net::ERR_FILE_NOT_FOUND` on a blob: URL immediately after `slide_created`.
 *
 * One URL per distinct template, never revoked mid-session. The blob is
 * already held in IndexedDB, so this costs a mapping, not a second copy, and
 * it's bounded by how many templates the operator actually uses.
 */
const templateObjectUrls = new Map<string, string>()

function getTemplateObjectUrl(storageId: string, blob: Blob): string {
    const existing = templateObjectUrls.get(storageId)
    if (existing) return existing
    const objectUrl = URL.createObjectURL(blob)
    templateObjectUrls.set(storageId, objectUrl)
    return objectUrl
}

/**
 * Download a template background into this device's cache if it isn't there
 * yet, so the template works offline and never waits on the network mid-
 * service. Resolves to whether the background is now cached.
 */
export async function prefetchTemplateBackground(convex: ConvexReactClient, storageId: string): Promise<boolean> {
    if (await getCachedTemplateBlob(storageId)) return true
    const signedUrl = await fetchSignedUrlFromConvex(convex, storageId).catch(() => null)
    if (!signedUrl) return false
    setCachedSignedUrl(storageId, signedUrl)
    await backgroundCacheBlob(storageId, signedUrl)
    return !!(await getCachedTemplateBlob(storageId))
}

export function useFileUrl(storageId: string | null) {
    const convex = useConvex()
    // Remembered with the id it resolves, and only returned for that id: a
    // plain `url` state kept serving the previous template's background while
    // the next one resolved, so a new slide briefly showed the wrong image.
    const [resolved, setResolved] = useState<{ sid: string; url: string | null } | null>(null)
    // Tracks the storageId the in-flight resolver is operating on so we
    // ignore stale resolutions when storageId changes mid-fetch.
    const resolvingForRef = useRef<string | null>(null)

    useEffect(() => {
        if (!storageId) return

        // Narrow storageId for the closure — TypeScript's flow analysis
        // doesn't always propagate the post-`if (!storageId) return` narrowing
        // into inner async functions, so we use a typed local.
        const sid: string = storageId

        let cancelled = false
        resolvingForRef.current = sid

        // A previously-resolved object URL is deliberately NOT revoked here.
        // It is shared via `templateObjectUrls` and may still be backing a
        // slide that is live on the output screen right now.

        async function resolve() {
            // 1. In-memory signed-URL cache
            const urlCacheHit = getCachedSignedUrl(sid)
            if (urlCacheHit) {
                if (!cancelled) setResolved({ sid, url: urlCacheHit })
                return
            }

            // 2. IndexedDB blob cache → object URL (zero Convex traffic)
            const blob = await getCachedTemplateBlob(sid)
            if (cancelled || resolvingForRef.current !== sid) return
            if (blob) {
                setResolved({ sid, url: getTemplateObjectUrl(sid, blob) })
                return
            }

            // 3. Convex query — one signed-URL op per storageId per browser
            try {
                const signedUrl = await fetchSignedUrlFromConvex(convex, sid)
                if (cancelled || resolvingForRef.current !== sid) return
                if (signedUrl) {
                    setCachedSignedUrl(sid, signedUrl)
                    setResolved({ sid, url: signedUrl })
                    // Background: fetch the bytes so the NEXT mount is fully local
                    backgroundCacheBlob(sid, signedUrl)
                } else {
                    setResolved({ sid, url: null })
                }
            } catch (err) {
                if (cancelled) return
                console.warn('[useFileUrl] Convex query failed for', sid, err)
                setResolved({ sid, url: null })
            }
        }

        resolve()

        return () => {
            cancelled = true
        }
    }, [storageId, convex])

    // No unmount cleanup: the URL is shared and may outlive this component on
    // a live slide. See `templateObjectUrls`.

    if (!storageId) return null
    if (resolved?.sid === storageId) return resolved.url
    // Until this id resolves, anything already in memory for it — never the
    // previous id's URL.
    return getCachedSignedUrl(storageId) ?? templateObjectUrls.get(storageId) ?? null
}

let templateSync: Promise<number> | null = null

/**
 * Upload templates created offline and changes made offline, oldest first.
 * One pass at a time across the app — useTemplates has many instances, and
 * each running its own pass would create every template several times.
 */
function syncOfflineTemplates(server: {
    create: (template: {
        name: string
        description?: string
        slideId: string
        category: TemplateCategory
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }) => Promise<string>
    update: (templateId: string, updates: {
        name?: string
        description?: string
        slideId?: string
        category?: TemplateCategory
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }) => Promise<unknown>
}): Promise<number> {
    if (templateSync) return templateSync
    templateSync = (async () => {
        let synced = 0
        try {
            const pending = (await getLocalTemplates())
                .filter((t) => t.synced === false)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            for (const t of pending) {
                const fields = {
                    name: t.name,
                    description: t.description,
                    slideId: t.slideId,
                    category: t.category as TemplateCategory,
                    appliesTo: t.appliesTo as SlideType[] | undefined,
                    thumbnail: t.thumbnail,
                    backgroundStorageId: t.backgroundStorageId,
                }
                try {
                    if (t.id.startsWith('local_')) {
                        const serverId = await server.create(fields)
                        await deleteLocalTemplateFromDB(t.id)
                        await saveLocalTemplate({ ...t, id: serverId, createdBy: undefined, synced: true })
                    } else {
                        await server.update(t.id, fields)
                        await updateLocalTemplateFromDB(t.id, { synced: true })
                    }
                    synced++
                } catch (err) {
                    // Refused (e.g. deleted elsewhere): the server's view wins.
                    console.warn('[useTemplates] offline template change not synced:', t.id, err)
                    if (!t.id.startsWith('local_')) await deleteLocalTemplateFromDB(t.id).catch(() => {})
                }
            }
        } catch (err) {
            console.warn('[useTemplates] offline template sync skipped:', err)
        } finally {
            templateSync = null
        }
        return synced
    })()
    return templateSync
}

/**
 * The church's templates as last fetched, kept so the list survives going
 * offline. Offline, only templates made on this device used to be listed:
 * every shared template disappeared from the picker mid-service.
 */
const SERVER_TEMPLATES_KEY = 'selah:server-templates'

function readCachedServerTemplates(): TemplateItem[] {
    try {
        const raw = localStorage.getItem(SERVER_TEMPLATES_KEY)
        return raw ? (JSON.parse(raw) as TemplateItem[]) : []
    } catch {
        return []
    }
}

function cacheServerTemplates(templates: TemplateItem[]): void {
    try {
        localStorage.setItem(SERVER_TEMPLATES_KEY, JSON.stringify(templates))
    } catch {
        // Storage full or unavailable: offline, the list falls back to local templates.
    }
}

export function useTemplates(): UseTemplatesReturn {
    const { isOffline } = useConvexConnection()
    const templates = useQuery(api.templates.getTemplates)
    const createTemplateMutation = useMutation(api.templates.createTemplate)
    const updateTemplateMutation = useMutation(api.templates.updateTemplate)
    const deleteTemplateMutation = useMutation(api.templates.deleteTemplate)
    const toggleFavoriteMutation = useMutation(api.templates.toggleFavoriteTemplate)
    const generateUploadUrlMutation = useMutation(api.templates.generateUploadUrl)
    const seedDefaultTemplatesMutation = useMutation(api.templates.seedDefaultTemplates)
    const resetDefaultTemplatesMutation = useMutation(api.templates.resetDefaultTemplates)

    const [localTemplates, setLocalTemplates] = useState<LocalTemplate[]>([])

    // Always load local templates so we can use them for optimistic updates even online
    useEffect(() => {
        getLocalTemplates().then(setLocalTemplates).catch(() => {})
    }, [])

    const refreshLocalTemplates = useCallback(async () => {
        const locals = await getLocalTemplates()
        setLocalTemplates(locals)
    }, [])

    // Send what was made or changed offline once the server is reachable.
    // Templates created offline were never uploaded at all before.
    useEffect(() => {
        if (isOffline) return
        void syncOfflineTemplates({
            create: (template) => createTemplateMutation(template),
            update: (templateId, updates) => updateTemplateMutation({ templateId, updates }),
        }).then((synced) => {
            if (synced > 0) void refreshLocalTemplates()
        })
    }, [isOffline, createTemplateMutation, updateTemplateMutation, refreshLocalTemplates])

    useEffect(() => {
        if (templates) cacheServerTemplates(templates as TemplateItem[])
    }, [templates])

    const effectiveTemplates: TemplateItem[] | undefined = useMemo(() => {
        const localList = localTemplates.map(localTemplateToTemplateItem)
        const serverList = (templates || []) as TemplateItem[]

        // Preserve loading state when online and templates haven't loaded yet
        if (!isOffline && templates === undefined) return undefined

        // Offline: the church's templates as last fetched, plus this device's
        // own, which override them while they hold unsent changes.
        if (isOffline) {
            const offline = new Map<string, TemplateItem>()
            for (const t of readCachedServerTemplates()) offline.set(t._id, t)
            for (const t of localList) offline.set(t._id, t)
            return Array.from(offline.values())
        }

        // Online, the server's list is the truth, and a cached copy only
        // adds to it or overrides it while it holds a change the server
        // doesn't have yet (`synced: false`). Merging every cached copy
        // brought back templates deleted on other devices, forever — and a
        // failed update, stamped newer than the server, overrode it for good.
        const map = new Map<string, TemplateItem>()
        for (const t of serverList) {
            map.set(t._id, t)
        }
        for (const local of localTemplates) {
            if (local.synced !== false) continue
            map.set(local.id, localTemplateToTemplateItem(local))
        }
        return Array.from(map.values())
    }, [isOffline, templates, localTemplates])

    const customTemplates = useMemo(() => {
        const all = effectiveTemplates || []
        return all.filter(t => t.createdBy)
    }, [effectiveTemplates])

    const createTemplate = async (data: {
        name: string
        description?: string
        slideId: string | unknown
        category: TemplateCategory
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }): Promise<string> => {
        const slideSnapshot = sanitizeSlideSnapshot(data.slideId)
        // Normalized once, up front, so the local cache and the server can never
        // disagree about what this template applies to. They used to: the offline
        // write and the post-write local cache stored the raw value while only
        // the mutation argument was normalized, so the same template read back
        // differently depending on whether it came from Convex or IndexedDB.
        const appliesTo = normalizeAppliesTo(data.appliesTo)
        if (isOffline) {
            const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
            const now = new Date().toISOString()
            const localTemplate: LocalTemplate = {
                id,
                name: data.name,
                description: data.description,
                slideId: typeof slideSnapshot === 'string' ? slideSnapshot : JSON.stringify(slideSnapshot),
                category: data.category,
                appliesTo,
                thumbnail: data.thumbnail,
                backgroundStorageId: data.backgroundStorageId,
                createdBy: 'local',
                favoritedBy: [],
                createdAt: now,
                updatedAt: now,
                synced: false,
            }
            await saveLocalTemplate(localTemplate)
            await refreshLocalTemplates()
            return id
        }

        const serverId = await createTemplateMutation({
            name: data.name,
            description: data.description,
            slideId: slideSnapshot,
            category: data.category,
            appliesTo,
            thumbnail: data.thumbnail,
            backgroundStorageId: data.backgroundStorageId,
        })

        // Also cache locally for optimistic consistency
        const now = new Date().toISOString()
        await saveLocalTemplate({
            id: serverId,
            name: data.name,
            description: data.description,
            slideId: typeof slideSnapshot === 'string' ? slideSnapshot : JSON.stringify(slideSnapshot),
            category: data.category,
            appliesTo,
            thumbnail: data.thumbnail,
            backgroundStorageId: data.backgroundStorageId,
            createdBy: undefined,
            favoritedBy: [],
            createdAt: now,
            updatedAt: now,
            synced: true,
        })
        await refreshLocalTemplates()
        return serverId
    }

    const updateTemplate = async (templateId: string, updates: {
        name?: string
        description?: string
        slideId?: string | unknown
        category?: TemplateCategory
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }): Promise<string> => {
        const isLocal = templateId.startsWith('local_')
        const slideSnapshot = updates.slideId !== undefined
            ? sanitizeSlideSnapshot(updates.slideId)
            : undefined
        // As in `createTemplate`: normalize once so the optimistic cache, the
        // IndexedDB row and the server all store the same thing. `undefined`
        // means "not being changed", so only normalize when a value was supplied.
        const appliesTo = updates.appliesTo !== undefined
            ? normalizeAppliesTo(updates.appliesTo)
            : undefined

        // Optimistic update: update local state immediately so UI feels snappy
        setLocalTemplates(prev => prev.map(t =>
            t.id === templateId
                ? {
                    ...t,
                    name: updates.name ?? t.name,
                    description: updates.description ?? t.description,
                    slideId: typeof slideSnapshot === 'string' ? slideSnapshot : slideSnapshot ? JSON.stringify(slideSnapshot) : t.slideId,
                    category: updates.category ?? t.category,
                    appliesTo: appliesTo ?? t.appliesTo,
                    thumbnail: updates.thumbnail ?? t.thumbnail,
                    backgroundStorageId: updates.backgroundStorageId ?? t.backgroundStorageId,
                    updatedAt: new Date().toISOString(),
                }
                : t
        ))

        // Persist to IndexedDB so the optimistic cache survives reloads —
        // marked unsynced until the server has it. Best-effort: without
        // IndexedDB (private mode) this threw before the server was ever told.
        try {
            await updateLocalTemplateFromDB(templateId, {
                name: updates.name,
                description: updates.description,
                slideId: typeof slideSnapshot === 'string' ? slideSnapshot : slideSnapshot ? JSON.stringify(slideSnapshot) : undefined,
                category: updates.category,
                appliesTo,
                thumbnail: updates.thumbnail,
                backgroundStorageId: updates.backgroundStorageId,
                synced: false,
            })
            await refreshLocalTemplates()
        } catch (err) {
            console.warn('[useTemplates] local template cache not updated:', err)
        }

        if (isOffline || isLocal) {
            return templateId
        }

        // Online server update. `slideId` is overridden with the sanitized
        // snapshot rather than taken from the `...updates` spread, and only
        // when the caller actually supplied one — spreading an explicit
        // `slideId: undefined` is not the same as omitting the field.
        try {
            await updateTemplateMutation({
                templateId,
                updates: {
                    ...updates,
                    ...(slideSnapshot !== undefined ? { slideId: slideSnapshot } : {}),
                    ...(updates.appliesTo !== undefined ? { appliesTo } : {}),
                },
            })
        } catch (err) {
            // The server refused: drop the optimistic copy so its version
            // shows again, rather than a local edit that never happened.
            await deleteLocalTemplateFromDB(templateId).catch(() => {})
            await refreshLocalTemplates().catch(() => {})
            throw err
        }
        await updateLocalTemplateFromDB(templateId, { synced: true }).catch(() => {})
        await refreshLocalTemplates().catch(() => {})
        return templateId
    }

    const deleteTemplate = async (templateId: string): Promise<boolean> => {
        // Always remove from local cache so the UI updates immediately
        await deleteLocalTemplateFromDB(templateId)
        await refreshLocalTemplates()

        // Never reached the server, so there's nothing there to delete — and
        // asking it to delete an id it has never seen threw.
        if (templateId.startsWith('local_')) {
            return true
        }

        return await deleteTemplateMutation({ templateId })
    }

    const toggleFavorite = async (templateId: string): Promise<boolean> => {
        if (isOffline) return false
        return await toggleFavoriteMutation({ templateId })
    }

    const generateUploadUrl = async (): Promise<string> => {
        if (isOffline) {
            throw new Error('Cannot generate upload URL while offline')
        }
        return await generateUploadUrlMutation({})
    }

    const getFileUrl = (storageId: string | null): string | null => {
        if (!storageId) return null
        return `${import.meta.env.VITE_CONVEX_URL}/api/storage/${storageId}`
    }

    const seedDefaultTemplates = async (): Promise<{ seeded: boolean; count?: number; message?: string }> => {
        if (isOffline) {
            return { seeded: false, message: 'Cannot seed templates while offline' }
        }
        return await seedDefaultTemplatesMutation({})
    }

    const resetDefaultTemplates = async (): Promise<{ seeded: boolean; count?: number; message?: string }> => {
        if (isOffline) {
            return { seeded: false, message: 'Cannot reset templates while offline' }
        }
        return await resetDefaultTemplatesMutation({})
    }

    const getTemplatesForSlideType = (slideType: SlideType): TemplateItem[] => {
        const all = effectiveTemplates || []
        return all.filter(t => {
            const applies = t.appliesTo || ['any']
            return applies.includes('any') || applies.includes(slideType)
        })
    }

    return {
        templates: effectiveTemplates,
        customTemplates,
        isLoading: isOffline ? false : templates === undefined,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        toggleFavorite,
        generateUploadUrl,
        getFileUrl,
        seedDefaultTemplates,
        resetDefaultTemplates,
        getTemplatesForSlideType,
    }
}
