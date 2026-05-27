import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import {
    saveLocalTemplate,
    getLocalTemplates,
    getLocalTemplate,
    deleteLocalTemplate as deleteLocalTemplateFromDB,
    updateLocalTemplate as updateLocalTemplateFromDB,
    type LocalTemplate,
} from './useIndexedDB'

export type SlideType = 'bible' | 'song' | 'hymn' | 'text' | 'media' | 'announcement' | 'sermon' | 'prayer' | 'countdown' | 'any'
type TemplateAppliesTo = Exclude<SlideType, 'sermon' | 'prayer'>

const TEMPLATE_APPLIES_TO_VALUES = new Set<TemplateAppliesTo>([
    'bible',
    'song',
    'hymn',
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

export function useFileUrl(storageId: string | null) {
    const result = useQuery(
        api.templates.getFileUrl,
        storageId ? { storageId } : 'skip'
    )

    return storageId ? result : null
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
        if (isOffline) {
            const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
            const now = new Date().toISOString()
            const localTemplate: LocalTemplate = {
                id,
                name: data.name,
                description: data.description,
                slideId: typeof data.slideId === 'string' ? data.slideId : JSON.stringify(data.slideId),
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
            slideId: data.slideId,
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
            slideId: typeof data.slideId === 'string' ? data.slideId : JSON.stringify(data.slideId),
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

        // Optimistic update: update local state immediately so UI feels snappy
        setLocalTemplates(prev => prev.map(t =>
            t.id === templateId
                ? {
                    ...t,
                    name: updates.name ?? t.name,
                    description: updates.description ?? t.description,
                    slideId: typeof updates.slideId === 'string' ? updates.slideId : updates.slideId ? JSON.stringify(updates.slideId) : t.slideId,
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
            slideId: typeof updates.slideId === 'string' ? updates.slideId : updates.slideId ? JSON.stringify(updates.slideId) : undefined,
            category: updates.category,
            appliesTo: updates.appliesTo,
            thumbnail: updates.thumbnail,
            backgroundStorageId: updates.backgroundStorageId,
        })
        await refreshLocalTemplates()

        if (isOffline || isLocal) {
            return templateId
        }

        // Online server update
        await updateTemplateMutation({
            templateId,
            updates: {
                ...updates,
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
