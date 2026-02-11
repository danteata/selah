import { useState, useEffect } from 'react'
import { X, Search, Grid, List, Plus, Sparkles, FileText, Heart, Clock, Check } from 'lucide-react'
import type { Template, Slide } from '../../types'

interface TemplateItem {
    id: string
    name: string
    description?: string
    category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
    thumbnail: string
    background: string
    isFavorite?: boolean
    usageCount: number
}

interface TemplateBrowserProps {
    isOpen: boolean
    onClose: () => void
    onSelect: (template: TemplateItem) => void
}

export function TemplateBrowser({ isOpen, onClose, onSelect }: TemplateBrowserProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)
    const [templates, setTemplates] = useState<TemplateItem[]>([])

    useEffect(() => {
        if (isOpen) {
            // Load templates - simulating with sample data
            setTemplates([
                {
                    id: '1',
                    name: 'Welcome Sunday',
                    description: 'Warm welcome slide for Sunday services',
                    category: 'announcement',
                    thumbnail: 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?w=400',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    usageCount: 124,
                    isFavorite: true,
                },
                {
                    id: '2',
                    name: 'Worship Night',
                    description: 'Atmospheric worship service background',
                    category: 'worship',
                    thumbnail: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=400',
                    background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                    usageCount: 89,
                },
                {
                    id: '3',
                    name: 'Scripture Focus',
                    description: 'Clean template for Bible verses',
                    category: 'sermon',
                    thumbnail: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?w=400',
                    background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                    usageCount: 56,
                },
                {
                    id: '4',
                    name: 'Prayer Request',
                    description: 'Calm template for prayer moments',
                    category: 'prayer',
                    thumbnail: 'https://images.unsplash.com/photo-1545389336-cf090694435e?w=400',
                    background: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
                    usageCount: 42,
                },
                {
                    id: '5',
                    name: 'Event Announcement',
                    description: 'Bold template for upcoming events',
                    category: 'announcement',
                    thumbnail: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400',
                    background: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
                    usageCount: 78,
                },
                {
                    id: '6',
                    name: 'Minimalist White',
                    description: 'Clean, simple white background',
                    category: 'general',
                    thumbnail: '',
                    background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
                    usageCount: 201,
                },
            ])
        }
    }, [isOpen])

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            document.body.style.overflow = 'hidden'
        }
        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = ''
        }
    }, [isOpen, onClose])

    const categories = [
        { id: null, label: 'All', icon: Grid },
        { id: 'announcement', label: 'Announcement', color: 'bg-blue-500' },
        { id: 'worship', label: 'Worship', color: 'bg-purple-500' },
        { id: 'sermon', label: 'Sermon', color: 'bg-amber-500' },
        { id: 'prayer', label: 'Prayer', color: 'bg-green-500' },
        { id: 'general', label: 'General', color: 'bg-gray-500' },
    ]

    const filteredTemplates = templates.filter((t) => {
        if (selectedCategory && t.category !== selectedCategory) return false
        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            return (
                t.name.toLowerCase().includes(query) ||
                t.description?.toLowerCase().includes(query)
            )
        }
        return true
    })

    const handleSelect = () => {
        if (selectedTemplate) {
            onSelect(selectedTemplate)
            onClose()
        }
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-5xl h-[85vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-primary-500/10 to-purple-500/10">
                    <div className="flex items-center gap-3">
                        <Sparkles className="w-6 h-6 text-primary-600" />
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                Slide Templates
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Choose from pre-designed templates
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Sidebar */}
                    <div className="w-56 border-r border-gray-200 dark:border-gray-800 p-4 space-y-1">
                        {categories.map((cat) => (
                            <button
                                key={cat.id || 'all'}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedCategory === cat.id
                                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                    }`}
                            >
                                {cat.color ? (
                                    <span className={`w-3 h-3 rounded-full ${cat.color}`} />
                                ) : (
                                    <cat.icon className="w-4 h-4" />
                                )}
                                {cat.label}
                            </button>
                        ))}

                        <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
                            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                                <Heart className="w-4 h-4" />
                                Favorites
                            </button>
                            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                                <Clock className="w-4 h-4" />
                                Recently Used
                            </button>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 flex flex-col">
                        {/* Search & View Toggle */}
                        <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search templates..."
                                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                />
                            </div>
                            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                                <button
                                    onClick={() => setViewMode('grid')}
                                    className={`p-2 rounded ${viewMode === 'grid'
                                        ? 'bg-white dark:bg-gray-700 shadow-sm'
                                        : 'text-gray-500'
                                        }`}
                                >
                                    <Grid className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-2 rounded ${viewMode === 'list'
                                        ? 'bg-white dark:bg-gray-700 shadow-sm'
                                        : 'text-gray-500'
                                        }`}
                                >
                                    <List className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Templates Grid */}
                        <div className="flex-1 overflow-y-auto p-4">
                            {filteredTemplates.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                                    <p className="font-medium">No templates found</p>
                                    <p className="text-sm mt-1">Try a different search or category</p>
                                </div>
                            ) : viewMode === 'grid' ? (
                                <div className="grid grid-cols-3 gap-4">
                                    {filteredTemplates.map((template) => (
                                        <button
                                            key={template.id}
                                            onClick={() => setSelectedTemplate(template)}
                                            className={`group relative rounded-xl overflow-hidden border-2 transition-all ${selectedTemplate?.id === template.id
                                                ? 'border-primary-500 ring-4 ring-primary-500/20'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                        >
                                            <div
                                                className="aspect-video flex items-center justify-center p-4"
                                                style={{ background: template.background }}
                                            >
                                                {template.thumbnail ? (
                                                    <img
                                                        src={template.thumbnail}
                                                        alt={template.name}
                                                        className="w-full h-full object-cover absolute inset-0 opacity-80"
                                                    />
                                                ) : null}
                                                <span className="relative text-white text-sm font-medium z-10">
                                                    {template.name}
                                                </span>
                                            </div>
                                            <div className="p-3 bg-white dark:bg-gray-800">
                                                <h4 className="font-medium text-gray-900 dark:text-white text-sm">
                                                    {template.name}
                                                </h4>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                                                    {template.description}
                                                </p>
                                            </div>
                                            {selectedTemplate?.id === template.id && (
                                                <div className="absolute top-2 right-2 w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
                                                    <Check className="w-4 h-4 text-white" />
                                                </div>
                                            )}
                                            {template.isFavorite && (
                                                <Heart className="absolute top-2 left-2 w-4 h-4 text-red-500 fill-red-500" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredTemplates.map((template) => (
                                        <button
                                            key={template.id}
                                            onClick={() => setSelectedTemplate(template)}
                                            className={`w-full flex items-center gap-4 p-3 rounded-lg border-2 transition-all text-left ${selectedTemplate?.id === template.id
                                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                        >
                                            <div
                                                className="w-24 h-16 rounded-lg overflow-hidden flex items-center justify-center"
                                                style={{ background: template.background }}
                                            >
                                                <span className="text-white text-xs font-medium">Preview</span>
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="font-medium text-gray-900 dark:text-white">
                                                    {template.name}
                                                </h4>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                                    {template.description}
                                                </p>
                                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                                    Used {template.usageCount} times
                                                </p>
                                            </div>
                                            {selectedTemplate?.id === template.id && (
                                                <Check className="w-5 h-5 text-primary-500" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {selectedTemplate
                            ? `Selected: ${selectedTemplate.name}`
                            : `${filteredTemplates.length} templates available`}
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSelect}
                            disabled={!selectedTemplate}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Plus className="w-4 h-4" />
                            Use Template
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
