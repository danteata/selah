import { useState, useEffect, useMemo } from 'react'
import { X, Search, Grid, List, Plus, Sparkles, Heart, Check, Trash2, Loader2, RefreshCw, Edit2, LayoutTemplate } from 'lucide-react'
import { useTemplates, type TemplateItem, type SlideType } from '../../hooks/useTemplates'
import { CreateTemplateModal } from '../modals'
import { useAuth } from '@clerk/clerk-react'

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bgClass: string; dotClass: string }> = {
    announcement: { label: 'Announcement', color: '#3B82F6', bgClass: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', dotClass: 'bg-blue-500' },
    worship: { label: 'Worship', color: '#F59E0B', bgClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', dotClass: 'bg-amber-500' },
    sermon: { label: 'Sermon', color: '#F97316', bgClass: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', dotClass: 'bg-orange-500' },
    prayer: { label: 'Prayer', color: '#10B981', bgClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', dotClass: 'bg-emerald-500' },
    general: { label: 'General', color: '#6B7280', bgClass: 'bg-gray-500/15 text-gray-700 dark:text-gray-300', dotClass: 'bg-gray-500' },
}

const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
    bible: 'Bible',
    song: 'Song',
    hymn: 'Hymn',
    text: 'Text',
    media: 'Media',
    announcement: 'Announcement',
    countdown: 'Countdown',
    any: 'Any',
}

function CategoryBadge({ category }: { category: string }) {
    const config = CATEGORY_CONFIG[category]
    if (!config) return null
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${config.bgClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
            {config.label}
        </span>
    )
}

function AppliesToBadges({ appliesTo }: { appliesTo?: SlideType[] }) {
    if (!appliesTo || appliesTo.length === 0) return null
    const filtered = appliesTo.filter(t => t !== 'any')
    if (filtered.length === 0) return null
    return (
        <div className="flex flex-wrap gap-0.5">
            {filtered.slice(0, 3).map(t => (
                <span key={t} className="px-1 py-0.5 text-[9px] rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                    {SLIDE_TYPE_LABELS[t] || t}
                </span>
            ))}
            {filtered.length > 3 && (
                <span className="px-1 py-0.5 text-[9px] rounded bg-gray-100 dark:bg-gray-700 text-gray-400">
                    +{filtered.length - 3}
                </span>
            )}
        </div>
    )
}

function TemplateCard({
    template,
    isSelected,
    isCompact,
    onSelect,
    onDelete,
    onEdit,
    onFavorite,
    isDeleting,
    isFavoriting,
    isCustom,
}: {
    template: TemplateItem
    isSelected: boolean
    isCompact: boolean
    onSelect: () => void
    onDelete: (e: React.MouseEvent) => void
    onEdit: (e: React.MouseEvent) => void
    onFavorite: (e: React.MouseEvent) => void
    isDeleting: boolean
    isFavoriting: boolean
    isCustom: boolean
}) {
    const isFavorite = template.favoritedBy && template.favoritedBy.length > 0
    const config = CATEGORY_CONFIG[template.category]

    const renderThumbnail = () => {
        if (template.thumbnail) {
            return (
                <div className="absolute inset-0">
                    <img src={template.thumbnail} className="w-full h-full object-cover" alt="" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                </div>
            )
        }

        const bgColor = config?.color || '#6B7280'
        return (
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${bgColor}30, ${bgColor}10)` }}>
                <div className="absolute inset-0 flex items-center justify-center opacity-20">
                    <LayoutTemplate className="w-8 h-8" style={{ color: bgColor }} />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </div>
        )
    }

    return (
        <div
            onClick={onSelect}
            className={`group relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${isSelected
                ? 'border-[var(--accent-teal)] shadow-lg shadow-[var(--accent-teal)]/10 scale-[0.98]'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-md'
            }`}
        >
            <div className={`relative ${isCompact ? 'aspect-[4/3]' : 'aspect-video'}`}>
                {renderThumbnail()}

                {/* Category badge — top left */}
                <div className="absolute top-1.5 left-1.5 z-10">
                    <CategoryBadge category={template.category} />
                </div>

                {/* Action buttons — top right, show on hover */}
                <div className="absolute top-1.5 right-1.5 z-10 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={onFavorite}
                        disabled={isFavoriting}
                        className="p-1 rounded bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white transition-colors"
                        title={isFavorite ? 'Unfavorite' : 'Favorite'}
                    >
                        <Heart className={`w-3 h-3 ${isFavorite ? 'fill-current text-red-400' : ''}`} />
                    </button>
                    {isCustom && (
                        <>
                            <button
                                onClick={onEdit}
                                className="p-1 rounded bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white transition-colors"
                                title="Edit"
                            >
                                <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                                onClick={onDelete}
                                disabled={isDeleting}
                                className="p-1 rounded bg-black/40 backdrop-blur-sm hover:bg-red-500/80 text-white transition-colors"
                                title="Delete"
                            >
                                {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </button>
                        </>
                    )}
                </div>

                {/* Template name — bottom */}
                <div className="absolute bottom-0 left-0 right-0 z-10 p-2">
                    <p className="text-white text-xs font-semibold leading-tight truncate drop-shadow-md">
                        {template.name}
                    </p>
                    {template.description && !isCompact && (
                        <p className="text-white/70 text-[10px] truncate mt-0.5">
                            {template.description}
                        </p>
                    )}
                    <AppliesToBadges appliesTo={template.appliesTo} />
                </div>
            </div>

            {/* Selected indicator */}
            {isSelected && (
                <div className="absolute inset-0 bg-[var(--accent-teal)]/10 border-2 border-[var(--accent-teal)] rounded-lg flex items-center justify-center pointer-events-none">
                    <div className="bg-[var(--accent-teal)] rounded-full p-0.5">
                        <Check className="w-4 h-4 text-white" />
                    </div>
                </div>
            )}
        </div>
    )
}

interface TemplateBrowserProps {
    isOpen?: boolean
    onClose?: () => void
    onSelect: (template: TemplateItem) => void
    isInline?: boolean
    slideType?: SlideType
}

export function TemplateBrowser({ isOpen = true, onClose, onSelect, isInline = false, slideType }: TemplateBrowserProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [isResetting, setIsResetting] = useState(false)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [editingTemplate, setEditingTemplate] = useState<TemplateItem | null>(null)
    const [showFavorites, setShowFavorites] = useState(false)
    const [favoritingId, setFavoritingId] = useState<string | null>(null)

    const { templates, isLoading, deleteTemplate, toggleFavorite, seedDefaultTemplates, resetDefaultTemplates, getTemplatesForSlideType } = useTemplates()
    const { isSignedIn } = useAuth()
    const isAuthenticated = isSignedIn ?? false

    useEffect(() => {
        if ((isOpen || isInline) && !isLoading && templates?.length === 0) {
            seedDefaultTemplates()
        }
    }, [isOpen, isInline, isLoading, templates, seedDefaultTemplates])

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
        ...Object.entries(CATEGORY_CONFIG).map(([id, cfg]) => ({
            id,
            label: cfg.label,
            color: cfg.dotClass,
        })),
    ]

    const handleSelect = () => {
        if (selectedTemplate) {
            onSelect(selectedTemplate)
            onClose?.()
        }
    }

    const handleDeleteTemplate = async (e: React.MouseEvent, templateId: string) => {
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
    }

    const handleToggleFavorite = async (e: React.MouseEvent, templateId: string) => {
        e.stopPropagation()
        if (!isAuthenticated) return
        setFavoritingId(templateId)
        try {
            await toggleFavorite(templateId)
        } finally {
            setFavoritingId(null)
        }
    }

    const handleEditTemplate = (e: React.MouseEvent, template: TemplateItem) => {
        e.stopPropagation()
        setEditingTemplate(template)
        setShowCreateModal(true)
    }

    const filteredTemplates = useMemo(() => {
        const source = slideType ? getTemplatesForSlideType(slideType) : (templates || [])
        return source.filter((t) => {
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
    }, [templates, slideType, getTemplatesForSlideType, selectedCategory, searchQuery, showFavorites])

    if (!isOpen && !isInline) return null

    const content = (
        <div className={`${isInline ? 'h-full' : 'w-full max-w-5xl h-[85vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl'} flex flex-col overflow-hidden`}>
            {!isInline && (
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-[var(--accent-teal)]/5 to-amber-500/5">
                    <div className="flex items-center gap-3">
                        <Sparkles className="w-6 h-6 text-[var(--accent-teal)]" />
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
                {/* Sidebar */}
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
                                <span className={`w-3 h-3 rounded-full ${cat.color} flex-shrink-0`} />
                            ) : cat.icon ? (
                                <cat.icon className="w-4 h-4 flex-shrink-0" />
                            ) : null}
                            {!isInline && <span>{cat.label}</span>}
                            {!isInline && cat.id && filteredTemplates.filter(t => t.category === cat.id).length > 0 && (
                                <span className="ml-auto text-[10px] text-gray-400">{filteredTemplates.filter(t => t.category === cat.id).length}</span>
                            )}
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
                                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                            }`}
                            title="Favorites"
                        >
                            <Heart className={`w-4 h-4 flex-shrink-0 ${showFavorites ? 'fill-current' : ''}`} />
                            {!isInline && 'Favorites'}
                        </button>
                    </div>

                    <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
                        {!isInline && (
                            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
                                Your Templates
                            </p>
                        )}
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className={`w-full flex items-center gap-2 rounded-lg text-sm font-medium text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10 transition-colors ${isInline ? 'p-2 justify-center' : 'px-3 py-2'}`}
                            title="Create Custom Template"
                        >
                            <Plus className="w-4 h-4" />
                            {!isInline && 'Create Custom'}
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Search & View Toggle */}
                    <div className="flex items-center gap-3 p-3 border-b border-gray-200 dark:border-gray-800">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search templates..."
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
                        {!isInline && (
                            <button
                                onClick={handleResetDefaults}
                                disabled={isResetting}
                                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                title="Reset default templates"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
                            </button>
                        )}
                    </div>

                    {/* Results count */}
                    <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
                        {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
                        {slideType && ` for ${SLIDE_TYPE_LABELS[slideType] || slideType}`}
                        {selectedCategory && ` in ${CATEGORY_CONFIG[selectedCategory]?.label || selectedCategory}`}
                    </div>

                    {/* Templates Grid */}
                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                                <Loader2 className="w-6 h-6 animate-spin mb-2" />
                                <p className="text-xs">Loading templates...</p>
                            </div>
                        ) : filteredTemplates.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 p-4">
                                <LayoutTemplate className="w-8 h-8 mb-2 opacity-30" />
                                <p className="text-sm font-medium">No templates found</p>
                                <p className="text-xs mt-1 text-gray-400">
                                    {searchQuery ? 'Try a different search' : 'Create one to get started'}
                                </p>
                            </div>
                        ) : (
                            <div className={`grid ${isInline ? 'grid-cols-2' : viewMode === 'list' ? 'grid-cols-1' : 'grid-cols-3'} gap-3`}>
                                {filteredTemplates.map((template) => (
                                    <TemplateCard
                                        key={template._id}
                                        template={template}
                                        isSelected={selectedTemplate?._id === template._id}
                                        isCompact={isInline}
                                        onSelect={() => setSelectedTemplate(template)}
                                        onDelete={(e) => handleDeleteTemplate(e, template._id)}
                                        onEdit={(e) => handleEditTemplate(e, template)}
                                        onFavorite={(e) => handleToggleFavorite(e, template._id)}
                                        isDeleting={deletingId === template._id}
                                        isFavoriting={favoritingId === template._id}
                                        isCustom={!!template.createdBy}
                                    />
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
                        <div className="flex items-center gap-2">
                            <CategoryBadge category={selectedTemplate.category} />
                            <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
                                {selectedTemplate.name}
                            </p>
                            {selectedTemplate.description && (
                                <p className="text-[10px] text-gray-400 truncate hidden sm:block">
                                    — {selectedTemplate.description}
                                </p>
                            )}
                        </div>
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
                        {isInline ? 'USE' : 'Use Template'}
                    </button>
                </div>
            </div>
        </div>
    )

    if (isInline) return (
        <>
            {content}
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

    return (
        <>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={(e) => e.target === e.currentTarget && onClose?.()}
            >
                {content}
            </div>

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