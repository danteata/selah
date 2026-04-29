import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    X, BookOpen, Music, Image, Layout, Clock,
    AlertCircle, Archive, Calendar, Mic, Settings
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { NavSection } from '../../types/studio'

// Existing panel components (reused during migration)
import { BibleList } from '../bible/BibleList'
import { HymnList } from '../hymns/HymnList'
import { SongList } from '../songs/SongList'
import { SermonListenerPanel } from '../sermon-listener/SermonListenerPanel'
import { MediaPicker } from '../media/MediaPicker'
import { TemplateBrowser } from '../templates/TemplateBrowser'
import { AddCountdownModal } from '../countdown/AddCountdownModal'
import { AddAlertModal } from '../alerts/AddAlertModal'
import { useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'


const SECTION_META: Record<NavSection, { icon: React.ElementType; title: string }> = {
    bible: { icon: BookOpen, title: 'Bible' },
    music: { icon: Music, title: 'Songs & Hymns' },
    media: { icon: Image, title: 'Media' },
    templates: { icon: Layout, title: 'Templates' },
    countdown: { icon: Clock, title: 'Countdown' },
    alerts: { icon: AlertCircle, title: 'Alerts' },
    library: { icon: Archive, title: 'Library' },
    schedule: { icon: Calendar, title: 'Schedule' },
    sermon: { icon: Mic, title: 'Sermon Listener' },
    settings: { icon: Settings, title: 'Settings' },
}

export function ContextPanel() {
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const contextPanelOpen = useAppStore((s) => s.contextPanelOpen)
    const contextPanelWidth = useAppStore((s) => s.contextPanelWidth)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const setContextPanelWidth = useAppStore((s) => s.setContextPanelWidth)
    const openModal = useAppStore((s) => s.openModal)

    const resizeRef = useRef<HTMLDivElement>(null)
    const isResizing = useRef(false)

    // Resize handler
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current) return
            const newWidth = window.innerWidth - e.clientX
            setContextPanelWidth(newWidth)
        }

        const handleMouseUp = () => {
            isResizing.current = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [setContextPanelWidth])

    const startResize = useCallback(() => {
        isResizing.current = true
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [])

    const handleClose = useCallback(() => {
        setActiveNavSection(null)
    }, [setActiveNavSection])



    const appendActiveSlide = useAppStore((s) => s.appendActiveSlide)
    const updateActiveSlide = useAppStore((s) => s.updateActiveSlide)
    const activeSchedule = useAppStore((s) => s.activeSchedule)
    const editingSlide = useAppStore((s) => s.editingSlide)

    // Handle template selection
    const handleTemplateSelect = async (template: TemplateItem) => {
        let templateSlide: Partial<Slide> | null = null
        if (typeof template.slideId === 'string') {
            try {
                templateSlide = JSON.parse(template.slideId)
            } catch { }
        } else if (typeof template.slideId === 'object' && template.slideId !== null) {
            templateSlide = template.slideId as Partial<Slide>
        }

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
    }

    // Handle countdown creation
    const handleCountdownCreate = (countdownData: CountdownData) => {
        const timeString = `${String(countdownData.hours).padStart(2, '0')}:${String(countdownData.minutes).padStart(2, '0')}:${String(countdownData.seconds).padStart(2, '0')}`
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
    }

    // Handle media selection
    const handleMediaSelect = (media: { id: string; url: string; name: string }) => {
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
    }

    // Sections that render inline in the context panel
    const INLINE_SECTIONS: NavSection[] = ['bible', 'music', 'media', 'templates', 'countdown', 'alerts', 'sermon']
    const showInline = activeNavSection && INLINE_SECTIONS.includes(activeNavSection)

    if (!contextPanelOpen || !showInline || !activeNavSection) return null

    const meta = SECTION_META[activeNavSection]
    const SectionIcon = meta.icon

    return (
        <motion.aside
            className="studio-context-panel bg-[var(--bg-secondary)] border-l border-[var(--border-subtle)] flex flex-col relative shrink-0"
            style={{ width: contextPanelWidth }}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
            {/* Resize handle */}
            <div
                ref={resizeRef}
                onMouseDown={startResize}
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent-teal)]/20 transition-colors z-10"
            />

            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)] flex-shrink-0 bg-[var(--bg-tertiary)]/50">
                <div className="flex items-center gap-2">
                    <SectionIcon className="w-4 h-4 text-[var(--accent-teal)]" />
                    <h3
                        className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]"
                    >
                        {meta.title}
                    </h3>
                </div>
                <button
                    onClick={handleClose}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeNavSection}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="h-full"
                    >
                        {activeNavSection === 'bible' && (
                            <div className="h-full">
                                <BibleList isInline onClose={handleClose} />
                            </div>
                        )}
                        {activeNavSection === 'music' && (
                            <MusicBrowser onClose={handleClose} />
                        )}
                        {activeNavSection === 'sermon' && (
                            <div className="h-full">
                                <SermonListenerPanel onHide={handleClose} />
                            </div>
                        )}
                        {activeNavSection === 'media' && (
                            <div className="h-full">
                                <MediaPicker
                                    isInline
                                    onSelect={handleMediaSelect}
                                />
                            </div>
                        )}
                        {activeNavSection === 'templates' && (
                            <div className="h-full">
                                <TemplateBrowser
                                    isInline
                                    onSelect={handleTemplateSelect}
                                />
                            </div>
                        )}
                        {activeNavSection === 'countdown' && (
                            <div className="h-full">
                                <AddCountdownModal
                                    isInline
                                    onAdd={handleCountdownCreate}
                                    editingSlide={editingSlide}
                                />
                            </div>
                        )}
                        {activeNavSection === 'alerts' && (
                            <div className="h-full">
                                <AddAlertModal
                                    isInline
                                    editingSlide={editingSlide}
                                />
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>
        </motion.aside>
    )
}

/**
 * Inline music browser with tabs for Hymns and Songs
 */
function MusicBrowser({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<'hymns' | 'songs'>('hymns')

    return (
        <div className="flex flex-col h-full">
            {/* Tabs */}
            <div className="flex border-b border-[var(--border-subtle)] px-2">
                <button
                    onClick={() => setTab('hymns')}
                    className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                        tab === 'hymns'
                            ? 'border-[var(--accent-teal)] text-[var(--accent-teal)]'
                            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                >
                    Hymns
                </button>
                <button
                    onClick={() => setTab('songs')}
                    className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                        tab === 'songs'
                            ? 'border-[var(--accent-teal)] text-[var(--accent-teal)]'
                            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                >
                    Songs
                </button>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-2">
                {tab === 'hymns' ? (
                    <HymnList isInline onClose={onClose} />
                ) : (
                    <SongList isInline onClose={onClose} />
                )}
            </div>
        </div>
    )
}

// Use React's useState but imported at module level

