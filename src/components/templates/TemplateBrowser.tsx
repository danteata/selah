/**
 * TemplateBrowser — the templates panel (inline in the studio, or a modal).
 *
 * A template is a look: background, layout and text style. It does one of two
 * things, and the panel offers exactly those:
 *
 *   - Default for a kind of slide: every new Bible verse (song, hymn…) gets it.
 *     The same setting as Settings → Templates, set right from the card.
 *   - Add as slide: a new text slide in that look, for templates that suit text.
 *
 * Templates are found by what they work with (Bible verses, Songs…), which is
 * what decides where they're offered. The old Announcement/Worship/Sermon
 * category is only a filing label and no longer drives navigation. Favourites
 * are the church's: whoever is on the desk next sees the ones the team uses.
 */

import { MotionCanvas } from '../motion/MotionCanvas'
import { motionBackgroundFor } from '../motion/motionBackgrounds'
import { useTemplateMediaState } from '../../hooks/useTemplateMediaSync'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useConfirmDialog } from '../modals/ConfirmDialog'
import { X, Search, Grid, List, Plus, Sparkles, Heart, Check, Trash2, Loader2, RefreshCw, Edit2, LayoutTemplate, Video, Star, Save } from 'lucide-react'
import {
    useTemplates,
    TEMPLATE_SLIDE_TYPE_OPTIONS,
    templateCategory,
    type TemplateItem,
    type SlideType,
    useFileUrl,
} from '../../hooks/useTemplates'
import { DEFAULT_TEMPLATE_SLOTS, templateWorksWith, useDefaultTemplates, type DefaultTemplateSlot } from '../../hooks/useDefaultTemplates'
import { CreateTemplateModal } from '../modals'
import { useAuth } from '@clerk/clerk-react'
import { useUserRole } from '../../hooks/useUserRole'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import { useAppStore } from '../../store/appStore'
import { Modal } from '../modals/Modal'

const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
    bible: 'Bible',
    song: 'Song',
    hymn: 'Hymn',
    dictionary: 'Definition',
    text: 'Text',
    media: 'Media',
    announcement: 'Announcement',
    sermon: 'Sermon',
    prayer: 'Prayer',
    countdown: 'Countdown',
    any: 'Any',
}

const SLOT_SHORT_LABELS: Record<DefaultTemplateSlot, string> = {
    scripture: 'Bible',
    song: 'Songs',
    hymn: 'Hymns',
    dictionary: 'Definitions',
    text: 'Text',
}

/** The slide types offered as a "Works with" filter. `any` is excluded: it isn't
 *  a thing to filter *for*, it's the wildcard that matches every filter. */
const WORKS_WITH_FILTERS = TEMPLATE_SLIDE_TYPE_OPTIONS.filter((o) => o.id !== 'any')

/** The kinds of slide this template can be the default for. */
function slotsFor(template: TemplateItem) {
    return DEFAULT_TEMPLATE_SLOTS.filter(({ slideType }) => templateWorksWith(template, slideType))
}

function AppliesToBadges({ appliesTo }: { appliesTo?: SlideType[] }) {
    const filtered = (appliesTo ?? []).filter(t => t !== 'any')
    if (filtered.length === 0) {
        return <span className="text-[9px] text-white/70">Any slide</span>
    }
    return (
        <div className="flex flex-wrap gap-0.5">
            {filtered.slice(0, 3).map(t => (
                <span key={t} className="px-1 py-0.5 text-[9px] rounded bg-black/40 text-white/85">
                    {SLIDE_TYPE_LABELS[t] || t}
                </span>
            ))}
            {filtered.length > 3 && (
                <span className="px-1 py-0.5 text-[9px] rounded bg-black/40 text-white/70">
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
    defaultFor,
    operatorDefaultFor,
    onSelect,
    onDelete,
    onEdit,
    onFavorite,
    isDeleting,
    isFavoriting,
    canEdit,
}: {
    template: TemplateItem
    isSelected: boolean
    isCompact: boolean
    /** Kinds of slide this device uses it as the default for. */
    defaultFor: DefaultTemplateSlot[]
    /** Kinds of slide the live session's operator uses it for. */
    operatorDefaultFor: DefaultTemplateSlot[]
    onSelect: () => void
    onDelete: (e: React.MouseEvent) => void
    onEdit: (e: React.MouseEvent) => void
    onFavorite: (e: React.MouseEvent) => void
    isDeleting: boolean
    isFavoriting: boolean
    canEdit: boolean
}) {
    const isFavorite = !!template.isFavorite
    const config = templateCategory(template.category)

    const slideData = useMemo(() => {
        try {
            return typeof template.slideId === 'string' ? JSON.parse(template.slideId) : null
        } catch {
            return null
        }
    }, [template.slideId])

    const isVideoBackground = slideData?.backgroundType === 'video'
    const storageId = template.backgroundStorageId || (slideData?.backgroundStorageId as string | undefined) || null
    const fileUrl = useFileUrl(isVideoBackground ? storageId : null)
    const localBg = useLocalBackground(
        isVideoBackground ? (slideData?.background || '') : '',
        isVideoBackground ? (slideData?.localFilePath || '') : '',
    )
    const mediaState = useTemplateMediaState(template._id)
    // A background known to be on another computer would play as black; the
    // thumbnail below stands in for it.
    const videoUrl = mediaState === 'missing' && !fileUrl ? '' : fileUrl || localBg
    const videoRef = useRef<HTMLVideoElement>(null)

    useEffect(() => {
        if (videoRef.current && videoUrl) {
            videoRef.current.load()
        }
    }, [videoUrl])

    const motion = motionBackgroundFor(slideData?.background)

    const renderThumbnail = () => {
        // Motion templates animate in the picker, as video templates do.
        if (motion) {
            return (
                <div className="absolute inset-0">
                    <MotionCanvas background={motion} className="absolute inset-0" />
                    <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-black/50 backdrop-blur-sm rounded text-white text-[9px] font-medium">
                        <Sparkles className="w-2.5 h-2.5" />
                        Motion
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                </div>
            )
        }
        if (isVideoBackground && videoUrl) {
            return (
                <div className="absolute inset-0">
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full h-full object-cover"
                        autoPlay
                        loop
                        muted
                        playsInline
                    />
                    <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-black/50 backdrop-blur-sm rounded text-white text-[9px] font-medium">
                        <Video className="w-2.5 h-2.5" />
                        Video
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                </div>
            )
        }

        if (template.thumbnail) {
            return (
                <div className="absolute inset-0">
                    <img src={template.thumbnail} className="w-full h-full object-cover" alt="" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                </div>
            )
        }

        const bgColor = config?.hex || '#6B7280'
        return (
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${bgColor}30, ${bgColor}10)` }}>
                <div className="absolute inset-0 flex items-center justify-center opacity-20">
                    <LayoutTemplate className="w-8 h-8" style={{ color: bgColor }} />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </div>
        )
    }


    // Shown on hover where there's a pointer to hover with; always on touch,
    // where hover never happens.
    const hoverOnly = '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100'

    return (
        <div
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={template.name}
            onClick={onSelect}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
            className={`group relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-teal)] ${isSelected
                ? 'border-[var(--accent-teal)] shadow-lg shadow-[var(--accent-teal)]/10'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-md'
            }`}
        >
            <div className={`relative ${isCompact ? 'aspect-[4/3]' : 'aspect-video'}`}>
                {renderThumbnail()}

                {mediaState && mediaState !== 'uploaded' && mediaState !== 'failed' && (
                    <div className="absolute bottom-1.5 left-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] font-medium truncate">
                        {mediaState === 'uploading' && 'Uploading background…'}
                        {mediaState === 'missing' && 'Background is on another computer'}
                        {mediaState === 'over-limit' && "Over your church's 100 MB limit: this computer only"}
                    </div>
                )}

                {/* What it's the default for — top left. */}
                {(defaultFor.length > 0 || operatorDefaultFor.length > 0) && (
                    <div className="absolute top-1.5 left-1.5 right-14 z-10 flex flex-wrap gap-0.5">
                        {operatorDefaultFor.map((slot) => (
                            <span key={`op-${slot}`} className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-600 text-white" title={`The operator's default for ${SLOT_SHORT_LABELS[slot]}`}>
                                Operator · {SLOT_SHORT_LABELS[slot]}
                            </span>
                        ))}
                        {defaultFor.map((slot) => (
                            <span key={slot} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--accent-teal)] text-white" title={`Your default for ${SLOT_SHORT_LABELS[slot]}`}>
                                <Star className="w-2.5 h-2.5 fill-current" />
                                {SLOT_SHORT_LABELS[slot]}
                            </span>
                        ))}
                    </div>
                )}

                {/* Actions — top right. A favourite's heart stays visible. */}
                <div className="absolute top-1.5 right-1.5 z-10 flex gap-0.5">
                    <button
                        onClick={onFavorite}
                        disabled={isFavoriting}
                        className={`p-1 rounded bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white transition-opacity ${isFavorite ? '' : hoverOnly}`}
                        title={isFavorite ? 'Remove from your church’s favourites' : 'Add to your church’s favourites'}
                        aria-label={isFavorite ? 'Unfavourite' : 'Favourite'}
                        aria-pressed={isFavorite}
                    >
                        <Heart className={`w-3 h-3 ${isFavorite ? 'fill-current text-red-400' : ''}`} />
                    </button>
                    {canEdit && (
                        <>
                            <button
                                onClick={onEdit}
                                className={`p-1 rounded bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white transition-opacity ${hoverOnly}`}
                                title="Edit"
                                aria-label="Edit template"
                            >
                                <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                                onClick={onDelete}
                                disabled={isDeleting}
                                className={`p-1 rounded bg-black/40 backdrop-blur-sm hover:bg-red-500/80 text-white transition-opacity ${hoverOnly}`}
                                title="Delete"
                                aria-label="Delete template"
                            >
                                {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </button>
                        </>
                    )}
                </div>

                {/* Name and what it works with — bottom. */}
                <div className="absolute bottom-0 left-0 right-0 z-10 p-2 space-y-0.5">
                    <p className="text-white text-xs font-semibold leading-tight truncate drop-shadow-md">
                        {template.name}
                    </p>
                    {template.description && !isCompact && (
                        <p className="text-white/70 text-[10px] truncate">
                            {template.description}
                        </p>
                    )}
                    <AppliesToBadges appliesTo={template.appliesTo} />
                </div>
            </div>

            {isSelected && (
                <div className="absolute bottom-1.5 right-1.5 z-10 bg-[var(--accent-teal)] rounded-full p-0.5 pointer-events-none">
                    <Check className="w-3.5 h-3.5 text-white" />
                </div>
            )}
        </div>
    )
}

interface TemplateBrowserProps {
    isOpen?: boolean
    onClose?: () => void
    /** Add a new slide in this template's look. */
    onSelect: (template: TemplateItem) => void
    /** Save the live slide as a new template (the caller's flow). Offered only
     *  while a slide is live. */
    onCreateCustom?: () => boolean | void
    isInline?: boolean
    slideType?: SlideType
}

export function TemplateBrowser({ isOpen = true, onClose, onSelect, onCreateCustom, isInline = false, slideType }: TemplateBrowserProps) {
    const { confirm: askConfirm, ConfirmDialog } = useConfirmDialog()
    const [searchQuery, setSearchQuery] = useState('')
    // Which slide type a template works with: the filter that matters, since
    // it decides where the template is offered. `null` means no restriction.
    const [selectedSlideType, setSelectedSlideType] = useState<SlideType | null>(null)
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [isResetting, setIsResetting] = useState(false)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [editingTemplate, setEditingTemplate] = useState<TemplateItem | null>(null)
    const [showFavorites, setShowFavorites] = useState(false)
    const [favoritingId, setFavoritingId] = useState<string | null>(null)

    const { templates, isLoading, deleteTemplate, toggleFavorite, seedDefaultTemplates, resetDefaultTemplates, getTemplatesForSlideType } = useTemplates()
    const defaults = useDefaultTemplates()
    const hasLiveSlide = useAppStore((s) => !!s.liveSlideId)
    const { isSignedIn } = useAuth()
    const isAuthenticated = isSignedIn ?? false
    // The system templates are shared by every church, so only a superadmin
    // may reset them (the server enforces this too).
    const { isSuperadmin, currentUser } = useUserRole()

    // Add any built-in templates this deployment is missing, once a session:
    // the server adds only what's absent, and scopes built-ins seeded before
    // they said which slide types they suit.
    const seededRef = useRef(false)
    useEffect(() => {
        if (seededRef.current || !(isOpen || isInline) || isLoading || !templates || !isAuthenticated) return
        const builtins = templates.filter((t) => !t.createdBy)
        const names = builtins.map((t) => t.name)
        // Silk is the newest built-in and Ocean the retired one.
        const upToDate = names.includes('Silk') && !names.includes('Ocean') && builtins.every((t) => t.appliesTo)
        if (templates.length > 0 && upToDate) return
        seededRef.current = true
        void Promise.resolve(seedDefaultTemplates()).catch(() => { seededRef.current = false })
    }, [isOpen, isInline, isLoading, templates, seedDefaultTemplates, isAuthenticated])

    const handleResetDefaults = async () => {
        if (!await askConfirm({
            title: 'Reset default templates?',
            message: 'The built-in templates go back to their latest versions. Your custom templates are kept.',
            type: 'warning',
            confirmText: 'Reset',
        })) return
        setIsResetting(true)
        try {
            await resetDefaultTemplates()
        } finally {
            setIsResetting(false)
        }
    }

    useEffect(() => {
        if (isOpen || isInline) {
            setSelectedId(null)
            setSearchQuery('')
        }
    }, [isOpen, isInline])

    const handleDeleteTemplate = async (e: React.MouseEvent, templateId: string) => {
        e.stopPropagation()
        if (!await askConfirm({
            title: 'Delete template?',
            message: 'This template will be removed for good.',
            type: 'danger',
            confirmText: 'Delete',
        })) return
        setDeletingId(templateId)
        try {
            await deleteTemplate(templateId)
            if (selectedId === templateId) setSelectedId(null)
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

    // A `slideType` prop means the caller has already scoped the panel to one
    // type, so it wins and the filter row is hidden — nothing good comes of
    // offering a filter that fights the caller's own constraint.
    const activeSlideType = slideType ?? selectedSlideType

    const filteredTemplates = useMemo(() => {
        // `getTemplatesForSlideType` is reused rather than reimplemented so the
        // panel agrees with the inline pickers about what "works with" means.
        const source = activeSlideType ? getTemplatesForSlideType(activeSlideType) : (templates || [])
        const query = searchQuery.trim().toLowerCase()
        return source.filter((t) => {
            if (showFavorites && !t.isFavorite) return false
            if (!query) return true
            return t.name.toLowerCase().includes(query) || !!t.description?.toLowerCase().includes(query)
        })
    }, [templates, activeSlideType, getTemplatesForSlideType, searchQuery, showFavorites])

    const selectedTemplate = filteredTemplates.find((t) => t._id === selectedId) ?? null
    const selectedSlots = selectedTemplate ? slotsFor(selectedTemplate) : []
    const canAddAsSlide = !!selectedTemplate && templateWorksWith(selectedTemplate, 'text')

    const handleAddAsSlide = () => {
        if (!selectedTemplate) return
        onSelect(selectedTemplate)
        if (!isInline) onClose?.()
    }

    if (!isOpen && !isInline) return null

    const chip = (active: boolean) => `flex-shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${active
        ? 'bg-[var(--accent-teal)] text-white'
        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
    }`

    const content = (
        <div className="h-full flex flex-col overflow-hidden">
            {!isInline && (
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-3">
                        <Sparkles className="w-6 h-6 text-[var(--accent-teal)]" />
                        <div>
                            <h2 id="template-browser-title" className="text-lg font-semibold text-[var(--text-primary)]">
                                Templates
                            </h2>
                            <p className="text-sm text-[var(--text-muted)]">
                                A look for your slides. Make one the default and every new slide of that kind gets it.
                            </p>
                        </div>
                    </div>
                    <button
                        aria-label="Close"
                        onClick={onClose}
                        className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)]"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Search, new template, and (in the window) layout and reset. */}
            <div className="flex items-center gap-2 p-2 border-b border-[var(--border-subtle)]">
                <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search templates…"
                        className="w-full pl-9 pr-3 py-2 text-sm border border-[var(--border-default)] rounded-lg outline-none bg-[var(--bg-tertiary)] text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                    />
                </div>
                {!isInline && onCreateCustom && hasLiveSlide && (
                    <button
                        onClick={() => { if (onCreateCustom()) onClose?.() }}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10"
                        title="Save the slide that's live now as a template"
                    >
                        <Save className="w-4 h-4" />
                        Save live slide
                    </button>
                )}
                <button
                    onClick={() => { setEditingTemplate(null); setShowCreateModal(true) }}
                    className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 h-9 min-w-9 px-2.5 rounded-lg text-xs font-semibold text-white bg-[var(--accent-teal)] hover:brightness-110 shadow-sm"
                    title="New template"
                    aria-label="New template"
                >
                    <Plus className="w-4 h-4" />
                    {!isInline && 'New template'}
                </button>
                {!isInline && (
                    <div className="flex bg-[var(--bg-tertiary)] rounded-lg p-0.5">
                        <button
                            onClick={() => setViewMode('grid')}
                            aria-label="Grid view"
                            className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-[var(--bg-elevated)] shadow-sm' : 'text-[var(--text-muted)]'}`}
                        >
                            <Grid className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            aria-label="List view"
                            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-[var(--bg-elevated)] shadow-sm' : 'text-[var(--text-muted)]'}`}
                        >
                            <List className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
                {!isInline && isSuperadmin && (
                    <button
                        onClick={handleResetDefaults}
                        disabled={isResetting}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                        title="Reset default templates"
                        aria-label="Reset default templates"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
                    </button>
                )}
            </div>

            {/* What it works with, and the church's favourites. */}
            <div className="flex items-center gap-1.5 px-2 py-2 overflow-x-auto no-scrollbar border-b border-[var(--border-subtle)]" role="group" aria-label="Filter templates">
                <button
                    onClick={() => setShowFavorites((v) => !v)}
                    className={chip(showFavorites)}
                    aria-pressed={showFavorites}
                    title="Your church's favourites"
                >
                    <Heart className={`w-3 h-3 ${showFavorites ? 'fill-current' : ''}`} />
                    Favourites
                </button>
                {!slideType && (
                    <>
                        <span className="flex-shrink-0 w-px h-4 bg-[var(--border-default)]" aria-hidden="true" />
                        <button
                            onClick={() => setSelectedSlideType(null)}
                            className={chip(selectedSlideType === null)}
                            aria-pressed={selectedSlideType === null}
                            title="Any slide type"
                        >
                            All
                        </button>
                        {WORKS_WITH_FILTERS.map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => setSelectedSlideType(opt.id)}
                                className={chip(selectedSlideType === opt.id)}
                                aria-pressed={selectedSlideType === opt.id}
                                title={`Templates that work with ${opt.label}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </>
                )}
            </div>

            {/* Templates */}
            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-muted)]">
                        <Loader2 className="w-6 h-6 animate-spin mb-2" />
                        <p className="text-xs">Loading templates…</p>
                    </div>
                ) : filteredTemplates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-muted)] p-4">
                        <LayoutTemplate className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-sm font-medium">
                            {showFavorites ? 'No favourites here yet' : 'No templates found'}
                        </p>
                        <p className="text-xs mt-1">
                            {searchQuery
                                ? 'Try a different search'
                                : showFavorites
                                    ? 'Tap the heart on a template to share it with your team.'
                                    : 'Create one to get started'}
                        </p>
                    </div>
                ) : (
                    <div className={`grid ${isInline ? 'grid-cols-2' : viewMode === 'list' ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'} gap-2`}>
                        {filteredTemplates.map((template) => (
                            <TemplateCard
                                key={template._id}
                                template={template}
                                isSelected={selectedId === template._id}
                                isCompact={isInline}
                                defaultFor={DEFAULT_TEMPLATE_SLOTS.filter(({ slot }) => defaults.isMine(slot, template._id)).map(({ slot }) => slot)}
                                operatorDefaultFor={DEFAULT_TEMPLATE_SLOTS.filter(({ slot }) => defaults.isOperators(slot, template._id)).map(({ slot }) => slot)}
                                onSelect={() => setSelectedId((id) => (id === template._id ? null : template._id))}
                                onDelete={(e) => handleDeleteTemplate(e, template._id)}
                                onEdit={(e) => handleEditTemplate(e, template)}
                                onFavorite={(e) => handleToggleFavorite(e, template._id)}
                                isDeleting={deletingId === template._id}
                                isFavoriting={favoritingId === template._id}
                                canEdit={!!template.createdBy && template.createdBy === currentUser?._id}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* What a template does, once one is picked. */}
            <div className="flex-shrink-0 px-3 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 space-y-2">
                {selectedTemplate ? (
                    <>
                        <div className="flex items-center gap-2 min-w-0">
                            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{selectedTemplate.name}</p>
                            {selectedTemplate.description && (
                                <p className="text-xs text-[var(--text-muted)] truncate hidden sm:block">— {selectedTemplate.description}</p>
                            )}
                        </div>
                        {selectedSlots.length > 0 && (
                            <div className="space-y-1">
                                <p className="text-[11px] text-[var(--text-muted)]">Use as the default for new</p>
                                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Default for">
                                    {selectedSlots.map(({ slot, label }) => {
                                        const on = defaults.isMine(slot, selectedTemplate._id)
                                        return (
                                            <button
                                                key={slot}
                                                onClick={() => defaults.toggle(slot, selectedTemplate._id)}
                                                aria-pressed={on}
                                                className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-xs font-medium border transition-colors ${on
                                                    ? 'bg-[var(--accent-teal)] border-[var(--accent-teal)] text-white'
                                                    : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent-teal)]/60'
                                                }`}
                                            >
                                                {on ? <Check className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
                                                {label}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                        {defaults.inSession && (
                            <p className="text-[11px] text-[var(--text-muted)]">
                                In this live session the operator's defaults come first; yours fill in where they haven't set one.
                            </p>
                        )}
                        {canAddAsSlide && (
                            <button
                                onClick={handleAddAsSlide}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[var(--accent-teal)] hover:brightness-110 shadow-sm"
                            >
                                <Plus className="w-4 h-4" />
                                Add as slide
                            </button>
                        )}
                    </>
                ) : (
                    <p className="text-xs text-[var(--text-muted)]">
                        Pick a template to make it a default{templates?.some((t) => templateWorksWith(t, 'text')) ? ' or add it as a slide' : ''}.
                    </p>
                )}
            </div>
        </div>
    )

    const createModal = (
        <CreateTemplateModal
            isOpen={showCreateModal}
            onClose={() => {
                setShowCreateModal(false)
                setEditingTemplate(null)
            }}
            editingTemplate={editingTemplate}
        />
    )

    if (isInline) return (
        <>
            {content}
            <ConfirmDialog />
            {createModal}
        </>
    )

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={() => onClose?.()}
                labelledBy="template-browser-title"
                overlayClassName="bg-black/60 backdrop-blur-sm"
                className="w-full max-w-5xl h-[85vh] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden"
            >
                {content}
            </Modal>
            <ConfirmDialog />
            {createModal}
        </>
    )
}
