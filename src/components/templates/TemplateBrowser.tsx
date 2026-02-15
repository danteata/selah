import { useState, useEffect, useCallback } from 'react'
import { X, Search, Grid, List, Plus, Sparkles, FileText, Heart, Clock, Check, Trash2, Loader2, AlertCircle, RefreshCw, Edit2, Star } from 'lucide-react'
import { useTemplates, type TemplateItem } from '../../hooks/useTemplates'
import { CreateTemplateModal } from '../modals'
import { useConvexAuth } from 'convex/react'

interface TemplateBrowserProps {
    isOpen: boolean
    onClose: () => void
    onSelect: (template: TemplateItem) => void
    onCreateCustom?: () => boolean
}

export function TemplateBrowser({ isOpen, onClose, onSelect, onCreateCustom }: TemplateBrowserProps) {
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
    const { isAuthenticated } = useConvexAuth()

    // Seed default templates if none exist
    useEffect(() => {
        if (isOpen && !isLoading && templates?.length === 0) {
            seedDefaultTemplates()
        }
    }, [isOpen, isLoading, templates, seedDefaultTemplates])

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
        if (isOpen) {
            setSelectedTemplate(null)
            setSearchQuery('')
            setSelectedCategory(null)
            setShowNoSlideMessage(false)
        }
    }, [isOpen])

    const handleCreateCustomClick = () => {
        setShowCreateModal(true)
    }

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

    const handleSelect = () => {
        if (selectedTemplate) {
            onSelect(selectedTemplate)
            onClose()
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

    if (!isOpen) return null

    return (
        <>
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

                    <div className="flex-1 flex overflow-hidden">
                        {/* Sidebar */}
                        <div className="w-56 border-r border-gray-200 dark:border-gray-800 p-4 space-y-1">
                            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                                Categories
                            </p>
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
                                    ) : cat.icon ? (
                                        <cat.icon className="w-4 h-4" />
                                    ) : null}
                                    {cat.label}
                                </button>
                            ))}

                            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
                                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                                    Quick Access
                                </p>
                                <button
                                    onClick={() => setShowFavorites(!showFavorites)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${showFavorites
                                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                        }`}
                                >
                                    <Heart className={`w-4 h-4 ${showFavorites ? 'fill-current' : ''}`} />
                                    Favorites
                                </button>
                                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                                    <Clock className="w-4 h-4" />
                                    Recently Used
                                </button>
                            </div>

                            {/* Custom Templates Section */}
                            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
                                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                                    Your Templates
                                </p>
                                <button
                                    onClick={handleCreateCustomClick}
                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    Create Custom
                                </button>
                                {showNoSlideMessage && (
                                    <p className="text-xs text-amber-500 mt-2 px-3 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        Select a slide first
                                    </p>
                                )}
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 px-3">
                                    {customTemplates?.length || 0} custom template{(customTemplates?.length || 0) !== 1 ? 's' : ''}
                                </p>

                                {/* Reset Default Templates Button */}
                                <button
                                    onClick={handleResetDefaults}
                                    disabled={isResetting}
                                    className="w-full flex items-center gap-2 px-3 py-2 mt-3 rounded-lg text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                                >
                                    {isResetting ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <RefreshCw className="w-4 h-4" />
                                    )}
                                    Reset Defaults
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
                                {isLoading ? (
                                    <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                                        <Loader2 className="w-8 h-8 animate-spin mb-4" />
                                        <p className="font-medium">Loading templates...</p>
                                    </div>
                                ) : filteredTemplates.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                                        <FileText className="w-16 h-16 mb-4 opacity-50" />
                                        <p className="font-medium">No templates found</p>
                                        <p className="text-sm mt-1">Try a different search or category</p>
                                        <button
                                            onClick={handleCreateCustomClick}
                                            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
                                        >
                                            <Plus className="w-4 h-4" />
                                            Create Custom Template
                                        </button>
                                    </div>
                                ) : viewMode === 'grid' ? (
                                    <div className="grid grid-cols-3 gap-4">
                                        {filteredTemplates.map((template) => (
                                            <div
                                                key={template._id}
                                                onClick={() => setSelectedTemplate(template)}
                                                className={`group relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${selectedTemplate?._id === template._id
                                                    ? 'border-primary-500 ring-4 ring-primary-500/20'
                                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                    }`}
                                            >
                                                <div
                                                    className="aspect-video flex items-center justify-center p-4 bg-gradient-to-br from-primary-500 to-purple-600"
                                                >
                                                    {template.thumbnail ? (
                                                        <img
                                                            src={template.thumbnail}
                                                            alt={template.name}
                                                            className="w-full h-full object-cover absolute inset-0 opacity-80"
                                                        />
                                                    ) : null}
                                                    <span className="relative text-white text-sm font-medium z-10 text-center">
                                                        {template.name}
                                                    </span>
                                                </div>
                                                <div className="p-3 bg-white dark:bg-gray-800">
                                                    <div className="flex items-center justify-between">
                                                        <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate flex-1">
                                                            {template.name}
                                                        </h4>
                                                        {template.createdBy && (
                                                            <span className="ml-2 px-1.5 py-0.5 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded">
                                                                Custom
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                                                        {template.description}
                                                    </p>
                                                </div>
                                                {selectedTemplate?._id === template._id ? (
                                                    <div className="absolute top-2 right-2 w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
                                                        <Check className="w-4 h-4 text-white" />
                                                    </div>
                                                ) : null}
                                                {/* Favorite button */}
                                                {isAuthenticated && (
                                                    <button
                                                        onClick={(e) => handleToggleFavorite(e, template._id)}
                                                        disabled={favoritingId === template._id}
                                                        className={`absolute top-2 left-2 p-1.5 rounded-lg transition-all ${template.favoritedBy?.length
                                                            ? 'bg-yellow-500/80 text-white'
                                                            : 'bg-black/30 text-white opacity-0 group-hover:opacity-100'
                                                            }`}
                                                        title={template.favoritedBy?.length ? 'Remove from favorites' : 'Add to favorites'}
                                                    >
                                                        {favoritingId === template._id ? (
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                        ) : (
                                                            <Star className={`w-3 h-3 ${template.favoritedBy?.length ? 'fill-current' : ''}`} />
                                                        )}
                                                    </button>
                                                )}
                                                {/* Edit button for custom templates */}
                                                {template.createdBy && (
                                                    <button
                                                        onClick={(e) => handleEditTemplate(e, template)}
                                                        className="absolute bottom-2 left-2 p-1.5 bg-blue-500/80 hover:bg-blue-600 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                                        title="Edit template"
                                                    >
                                                        <Edit2 className="w-3 h-3" />
                                                    </button>
                                                )}
                                                {/* Delete button for custom templates */}
                                                {template.createdBy && (
                                                    <button
                                                        onClick={(e) => handleDeleteTemplate(e, template._id)}
                                                        disabled={deletingId === template._id}
                                                        className="absolute bottom-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-600 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                                        title="Delete template"
                                                    >
                                                        {deletingId === template._id ? (
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                        ) : (
                                                            <Trash2 className="w-3 h-3" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {filteredTemplates.map((template) => (
                                            <div
                                                key={template._id}
                                                onClick={() => setSelectedTemplate(template)}
                                                className={`w-full flex items-center gap-4 p-3 rounded-lg border-2 transition-all text-left cursor-pointer ${selectedTemplate?._id === template._id
                                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                                    }`}
                                            >
                                                <div
                                                    className="w-24 h-16 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-primary-500 to-purple-600"
                                                >
                                                    <span className="text-white text-xs font-medium">Preview</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <h4 className="font-medium text-gray-900 dark:text-white truncate">
                                                            {template.name}
                                                        </h4>
                                                        {template.createdBy && (
                                                            <span className="px-1.5 py-0.5 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded">
                                                                Custom
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                                        {template.description}
                                                    </p>
                                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                                        {template.createdBy ? 'Your template' : 'Built-in template'}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {/* Favorite button */}
                                                    {isAuthenticated && (
                                                        <button
                                                            onClick={(e) => handleToggleFavorite(e, template._id)}
                                                            disabled={favoritingId === template._id}
                                                            className={`p-2 rounded-lg transition-colors ${template.favoritedBy?.length
                                                                ? 'text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                                                                : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                                                }`}
                                                            title={template.favoritedBy?.length ? 'Remove from favorites' : 'Add to favorites'}
                                                        >
                                                            {favoritingId === template._id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Star className={`w-4 h-4 ${template.favoritedBy?.length ? 'fill-current' : ''}`} />
                                                            )}
                                                        </button>
                                                    )}
                                                    {/* Edit button for custom templates */}
                                                    {template.createdBy && (
                                                        <button
                                                            onClick={(e) => handleEditTemplate(e, template)}
                                                            className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                                            title="Edit template"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    {template.createdBy && (
                                                        <button
                                                            onClick={(e) => handleDeleteTemplate(e, template._id)}
                                                            disabled={deletingId === template._id}
                                                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                                                            title="Delete template"
                                                        >
                                                            {deletingId === template._id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                    )}
                                                    {selectedTemplate?._id === template._id ? (
                                                        <Check className="w-5 h-5 text-primary-500" />
                                                    ) : null}
                                                </div>
                                            </div>
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
