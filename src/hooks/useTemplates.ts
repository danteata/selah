import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import {
    saveLocalTemplate,
    getLocalTemplates,
    deleteLocalTemplate as deleteLocalTemplateFromDB,
    updateLocalTemplate as updateLocalTemplateFromDB,
    type LocalTemplate,
} from './useIndexedDB'

export type SlideType = 'bible' | 'song' | 'hymn' | 'text' | 'media' | 'announcement' | 'sermon' | 'prayer' | 'countdown' | 'any'

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

    useEffect(() => {
        if (!isOffline) return
        getLocalTemplates().then(setLocalTemplates).catch(() => {})
    }, [isOffline])

    const refreshLocalTemplates = useCallback(async () => {
        const locals = await getLocalTemplates()
        setLocalTemplates(locals)
    }, [])

    const customTemplates = isOffline
        ? localTemplates.filter(t => t.createdBy).map(localTemplateToTemplateItem)
        : templates?.filter(t => t.createdBy)

    const effectiveTemplates: TemplateItem[] | undefined = isOffline
        ? localTemplates.map(localTemplateToTemplateItem)
        : templates

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

        return await createTemplateMutation({
            name: data.name,
            description: data.description,
            slideId: data.slideId,
            category: data.category,
            appliesTo: data.appliesTo,
            thumbnail: data.thumbnail,
            backgroundStorageId: data.backgroundStorageId,
        })
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
        if (templateId.startsWith('local_')) {
            const local = await updateLocalTemplateFromDB(templateId, {
                name: updates.name,
                description: updates.description,
                slideId: typeof updates.slideId === 'string' ? updates.slideId : updates.slideId ? JSON.stringify(updates.slideId) : undefined,
                category: updates.category,
                appliesTo: updates.appliesTo,
                thumbnail: updates.thumbnail,
                backgroundStorageId: updates.backgroundStorageId,
            })
            if (local) {
                await refreshLocalTemplates()
                return local.id
            }
            throw new Error('Template not found')
        }

        return await updateTemplateMutation({
            templateId,
            ...updates,
        })
    }

    const deleteTemplate = async (templateId: string): Promise<boolean> => {
        if (isOffline && templateId.startsWith('local_')) {
            await deleteLocalTemplateFromDB(templateId)
            await refreshLocalTemplates()
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