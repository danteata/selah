import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAppStore } from '../store/appStore'
import type { Slide } from '../types'
export interface TemplateItem {
    _id?: string
    id: string
    name: string
    description?: string
    category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
    thumbnail?: string
    background?: string
    slideData?: Slide | null
    createdBy?: string
    isCustom?: boolean
    isFavorite?: boolean
    usageCount?: number
    createdAt?: string
    updatedAt?: string
}
export interface UseTemplatesReturn {
    templates: TemplateItem[]
    customTemplates: TemplateItem[]
    loading: boolean
    getTemplatesByCategory: (category: string) => TemplateItem[]
    getTemplateById: (id: string) => TemplateItem | null
    createTemplate: (templateData: {
        name: string
        description?: string
        slideData: Slide
        category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
        thumbnail?: string
    }) => Promise<TemplateItem | null>
    updateTemplate: (templateId: string, updates: Partial<TemplateItem>) => Promise<boolean>
    deleteTemplate: (templateId: string) => Promise<boolean>
}
// Built-in templates that come with the app
const BUILTIN_TEMPLATES: TemplateItem[] = [
    {
        id: 'builtin-welcome-sunday',
        name: 'Welcome Sunday',
        description: 'Warm welcome slide for Sunday services',
        category: 'announcement',
        thumbnail: 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?w=400',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        usageCount: 124,
        isFavorite: true,
        isCustom: false,
    },
    {
        id: 'builtin-worship-night',
        name: 'Worship Night',
        description: 'Atmospheric worship service background',
        category: 'worship',
        thumbnail: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=400',
        background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        usageCount: 89,
        isCustom: false,
    },
    {
        id: 'builtin-scripture-focus',
        name: 'Scripture Focus',
        description: 'Clean template for Bible verses',
        category: 'sermon',
        thumbnail: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?w=400',
        background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        usageCount: 56,
        isCustom: false,
    },
    {
        id: 'builtin-prayer-request',
        name: 'Prayer Request',
        description: 'Calm template for prayer moments',
        category: 'prayer',
        thumbnail: 'https://images.unsplash.com/photo-1545389336-cf090694435e?w=400',
        background: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        usageCount: 42,
        isCustom: false,
    },
    {
        id: 'builtin-event-announcement',
        name: 'Event Announcement',
        description: 'Bold template for upcoming events',
        category: 'announcement',
        thumbnail: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400',
        background: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
        usageCount: 78,
        isCustom: false,
    },
    {
        id: 'builtin-minimalist-white',
        name: 'Minimalist White',
        description: 'Clean, simple white background',
        category: 'general',
        thumbnail: '',
        background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
        usageCount: 201,
        isCustom: false,
    },
]
export function useTemplates(): UseTemplatesReturn {
    const [loading, setLoading] = useState(false)
    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const churchId = activeSchedule?.churchId || ''
    // Convex queries and mutations
    const customTemplatesQuery = useQuery(api.templates.getTemplates, {})
    const createTemplateMutation = useMutation(api.templates.createTemplate)
    const updateTemplateMutation = useMutation(api.templates.updateTemplate)
    const deleteTemplateMutation = useMutation(api.templates.deleteTemplate)
    // Transform custom templates from database
    const customTemplates: TemplateItem[] = useMemo(() => {
        if (!customTemplatesQuery) return []

        return customTemplatesQuery.map((t: any) => ({
            _id: t._id,
            id: t._id || t.name.toLowerCase().replace(/\s+/g, '-'),
            name: t.name,
            description: t.description,
            category: t.category,
            thumbnail: t.thumbnail,
            slideData: typeof t.slideId === 'object' ? t.slideId : null,
            createdBy: t.createdBy,
            isCustom: true,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
        }))
    }, [customTemplatesQuery])
    // Combine built-in and custom templates
    const templates: TemplateItem[] = useMemo(() => {
        return [...BUILTIN_TEMPLATES, ...customTemplates]
    }, [customTemplates])
    /**
     * Get templates by category
     */
    const getTemplatesByCategory = useCallback((category: string): TemplateItem[] => {
        if (category === 'all' || !category) return templates
        return templates.filter(t => t.category === category)
    }, [templates])
    /**
     * Get a single template by ID
     */
    const getTemplateById = useCallback((id: string): TemplateItem | null => {
        return templates.find(t => t._id === id || t.id === id) || null
    }, [templates])
    /**
     * Create a new custom template
     */
    const createTemplate = useCallback(async (templateData: {
        name: string
        description?: string
        slideData: Slide
        category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
        thumbnail?: string
    }): Promise<TemplateItem | null> => {
        try {
            setLoading(true)
            const templateId = await createTemplateMutation({
                name: templateData.name,
                description: templateData.description,
                slideId: templateData.slideData,
                category: templateData.category,
                thumbnail: templateData.thumbnail,
            })
            return {
                _id: templateId,
                id: templateId as string,
                name: templateData.name,
                description: templateData.description,
                category: templateData.category,
                thumbnail: templateData.thumbnail,
                slideData: templateData.slideData,
                isCustom: true,
            }
        } catch (error) {
            console.error('Error creating template:', error)
            return null
        } finally {
            setLoading(false)
        }
    }, [createTemplateMutation])
    /**
     * Update an existing template
     */
    const updateTemplate = useCallback(async (
        templateId: string,
        updates: Partial<TemplateItem>
    ): Promise<boolean> => {
        try {
            setLoading(true)
            await updateTemplateMutation({
                templateId,
                updates: {
                    name: updates.name,
                    description: updates.description,
                    category: updates.category as any,
                    thumbnail: updates.thumbnail,
                    slideId: updates.slideData,
                },
            })
            return true
        } catch (error) {
            console.error('Error updating template:', error)
            return false
        } finally {
            setLoading(false)
        }
    }, [updateTemplateMutation])
    /**
     * Delete a custom template
     */
    const deleteTemplate = useCallback(async (templateId: string): Promise<boolean> => {
        try {
            setLoading(true)
            await deleteTemplateMutation({ templateId })
            return true
        } catch (error) {
            console.error('Error deleting template:', error)
            return false
        } finally {
            setLoading(false)
        }
    }, [deleteTemplateMutation])
    return {
        templates,
        customTemplates,
        loading,
        getTemplatesByCategory,
        getTemplateById,
        createTemplate,
        updateTemplate,
        deleteTemplate,
    }
}