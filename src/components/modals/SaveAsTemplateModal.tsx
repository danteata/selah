import { useState } from 'react'
import { X, Save } from 'lucide-react'
import type { Slide } from '../../types'
import { generateThumbnail } from '../../utils/templateThumbnail'
import type { SlideType } from '../../hooks/useTemplates'
import { useLocalBackground } from '../../hooks/useLocalBackground'

interface SaveAsTemplateModalProps {
    isOpen: boolean
    slide: Slide | null
    onClose: () => void
    onSave: (data: {
        name: string
        category: string
        description?: string
        thumbnail?: string
        appliesTo?: SlideType[]
    }) => void
}

const SLIDE_TYPES: { id: SlideType; label: string }[] = [
    { id: 'bible', label: 'Bible' },
    { id: 'song', label: 'Songs' },
    { id: 'hymn', label: 'Hymns' },
    { id: 'sermon', label: 'Sermon' },
    { id: 'prayer', label: 'Prayer' },
    { id: 'text', label: 'Text' },
    { id: 'media', label: 'Media' },
    { id: 'announcement', label: 'Announcements' },
    { id: 'countdown', label: 'Countdowns' },
    { id: 'any', label: 'Any Type' },
]

export function SaveAsTemplateModal({ isOpen, slide, onClose, onSave }: SaveAsTemplateModalProps) {
    const [name, setName] = useState(slide?.name || '')
    const [category, setCategory] = useState<string>('general')
    const [description, setDescription] = useState('')
    const [appliesTo, setAppliesTo] = useState<SlideType[]>(['any'])
    const [isSaving, setIsSaving] = useState(false)
    const resolvedBg = useLocalBackground(slide?.background, slide?.localFilePath)

    const categories = [
        { id: 'announcement', label: 'Announcement', color: 'bg-blue-500' },
        { id: 'worship', label: 'Worship', color: 'bg-amber-500' },
        { id: 'sermon', label: 'Sermon', color: 'bg-amber-500' },
        { id: 'prayer', label: 'Prayer', color: 'bg-green-500' },
        { id: 'general', label: 'General', color: 'bg-gray-500' },
    ]

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return

        setIsSaving(true)
        try {
            let thumbnail: string | undefined
            const bgType = slide?.backgroundType || 'image'
            const bg = slide?.background || ''

            if (bgType === 'image' && bg) {
                thumbnail = bg
            } else if (bgType === 'gradient' || bgType === 'color') {
                thumbnail = await generateThumbnail(bg, bgType, name)
            } else if (bgType === 'video' && bg) {
                thumbnail = await generateThumbnail(bg, 'video', name, resolvedBg || undefined)
            }

            await onSave({
                name: name.trim(),
                category,
                description: description.trim() || undefined,
                thumbnail,
                appliesTo,
            })
            onClose()
        } finally {
            setIsSaving(false)
        }
    }

    if (!isOpen || !slide) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
                    <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                        <Save className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                            Save as Template
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Save this slide for reuse
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-auto p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Preview */}
                    <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center text-gray-400">
                        <div
                            className="w-full h-full flex items-center justify-center p-4 text-center"
                            style={{
                                background: resolvedBg || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            }}
                        >
                            <span className="text-white text-sm font-medium truncate">
                                {slide.contents?.[0] || slide.name}
                            </span>
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Template Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="My Template"
                            required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                    </div>

                    {/* Category */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Category
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {categories.map((cat) => (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => setCategory(cat.id)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${category === cat.id
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <span className={`w-2 h-2 rounded-full ${cat.color}`} />
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Applies To */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Applies To
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            Which slide types can use this template?
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {SLIDE_TYPES.map((st) => (
                                <button
                                    key={st.id}
                                    type="button"
                                    onClick={() => {
                                        if (st.id === 'any') {
                                            setAppliesTo(['any'])
                                        } else {
                                            setAppliesTo(prev => {
                                                const withoutAny = prev.filter(id => id !== 'any') as SlideType[]
                                                if (withoutAny.includes(st.id)) {
                                                    const next = withoutAny.filter(id => id !== st.id)
                                                    return next.length === 0 ? ['any'] : next
                                                }
                                                return [...withoutAny, st.id]
                                            })
                                        }
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                        appliesTo.includes(st.id)
                                            ? 'bg-[var(--accent-teal)] text-white'
                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    {st.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Description (optional)
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Brief description of this template..."
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim() || isSaving}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--accent-teal)] hover:brightness-110 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                        >
                            {isSaving ? (
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            Save Template
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
