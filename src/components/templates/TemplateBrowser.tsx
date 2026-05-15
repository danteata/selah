import { useState, useEffect, useCallback } from 'react'
import { X, Search, Grid, List, Plus, Sparkles, FileText, Heart, Clock, Check, Trash2, Loader2, AlertCircle, RefreshCw, Edit2, Star } from 'lucide-react'
import { useTemplates, type TemplateItem } from '../../hooks/useTemplates'
import { CreateTemplateModal } from '../modals'
import { useAuth } from '@clerk/clerk-react'

interface TemplateBrowserProps {
    isOpen?: boolean
    onClose?: () => void
    onSelect: (template: TemplateItem) => void
    onCreateCustom?: () => boolean
    isInline?: boolean
}

export function TemplateBrowser({ isOpen = true, onClose, onSelect, onCreateCustom, isInline = false }: TemplateBrowserProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [showNoSlideMessage, setShowNoSlideMessage] = useState(false)
    const [isResetting, setIsResetting] = useState(false)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [editingTemplate, setEditingTemplate] = useState<TemplateItem | null>(null)
    const [showFavorites, setShowFavorites] = useState(false)
    const [favoritingId, setFavoritingId] = useState<string | null>(null)

    const { templates, customTemplates, isLoading, deleteTemplate, toggleFavorite, seedDefaultTemplates, resetDefaultTemplates } = useTemplates()
    const { isSignedIn } = useAuth()
    const isAuthenticated = isSignedIn ?? false

    // Seed default templates if none exist
    useEffect(() => {
        if ((isOpen || isInline) && !isLoading && templates?.length === 0) {
            seedDefaultTemplates()
        }
    }, [isOpen, isInline, isLoading, templates, seedDefaultTemplates])

    // Handle resetting default templates
    const handleResetDefaults = async () => {
        if (!confirm('Reset default templates to latest versions? Your custom templates will be preserved.')) return
        setIsResetting(true)
        try {
            await resetDefaultTemplates()
        } finally {
            setIsResetting(false)
        }
    }

    useEffect(() => {
        if (isOpen || isInline) {
            setSelectedTemplate(null)
            setSearchQuery('')
            setSelectedCategory(null)
            setShowNoSlideMessage(false)
        }
    }, [isOpen, isInline])

    useEffect(() => {
        if (isInline) return

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose?.()
        }
        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            document.body.style.overflow = 'hidden'
        }
        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = ''
        }
    }, [isOpen, onClose, isInline])

    const categories = [
        { id: null, label: 'All', icon: Grid },
        { id: 'announcement', label: 'Announcement', color: 'bg-blue-500' },
        { id: 'worship', label: 'Worship', color: 'bg-amber-500' },
        { id: 'sermon', label: 'Sermon', color: 'bg-amber-500' },
        { id: 'prayer', label: 'Prayer', color: 'bg-green-500' },
        { id: 'general', label: 'General', color: 'bg-gray-500' },
    ]

    const handleSelect = () => {
        if (selectedTemplate) {
            onSelect(selectedTemplate)
            onClose?.()
        }
    }

    const handleDeleteTemplate = useCallback(async (e: React.MouseEvent, templateId: string) => {
        e.stopPropagation()
        if (!confirm('Are you sure you want to delete this template?')) return

        setDeletingId(templateId)
        try {
            await deleteTemplate(templateId)
            if (selectedTemplate?._id === templateId) {
                setSelectedTemplate(null)
            }
        } finally {
            setDeletingId(null)
        }
    }, [deleteTemplate, selectedTemplate])

    const handleToggleFavorite = useCallback(async (e: React.MouseEvent, templateId: string) => {
        e.stopPropagation()
        if (!isAuthenticated) return

        setFavoritingId(templateId)
        try {
            await toggleFavorite(templateId)
        } finally {
            setFavoritingId(null)
        }
    }, [toggleFavorite, isAuthenticated])

    const handleEditTemplate = useCallback((e: React.MouseEvent, template: TemplateItem) => {
        e.stopPropagation()
        setEditingTemplate(template)
        setShowCreateModal(true)
    }, [])

    // Filter templates based on category, search, and favorites
    const filteredTemplates = (templates || []).filter((t) => {
        // Filter by favorites if showFavorites is true
        if (showFavorites && !t.favoritedBy?.length) return false
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

    if (!isOpen && !isInline) return null

    const content = (
        <div className={`${isInline ? 'h-full' : 'w-full max-w-5xl h-[85vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl'} flex flex-col overflow-hidden`}>
            {/* Header - Only show if not inline */}
            {!isInline && (
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-primary-500/10 to-amber-500/10">
                    <div className="flex items-center gap-3">
                        <Sparkles className="w-6 h-6 text-primary-600" />
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                Slide Templates
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Choose from pre-designed templates or create your own
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
            )}

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar - Smaller if inline */}
                <div className={`${isInline ? 'w-14 p-1' : 'w-56 p-4'} border-r border-gray-200 dark:border-gray-800 space-y-1 overflow-y-auto custom-scrollbar`}>
                    {!isInline && (
                        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                            Categories
                        </p>
                    )}
                    {categories.map((cat) => (
                        <button
                            key={cat.id || 'all'}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={`w-full flex items-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                                isInline ? 'p-2 justify-center' : 'px-3 py-2'
                            } ${selectedCategory === cat.id
                                ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                }`}
                            title={cat.label}
                        >
                            {cat.color ? (
                                <span className={`w-3 h-3 rounded-full ${cat.color}`} />
                            ) : cat.icon ? (
                                <cat.icon className="w-4 h-4" />
                            ) : null}
                            {!isInline && cat.label}
                        </button>
                    ))}

                    <div className={`${isInline ? 'pt-2 mt-2' : 'pt-4 mt-4'} border-t border-gray-200 dark:border-gray-700`}>
                        {!isInline && (
                            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                                Quick Access
                            </p>
                        )}
                        <button
                            onClick={() => setShowFavorites(!showFavorites)}
                            className={`w-full flex items-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                                isInline ? 'p-2 justify-center' : 'px-3 py-2'
                            } ${showFavorites
                                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                }`}
                            title="Favorites"
                        >
                            <Heart className={`w-4 h-4 ${showFavorites ? 'fill-current' : ''}`} />
                            {!isInline && 'Favorites'}
                        </button>
                    </div>

                    {!isInline && (
                        <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
                            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                                Your Templates
                            </p>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                Create Custom
                            </button>
                        </div>
                    )}
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Search & View Toggle */}
                    <div className={`flex items-center gap-3 p-3 border-b border-gray-200 dark:border-gray-800`}>
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search..."
                                className="w-full pl-9 pr-4 py-1.5 text-xs border border-[var(--border-default)] rounded-lg outline-none bg-[var(--bg-tertiary)] text-gray-900 dark:text-white focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                            />
                        </div>
                        {!isInline && (
                            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                                <button
                                    onClick={() => setViewMode('grid')}
                                    className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`}
                                >
                                    <Grid className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => setViewMode('list')}
                                    className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`}
                                >
                                    <List className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Templates Grid */}
                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                                <Loader2 className="w-6 h-6 animate-spin mb-2" />
                            </div>
                        ) : filteredTemplates.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 p-4">
                                <p className="text-sm font-medium">No templates</p>
                            </div>
                        ) : (
                            <div className={`grid ${isInline ? 'grid-cols-2' : 'grid-cols-3'} gap-3`}>
                                {filteredTemplates.map((template) => (
                                    <div
                                        key={template._id}
                                        onClick={() => setSelectedTemplate(template)}
                                        className={`group relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${selectedTemplate?._id === template._id
                                            ? 'border-[var(--accent-teal)] shadow-lg shadow-[var(--accent-teal)]/10 scale-[0.98]'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                            }`}
                                    >
                                        <div className="aspect-video flex items-center justify-center bg-gradient-to-br from-primary-500/80 to-amber-600/80">
                                            {template.thumbnail && (
                                                <img src={template.thumbnail} className="w-full h-full object-cover absolute inset-0 opacity-40" />
                                            )}
                                            <span className="relative text-white text-[10px] font-bold z-10 text-center px-1">
                                                {template.name}
                                            </span>
                                        </div>
                                        {selectedTemplate?._id === template._id && (
                                            <div className="absolute inset-0 bg-primary-500/10 border border-primary-500 rounded-lg flex items-center justify-center">
                                                <Check className="w-5 h-5 text-white bg-primary-500 rounded-full p-1" />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                <div className="flex-1 min-w-0 mr-4">
                    {selectedTemplate && (
                        <p className="text-xs font-bold text-primary-500 truncate">
                            {selectedTemplate.name}
                        </p>
                    )}
                </div>
                <div className="flex gap-2">
                    {!isInline && (
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        onClick={handleSelect}
                        disabled={!selectedTemplate}
                        className={`px-4 py-2 text-xs font-bold rounded-lg transition-all shadow-sm ${
                            isInline ? 'bg-[var(--accent-teal)] text-white' : 'bg-[var(--accent-teal)] text-white hover:brightness-110'
                        } disabled:opacity-50`}
                    >
                        {isInline ? 'USE TEMPLATE' : 'Use Template'}
                    </button>
                </div>
            </div>
        </div>
    )

    if (isInline) return content

    return (
        <>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={(e) => e.target === e.currentTarget && onClose?.()}
            >
                {content}
            </div>

            {/* Create Template Modal */}
            <CreateTemplateModal
                isOpen={showCreateModal}
                onClose={() => {
                    setShowCreateModal(false)
                    setEditingTemplate(null)
                }}
                editingTemplate={editingTemplate}
            />
        </>
    )
}
