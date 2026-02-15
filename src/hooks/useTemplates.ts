import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

// Type for template items returned from the database
export type TemplateItem = {
    _id: Id<'templates'>
    name: string
    description?: string
    slideId: string | unknown
    category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
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
        thumbnail?: string
        backgroundStorageId?: string
    }) => Promise<string>
    updateTemplate: (templateId: string, updates: {
        name?: string
        description?: string
        slideId?: string | unknown
        category?: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
        thumbnail?: string
        backgroundStorageId?: string
    }) => Promise<string>
    deleteTemplate: (templateId: string) => Promise<boolean>
    toggleFavorite: (templateId: string) => Promise<boolean>
    generateUploadUrl: () => Promise<string>
    getFileUrl: (storageId: string | null) => string | null
    seedDefaultTemplates: () => Promise<{ seeded: boolean; count?: number; message?: string }>
    resetDefaultTemplates: () => Promise<{ seeded: boolean; count?: number; message?: string }>
}

// Hook for getting file URL from storage ID
export function useFileUrl(storageId: string | null) {
    // Return null early if no storage ID provided
    // This avoids making a query with empty string
    const result = useQuery(
        api.templates.getFileUrl,
        storageId ? { storageId } : 'skip'
    )

    return storageId ? result : null
}

export function useTemplates(): UseTemplatesReturn {
    const templates = useQuery(api.templates.getTemplates)
    const createTemplateMutation = useMutation(api.templates.createTemplate)
    const updateTemplateMutation = useMutation(api.templates.updateTemplate)
    const deleteTemplateMutation = useMutation(api.templates.deleteTemplate)
    const toggleFavoriteMutation = useMutation(api.templates.toggleFavoriteTemplate)
    const generateUploadUrlMutation = useMutation(api.templates.generateUploadUrl)
    const seedDefaultTemplatesMutation = useMutation(api.templates.seedDefaultTemplates)
    const resetDefaultTemplatesMutation = useMutation(api.templates.resetDefaultTemplates)

    // Filter to get only custom (user-created) templates
    const customTemplates = templates?.filter(t => t.createdBy)

    const createTemplate = async (data: {
        name: string
        description?: string
        slideId: string | unknown
        category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
        thumbnail?: string
        backgroundStorageId?: string
    }): Promise<string> => {
        return await createTemplateMutation({
            name: data.name,
            description: data.description,
            slideId: data.slideId,
            category: data.category,
            thumbnail: data.thumbnail,
            backgroundStorageId: data.backgroundStorageId
        })
    }

    const updateTemplate = async (
        templateId: string,
        updates: {
            name?: string
            description?: string
            slideId?: string | unknown
            category?: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
            thumbnail?: string
            backgroundStorageId?: string
        }
    ): Promise<string> => {
        return await updateTemplateMutation({ templateId, updates })
    }

    const deleteTemplate = async (templateId: string): Promise<boolean> => {
        return await deleteTemplateMutation({ templateId })
    }

    const toggleFavorite = async (templateId: string): Promise<boolean> => {
        return await toggleFavoriteMutation({ templateId })
    }

    const generateUploadUrl = async (): Promise<string> => {
        return await generateUploadUrlMutation({})
    }

    // This is a synchronous function that returns null - use useFileUrl hook for actual URLs
    const getFileUrl = (storageId: string | null): string | null => {
        if (!storageId) return null
        // For actual URL retrieval, use the useFileUrl hook
        return null
    }

    const seedDefaultTemplates = async (): Promise<{ seeded: boolean; count?: number; message?: string }> => {
        return await seedDefaultTemplatesMutation({})
    }

    const resetDefaultTemplates = async (): Promise<{ seeded: boolean; count?: number; message?: string }> => {
        return await resetDefaultTemplatesMutation({})
    }

    return {
        templates,
        customTemplates,
        isLoading: templates === undefined,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        toggleFavorite,
        generateUploadUrl,
        getFileUrl,
        seedDefaultTemplates,
        resetDefaultTemplates
    }
}