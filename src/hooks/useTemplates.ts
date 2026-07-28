import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useConvex, useQuery, useMutation } from 'convex/react'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { stripEphemeralBackground } from './useLocalBackground'
import {
    saveLocalTemplate,
    getLocalTemplates,
    getLocalTemplate,
    deleteLocalTemplate as deleteLocalTemplateFromDB,
    updateLocalTemplate as updateLocalTemplateFromDB,
    getCachedTemplateBlob,
    cacheTemplateBlob,
    type LocalTemplate,
} from './useIndexedDB'

export type SlideType = 'bible' | 'song' | 'hymn' | 'dictionary' | 'text' | 'media' | 'announcement' | 'sermon' | 'prayer' | 'countdown' | 'any'
type TemplateAppliesTo = Exclude<SlideType, 'sermon' | 'prayer'>

const TEMPLATE_APPLIES_TO_VALUES = new Set<TemplateAppliesTo>([
    'bible',
    'song',
    'hymn',
    'dictionary',
    'text',
    'media',
    'announcement',
    'countdown',
    'any',
])

function normalizeAppliesTo(appliesTo?: SlideType[]): TemplateAppliesTo[] | undefined {
    if (!appliesTo) return undefined
    const normalized = appliesTo.filter((type): type is TemplateAppliesTo => TEMPLATE_APPLIES_TO_VALUES.has(type as TemplateAppliesTo))
    return normalized.length > 0 ? normalized : ['any']
}

export type TemplateItem = {
    _id: string
    name: string
    description?: string
    slideId: string | unknown
    category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
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
        category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }) => Promise<string>
    updateTemplate: (templateId: string, updates: {
        name?: string
        description?: string
        slideId?: string | unknown
        category?: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
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

export function useFileUrl(storageId: string | null) {
    const convex = useConvex()
    const [url, setUrl] = useState<string | null>(null)
    // Tracks the storageId the in-flight resolver is operating on so we
    // ignore stale resolutions when storageId changes mid-fetch.
    const resolvingForRef = useRef<string | null>(null)

    useEffect(() => {
        if (!storageId) {
            setUrl(null)
            return
        }

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
                if (!cancelled) setUrl(urlCacheHit)
                return
            }

            // 2. IndexedDB blob cache → object URL (zero Convex traffic)
            const blob = await getCachedTemplateBlob(sid)
            if (cancelled || resolvingForRef.current !== sid) return
            if (blob) {
                setUrl(getTemplateObjectUrl(sid, blob))
                return
            }

            // 3. Convex query — one signed-URL op per storageId per browser
            try {
                const signedUrl = await fetchSignedUrlFromConvex(convex, sid)
                if (cancelled || resolvingForRef.current !== sid) return
                if (signedUrl) {
                    setCachedSignedUrl(sid, signedUrl)
                    setUrl(signedUrl)
                    // Background: fetch the bytes so the NEXT mount is fully local
                    backgroundCacheBlob(sid, signedUrl)
                } else {
                    setUrl(null)
                }
            } catch (err) {
                if (cancelled) return
                console.warn('[useFileUrl] Convex query failed for', sid, err)
                setUrl(null)
            }
        }

        resolve()

        return () => {
            cancelled = true
        }
    }, [storageId, convex])

    // No unmount cleanup: the URL is shared and may outlive this component on
    // a live slide. See `templateObjectUrls`.

    return url
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

    const effectiveTemplates: TemplateItem[] | undefined = useMemo(() => {
        const localList = localTemplates.map(localTemplateToTemplateItem)
        const serverList = (templates || []) as TemplateItem[]

        // Preserve loading state when online and templates haven't loaded yet
        if (!isOffline && templates === undefined) return undefined

        const map = new Map<string, TemplateItem>()
        for (const t of serverList) {
            map.set(t._id, t)
        }
        for (const t of localList) {
            const existing = map.get(t._id)
            if (!existing) {
                map.set(t._id, t)
            } else {
                const localTime = new Date(t.updatedAt || 0).getTime()
                const serverTime = new Date(existing.updatedAt || 0).getTime()
                if (localTime > serverTime) {
                    map.set(t._id, t)
                }
            }
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
        category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }): Promise<string> => {
        const slideSnapshot = sanitizeSlideSnapshot(data.slideId)
        if (isOffline) {
            const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
            const now = new Date().toISOString()
            const localTemplate: LocalTemplate = {
                id,
                name: data.name,
                description: data.description,
                slideId: typeof slideSnapshot === 'string' ? slideSnapshot : JSON.stringify(slideSnapshot),
                category: data.category,
                appliesTo: data.appliesTo,
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
            appliesTo: normalizeAppliesTo(data.appliesTo),
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
            appliesTo: data.appliesTo,
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
        category?: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
        appliesTo?: SlideType[]
        thumbnail?: string
        backgroundStorageId?: string
    }): Promise<string> => {
        const isLocal = templateId.startsWith('local_')
        const slideSnapshot = updates.slideId !== undefined
            ? sanitizeSlideSnapshot(updates.slideId)
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
                    appliesTo: updates.appliesTo as string[] ?? t.appliesTo,
                    thumbnail: updates.thumbnail ?? t.thumbnail,
                    backgroundStorageId: updates.backgroundStorageId ?? t.backgroundStorageId,
                    updatedAt: new Date().toISOString(),
                }
                : t
        ))

        // Persist to IndexedDB so the optimistic cache survives reloads
        await updateLocalTemplateFromDB(templateId, {
            name: updates.name,
            description: updates.description,
            slideId: typeof slideSnapshot === 'string' ? slideSnapshot : slideSnapshot ? JSON.stringify(slideSnapshot) : undefined,
            category: updates.category,
            appliesTo: updates.appliesTo,
            thumbnail: updates.thumbnail,
            backgroundStorageId: updates.backgroundStorageId,
        })
        await refreshLocalTemplates()

        if (isOffline || isLocal) {
            return templateId
        }

        // Online server update. `slideId` is overridden with the sanitized
        // snapshot rather than taken from the `...updates` spread, and only
        // when the caller actually supplied one — spreading an explicit
        // `slideId: undefined` is not the same as omitting the field.
        await updateTemplateMutation({
            templateId,
            updates: {
                ...updates,
                ...(slideSnapshot !== undefined ? { slideId: slideSnapshot } : {}),
                appliesTo: normalizeAppliesTo(updates.appliesTo),
            },
        })
        return templateId
    }

    const deleteTemplate = async (templateId: string): Promise<boolean> => {
        // Always remove from local cache so the UI updates immediately
        await deleteLocalTemplateFromDB(templateId)
        await refreshLocalTemplates()

        if (isOffline && templateId.startsWith('local_')) {
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
