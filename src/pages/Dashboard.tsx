import { useUser, useClerk } from '@clerk/clerk-react'
import { useEffect, useState, useCallback } from 'react'
import { Shield, Database, Book, X, Mic } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useKeyboardShortcuts, initGlobalEmitter, useQuickActionHandlers, useLiveSync, useTemplates } from '../hooks'
import { SettingsModal } from '../components/settings/SettingsModal'
import { ShortcutsModal } from '../components/modals/ShortcutsModal'
import { SlideEditor } from '../components/editor/SlideEditor'
import { LowerThirdEditor } from '../components/editor/LowerThirdEditor'
import { MediaPicker } from '../components/media/MediaPicker'
import { TemplateBrowser } from '../components/templates/TemplateBrowser'
import { AddAlertModal } from '../components/alerts/AddAlertModal'
import { AddCountdownModal, type CountdownData } from '../components/countdown/AddCountdownModal'
import { LibraryPanel } from '../components/library/LibraryPanel'
import { ScheduleModal } from '../components/schedules/ScheduleModal'
import { DashboardLayout, DashboardHeader } from '../components/dashboard'
import { BibleVersionUploader, VerseEmbeddingUploader, GlobalSermonListenerSettingsPanel } from '../components/admin'
import { useUserRole } from '../hooks/useUserRole'
import { SaveAsTemplateModal } from '../components/modals/SaveAsTemplateModal'
import type { Slide } from '../types'
import type { TemplateItem } from '../hooks/useTemplates'

// Custom event to focus quick actions search
const FOCUS_QUICK_ACTIONS_EVENT = 'selah:focus-quick-actions'

export function focusQuickActionsSearch() {
    window.dispatchEvent(new CustomEvent(FOCUS_QUICK_ACTIONS_EVENT))
}

export default function Dashboard() {
    const { user: clerkUser } = useClerk()
    const { signOut } = useClerk()

    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const undo = useAppStore((state) => state.undo)
    const redo = useAppStore((state) => state.redo)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const updateActiveSlide = useAppStore((state) => state.updateActiveSlide)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
    const removeActiveSlide = useAppStore((state) => state.removeActiveSlide)
    const selectedSlideIds = useAppStore((state) => state.selectedSlideIds)
    const clearSelectedSlides = useAppStore((state) => state.clearSelectedSlides)
    const setActiveOverlay = useAppStore((state) => state.setActiveOverlay)

    // Get modal state and actions from Zustand store
    const modals = useAppStore((state) => state.modals)
    const editingSlide = useAppStore((state) => state.editingSlide)
    const closeModal = useAppStore((state) => state.closeModal)
    const openModal = useAppStore((state) => state.openModal)

    // Sync live state to other windows (for multi-monitor support)
    useLiveSync()

    const [isDark, setIsDark] = useState(() => {
        if (typeof window === 'undefined') return false
        return document.documentElement.classList.contains('dark')
    })

    // Sermon listener panel state - enabled by default
    const [showSermonListener, setShowSermonListener] = useState(true)

    // Save as template modal state
    const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false)
    const [slideToSaveAsTemplate, setSlideToSaveAsTemplate] = useState<Slide | null>(null)

    // Admin panel state
    const [showAdminPanel, setShowAdminPanel] = useState(false)
    const [adminTab, setAdminTab] = useState<'bible' | 'embeddings' | 'sermon-settings'>('bible')

    // Get user role for admin access
    const { isSuperadmin, canAccessAdmin, currentUser } = useUserRole()

    // Templates hook for creating custom templates
    const { createTemplate } = useTemplates()

    const toggleTheme = useCallback(() => {
        const newIsDark = !isDark
        setIsDark(newIsDark)
        if (newIsDark) {
            document.documentElement.classList.add('dark')
            localStorage.setItem('theme', 'dark')
        } else {
            document.documentElement.classList.remove('dark')
            localStorage.setItem('theme', 'light')
        }
    }, [isDark])

    // Initialize global emitter
    useEffect(() => {
        initGlobalEmitter()
    }, [])

    // Initialize theme from localStorage
    useEffect(() => {
        const savedTheme = localStorage.getItem('theme')
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [])

    // Quick action handlers - sets up event listeners
    const { handleSlideEditorSave } = useQuickActionHandlers()

    // Get slides for the active schedule
    const scheduleSlides = activeSchedule
        ? activeSlides.filter(slide => slide.scheduleId === activeSchedule._id || !slide.scheduleId)
        : activeSlides.filter(slide => !slide.scheduleId)

    // Navigate slides
    const navigateToNextSlide = useCallback(() => {
        const currentIndex = scheduleSlides.findIndex(s => s.id === liveSlideId)
        if (currentIndex < scheduleSlides.length - 1) {
            setLiveSlide(scheduleSlides[currentIndex + 1].id)
        }
    }, [scheduleSlides, liveSlideId, setLiveSlide])

    const navigateToPrevSlide = useCallback(() => {
        const currentIndex = scheduleSlides.findIndex(s => s.id === liveSlideId)
        if (currentIndex > 0) {
            setLiveSlide(scheduleSlides[currentIndex - 1].id)
        }
    }, [scheduleSlides, liveSlideId, setLiveSlide])

    const navigateToFirstSlide = useCallback(() => {
        if (scheduleSlides.length > 0) {
            setLiveSlide(scheduleSlides[0].id)
        }
    }, [scheduleSlides, setLiveSlide])

    const navigateToLastSlide = useCallback(() => {
        if (scheduleSlides.length > 0) {
            setLiveSlide(scheduleSlides[scheduleSlides.length - 1].id)
        }
    }, [scheduleSlides, setLiveSlide])

    // Delete selected slides
    const deleteSelectedSlides = useCallback(() => {
        if (selectedSlideIds.length > 0) {
            selectedSlideIds.forEach(id => {
                const slide = activeSlides.find(s => s.id === id)
                if (slide) {
                    removeActiveSlide(slide)
                }
            })
            clearSelectedSlides()
        }
    }, [selectedSlideIds, activeSlides, removeActiveSlide, clearSelectedSlides])

    // Toggle live slide (promote current preview slide to live)
    const promoteToLive = useCallback(() => {
        if (!liveSlideId && scheduleSlides.length > 0) {
            setLiveSlide(scheduleSlides[0].id)
        }
    }, [liveSlideId, scheduleSlides, setLiveSlide])

    // Toggle overlay (black/white screen)
    const toggleBlackScreen = useCallback(() => {
        const currentOverlay = useAppStore.getState().activeOverlay
        setActiveOverlay(currentOverlay === 'black' ? 'none' : 'black')
    }, [setActiveOverlay])

    const toggleWhiteScreen = useCallback(() => {
        const currentOverlay = useAppStore.getState().activeOverlay
        setActiveOverlay(currentOverlay === 'white' ? 'none' : 'white')
    }, [setActiveOverlay])

    // Open settings
    const openSettings = useCallback(() => {
        openModal('settings')
    }, [openModal])

    // Open shortcuts modal
    const openShortcutsModal = useCallback(() => {
        openModal('shortcuts')
    }, [openModal])

    // Focus quick actions search
    const focusSearch = useCallback(() => {
        focusQuickActionsSearch()
    }, [])

    // Global keyboard shortcuts
    useKeyboardShortcuts([
        // Undo/Redo
        { key: 'z', callback: undo, options: { ctrlOrMeta: true } },
        { key: 'y', callback: redo, options: { ctrlOrMeta: true } },
        // Settings
        { key: ',', callback: openSettings, options: { ctrlOrMeta: true } },
        // Shortcuts help
        { key: 'h', callback: openShortcutsModal, options: { ctrlOrMeta: true } },
        // Focus quick actions
        { key: '/', callback: focusSearch, options: { ctrlOrMeta: true } },
        // Promote to live
        { key: 'p', callback: promoteToLive, options: { ctrlOrMeta: true } },
        // Navigation - Arrow keys (without modifiers)
        { key: 'ArrowDown', callback: navigateToNextSlide },
        { key: 'ArrowUp', callback: navigateToPrevSlide },
        // Navigation - Home/End
        { key: 'Home', callback: navigateToFirstSlide },
        { key: 'End', callback: navigateToLastSlide },
        // Delete selected slides
        { key: 'Delete', callback: deleteSelectedSlides },
        // Black/White screen toggles
        { key: 'b', callback: toggleBlackScreen },
        { key: 'w', callback: toggleWhiteScreen },
    ])

    // Handle media selection
    const handleMediaSelect = (media: { id: string; url: string; name: string }) => {
        // Create a media slide from selected media
        const slide: Slide = {
            id: `slide_${Date.now()}`,
            index: 0,
            name: media.name,
            type: 'media',
            layout: 'empty',
            contents: [],
            userId: '',
            churchId: '',
            scheduleId: activeSchedule?._id || '',
            background: media.url,
            backgroundType: 'image',
        }
        appendActiveSlide(slide)
        closeModal('mediaPicker')
    }

    // Handle template selection
    const handleTemplateSelect = async (template: TemplateItem) => {
        // Parse the slideId - it could be a JSON string or an object
        let templateSlide: Partial<Slide> | null = null
        if (typeof template.slideId === 'string') {
            try {
                templateSlide = JSON.parse(template.slideId)
            } catch {
                // If parsing fails, templateSlide remains null
            }
        } else if (typeof template.slideId === 'object' && template.slideId !== null) {
            templateSlide = template.slideId as Partial<Slide>
        }

        // If template has a backgroundStorageId, we need to get the URL
        // For now, we'll use the background from the slide data or thumbnail
        // The video URL will be fetched when the slide is displayed
        const slide: Slide = {
            id: `slide_${Date.now()}`,
            index: 0,
            name: template.name,
            type: templateSlide?.type || 'text',
            layout: templateSlide?.layout || 'full-text',
            contents: templateSlide?.contents || ['Your content here'],
            userId: '',
            churchId: '',
            scheduleId: activeSchedule?._id || '',
            background: templateSlide?.background || template.thumbnail || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            backgroundType: templateSlide?.backgroundType || 'gradient',
            backgroundStorageId: templateSlide?.backgroundStorageId || template.backgroundStorageId,
        }
        appendActiveSlide(slide)
        closeModal('templateBrowser')
    }

    // Handle creating custom template from current slide
    const handleCreateCustomTemplate = () => {
        // Get the currently selected slide from the store
        const state = useAppStore.getState()
        const currentSlideId = state.liveSlideId
        const currentSlide = state.activeSlides.find(s => s.id === currentSlideId)
        if (currentSlide) {
            setSlideToSaveAsTemplate(currentSlide)
            setShowSaveAsTemplate(true)
            return true
        }
        return false
    }

    // Handle saving a slide as a template
    const handleSaveAsTemplate = async (name: string, category: string, description?: string) => {
        if (!slideToSaveAsTemplate) return

        await createTemplate({
            name,
            category: category as 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general',
            description,
            slideId: slideToSaveAsTemplate,
            thumbnail: slideToSaveAsTemplate.background,
        })

        setShowSaveAsTemplate(false)
        setSlideToSaveAsTemplate(null)
    }

    // Handle countdown creation - convert CountdownData to Countdown slide
    const handleCountdownCreate = (countdownData: CountdownData) => {
        const timeString = `${String(countdownData.hours).padStart(2, '0')}:${String(countdownData.minutes).padStart(2, '0')}:${String(countdownData.seconds).padStart(2, '0')}`

        // Check if we're editing an existing slide
        const isEditing = editingSlide?.id === countdownData.id

        const slide: Slide = {
            id: countdownData.id,
            index: isEditing ? editingSlide?.index ?? 0 : 0,
            name: `Countdown: ${countdownData.title}`,
            type: 'countdown',
            layout: 'countdown',
            contents: [countdownData.title, timeString],
            userId: isEditing ? editingSlide?.userId || '' : '',
            churchId: isEditing ? editingSlide?.churchId || '' : '',
            scheduleId: activeSchedule?._id || '',
            background: countdownData.background,
            backgroundType: countdownData.backgroundType,
            backgroundStorageId: countdownData.backgroundStorageId ?? null,
            data: {
                id: countdownData.id,
                time: timeString,
                timeLeft: timeString,
                content: countdownData.title,
            },
            slideStyle: isEditing ? editingSlide?.slideStyle ?? { fontSize: 17.5, alignment: 'center' } : { fontSize: 17.5, alignment: 'center' },
        }

        if (isEditing) {
            updateActiveSlide(slide)
        } else {
            appendActiveSlide(slide)
        }
        closeModal('countdownModal')
    }

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] overflow-hidden">
            {/* Subtle Background Elements - refined, not garish */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                {/* Primary accent glow - teal */}
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-[var(--accent-teal)]/8 dark:bg-[var(--accent-teal)]/5 rounded-full blur-3xl animate-pulse-soft" />
                {/* Secondary accent glow - amber */}
                <div className="absolute top-1/3 -left-40 w-80 h-80 bg-[var(--accent-amber)]/6 dark:bg-[var(--accent-amber)]/4 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: '2s' }} />
                {/* Tertiary accent glow - rose */}
                <div className="absolute -bottom-40 right-1/4 w-72 h-72 bg-[var(--accent-rose)]/5 dark:bg-[var(--accent-rose)]/3 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: '4s' }} />
            </div>

            {/* Grain texture overlay */}
            <div className="grain-overlay" />

            {/* Header */}
            <DashboardHeader
                isDark={isDark}
                onToggleTheme={toggleTheme}
                activeSchedule={activeSchedule}
                showSermonListener={showSermonListener}
                onToggleSermonListener={() => setShowSermonListener(!showSermonListener)}
                showAdminPanel={showAdminPanel}
                onToggleAdminPanel={() => setShowAdminPanel(!showAdminPanel)}
                canAccessAdmin={canAccessAdmin}
                user={{
                    name: clerkUser?.firstName || clerkUser?.username || 'User',
                    onSignOut: () => signOut()
                }}
            />

            {/* Main Content with Draggable Layout */}
            <main className="pt-16 h-screen">
                <DashboardLayout
                    showSermonListener={showSermonListener}
                    onSermonListenerToggle={() => setShowSermonListener(!showSermonListener)}
                />
            </main>

            {/* Modals */}
            {modals.settings && (
                <SettingsModal
                    isOpen={modals.settings}
                    onClose={() => closeModal('settings')}
                />
            )}

            {modals.shortcuts && (
                <ShortcutsModal
                    isOpen={modals.shortcuts}
                    onClose={() => closeModal('shortcuts')}
                />
            )}

            {modals.editor && editingSlide && (
                <SlideEditor
                    slide={editingSlide}
                    isOpen={modals.editor}
                    onClose={() => closeModal('editor')}
                    onSave={handleSlideEditorSave}
                />
            )}

            {modals.mediaPicker && (
                <MediaPicker
                    isOpen={modals.mediaPicker}
                    onClose={() => closeModal('mediaPicker')}
                    onSelect={handleMediaSelect}
                />
            )}

            {modals.templateBrowser && (
                <TemplateBrowser
                    isOpen={modals.templateBrowser}
                    onClose={() => closeModal('templateBrowser')}
                    onSelect={handleTemplateSelect}
                    onCreateCustom={handleCreateCustomTemplate}
                />
            )}

            {/* Save As Template Modal */}
            <SaveAsTemplateModal
                isOpen={showSaveAsTemplate}
                slide={slideToSaveAsTemplate}
                onClose={() => {
                    setShowSaveAsTemplate(false)
                    setSlideToSaveAsTemplate(null)
                }}
                onSave={handleSaveAsTemplate}
            />

            {/* AddAlertModal handles its own alerts via store internally */}
            {modals.alertModal && (
                <AddAlertModal
                    isOpen={modals.alertModal}
                    onClose={() => closeModal('alertModal')}
                    editingSlide={editingSlide}
                />
            )}

            {modals.countdownModal && (
                <AddCountdownModal
                    isOpen={modals.countdownModal}
                    onClose={() => closeModal('countdownModal')}
                    onAdd={handleCountdownCreate}
                    editingSlide={editingSlide}
                />
            )}

            {/* LibraryPanel handles its own slide usage via useSlide internally */}
            {modals.libraryPanel && (
                <LibraryPanel
                    isOpen={modals.libraryPanel}
                    onClose={() => closeModal('libraryPanel')}
                />
            )}

            {/* Schedule Modal for creating new schedules */}
            {modals.scheduleModal && (
                <ScheduleModal
                    isOpen={modals.scheduleModal}
                    onClose={() => closeModal('scheduleModal')}
                />
            )}

            {modals.lowerThirdEditor && editingSlide && (
                <LowerThirdEditor
                    slide={editingSlide}
                    isOpen={modals.lowerThirdEditor}
                    onClose={() => closeModal('lowerThirdEditor')}
                    onSave={handleSlideEditorSave}
                />
            )}

            {/* Admin Panel Modal */}
            {showAdminPanel && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4">
                        <div
                            className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
                            onClick={() => setShowAdminPanel(false)}
                        />
                        <div className="relative bg-[var(--bg-secondary)] rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden border border-[var(--border-default)]">
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
                                <div className="flex items-center gap-3">
                                    <Shield className="w-5 h-5 text-[var(--accent-indigo)]" />
                                    <h2 className="text-lg font-semibold text-[var(--text-primary)]" style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}>
                                        Admin Panel
                                    </h2>
                                </div>
                                <button
                                    onClick={() => setShowAdminPanel(false)}
                                    className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-[var(--border-subtle)]">
                                <button
                                    onClick={() => setAdminTab('bible')}
                                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'bible'
                                        ? 'border-[var(--accent-teal)] text-[var(--accent-teal)]'
                                        : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                                        }`}
                                >
                                    <Book className="w-4 h-4" />
                                    Bible Versions
                                </button>
                                <button
                                    onClick={() => setAdminTab('embeddings')}
                                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'embeddings'
                                        ? 'border-[var(--accent-teal)] text-[var(--accent-teal)]'
                                        : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                                        }`}
                                >
                                    <Database className="w-4 h-4" />
                                    Verse Embeddings
                                </button>
                                <button
                                    onClick={() => setAdminTab('sermon-settings')}
                                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${adminTab === 'sermon-settings'
                                        ? 'border-[var(--accent-teal)] text-[var(--accent-teal)]'
                                        : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                                        }`}
                                >
                                    <Mic className="w-4 h-4" />
                                    Sermon Settings
                                </button>
                            </div>

                            {/* Content */}
                            <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
                                {adminTab === 'bible' && (
                                    <BibleVersionUploader onClose={() => setShowAdminPanel(false)} />
                                )}
                                {adminTab === 'embeddings' && (
                                    <VerseEmbeddingUploader onClose={() => setShowAdminPanel(false)} />
                                )}
                                {adminTab === 'sermon-settings' && (
                                    <GlobalSermonListenerSettingsPanel
                                        onClose={() => setShowAdminPanel(false)}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
