import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    X, BookOpen, Music, Image, Layout, Clock,
    AlertCircle, Archive, Calendar, Mic, Settings, Maximize2, Pin, Search
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSongs, useSong, useHymn, useSlideCreation } from '../../hooks'
import { buildMusicIndex, searchMusicIndex } from '../../lib/search/musicSearch'
import type { NavSection } from '../../types/studio'
import type { Slide, ExternalVideo, Song, Hymn } from '../../types'
import type { TemplateItem } from '../../hooks/useTemplates'
import { resolveLocalUrl } from '../../hooks/useLocalBackground'
import { generateObjectId } from '../../hooks/useSlideCreation'

import { BibleList } from '../bible/BibleList'
import { HymnList } from '../hymns/HymnList'
import { SongList } from '../songs/SongList'
import { LiveSongNavigator } from '../songs/LiveSongNavigator'
import { SermonListenerPanel } from '../sermon-listener/SermonListenerPanel'
import { MediaPicker, type MediaItem } from '../media/MediaPicker'
import { TemplateBrowser } from '../templates/TemplateBrowser'
import { AddCountdownModal } from '../countdown/AddCountdownModal'
import { AddAlertModal } from '../alerts/AddAlertModal'


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
    const panelMode = useAppStore((s) => s.panelMode)
    const panelPosition = useAppStore((s) => s.panelPosition)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const setContextPanelWidth = useAppStore((s) => s.setContextPanelWidth)
    const setPanelMode = useAppStore((s) => s.setPanelMode)
    const setPanelPosition = useAppStore((s) => s.setPanelPosition)

    const resizeRef = useRef<HTMLDivElement>(null)
    const isResizing = useRef(false)
    const isDragging = useRef(false)
    const dragOffset = useRef({ x: 0, y: 0 })

    // Resize handler (outer panel — docked mode left edge)
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

    // Floating panel drag handler
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return
            const newX = e.clientX - dragOffset.current.x
            const newY = e.clientY - dragOffset.current.y
            const clampedX = Math.max(0, Math.min(window.innerWidth - 200, newX))
            const clampedY = Math.max(0, Math.min(window.innerHeight - 100, newY))
            setPanelPosition({ x: clampedX, y: clampedY })
        }

        const handleMouseUp = () => {
            isDragging.current = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [setPanelPosition])

    const startResize = useCallback(() => {
        isResizing.current = true
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [])

    const startDrag = useCallback((e: React.MouseEvent) => {
        if (panelMode !== 'floating') return
        isDragging.current = true
        dragOffset.current = {
            x: e.clientX - panelPosition.x,
            y: e.clientY - panelPosition.y
        }
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
    }, [panelMode, panelPosition])

    const handleClose = useCallback(() => {
        setActiveNavSection(null)
    }, [setActiveNavSection])

    const handleDetach = useCallback(() => {
        setPanelMode('floating')
        setPanelPosition({ x: window.innerWidth - contextPanelWidth - 80, y: 60 })
    }, [setPanelMode, setPanelPosition, contextPanelWidth])

    const handlePin = useCallback(() => {
        setPanelMode('docked')
    }, [setPanelMode])

    const appendActiveSlide = useAppStore((s) => s.appendActiveSlide)
    const updateActiveSlide = useAppStore((s) => s.updateActiveSlide)
    const activeSchedule = useAppStore((s) => s.activeSchedule)
    const editingSlide = useAppStore((s) => s.editingSlide)

    const handleTemplateSelect = async (template: TemplateItem) => {
        let templateSlide: Partial<Slide> | null = null
        if (typeof template.slideId === 'string') {
            try {
                templateSlide = JSON.parse(template.slideId)
            } catch { }
        } else if (typeof template.slideId === 'object' && template.slideId !== null) {
            templateSlide = template.slideId as Partial<Slide>
        }

        const rawBg = templateSlide?.background || template.thumbnail || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
        const resolvedBg = resolveLocalUrl(rawBg, templateSlide?.localFilePath)

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
            background: resolvedBg,
            backgroundType: templateSlide?.backgroundType || 'gradient',
            backgroundStorageId: templateSlide?.backgroundStorageId || template.backgroundStorageId || null,
            localFilePath: templateSlide?.localFilePath || undefined,
        }
        appendActiveSlide(slide)
    }

    const handleCountdownCreate = (countdownData: { id: string; title: string; hours: number; minutes: number; seconds: number; background: string; backgroundType: string; backgroundStorageId?: string | null; localFilePath?: string }) => {
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
            localFilePath: countdownData.localFilePath,
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

    const handleMediaSelect = (media: MediaItem) => {
        if (media.isExternal && media.externalType) {
            const externalVideo: ExternalVideo = { url: media.url, type: media.externalType, name: media.name }
            const slide: Slide = {
                id: generateObjectId(),
                index: 0,
                name: media.name,
                type: 'media',
                layout: 'empty',
                contents: [],
                userId: '',
                churchId: '',
                scheduleId: activeSchedule?._id || '',
                backgroundType: 'external',
                data: externalVideo,
                slideStyle: { isMediaPlaying: true, isMediaMuted: false, backgroundFillType: 'fit' },
            }
            appendActiveSlide(slide)
            return
        }

        const slide: Slide = {
            id: generateObjectId(),
            index: 0,
            name: media.name,
            type: 'media',
            layout: 'empty',
            contents: [],
            userId: '',
            churchId: '',
            scheduleId: activeSchedule?._id || '',
            background: media.url,
            backgroundType: media.type,
            backgroundStorageId: media.storageId || null,
            localFilePath: media.localFilePath,
            localMediaId: media.localMediaId,
            slideStyle: media.type === 'video'
                ? { isMediaPlaying: true, isMediaMuted: false, repeatMedia: false, backgroundFillType: 'fit' }
                : { backgroundFillType: 'fit' },
        }
        appendActiveSlide(slide)
    }

    const INLINE_SECTIONS: NavSection[] = ['bible', 'music', 'media', 'templates', 'countdown', 'alerts', 'sermon']
    const showInline = activeNavSection && INLINE_SECTIONS.includes(activeNavSection)

    if (!contextPanelOpen || !showInline || !activeNavSection) return null

    const meta = SECTION_META[activeNavSection]
    const SectionIcon = meta.icon

    const panelHeader = (
        <div
            className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)] flex-shrink-0 bg-[var(--bg-tertiary)]/25"
            onMouseDown={startDrag}
            style={panelMode === 'floating' ? { cursor: 'grab' } : undefined}
        >
            <div className="flex items-center gap-2">
                <SectionIcon className="w-4 h-4 text-[var(--accent-teal)]" />
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                    {meta.title}
                </h3>
            </div>
            <div className="flex items-center gap-1">
                {panelMode === 'docked' && (
                    <button
                        onClick={handleDetach}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                        title="Pop out panel"
                    >
                        <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                )}
                {panelMode === 'floating' && (
                    <button
                        onClick={handlePin}
                        className="p-1 text-[var(--accent-teal)] hover:text-[var(--accent-teal)] rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                        title="Pin panel back to dock"
                    >
                        <Pin className="w-3.5 h-3.5" />
                    </button>
                )}
                <button
                    onClick={handleClose}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    )

    const panelContent = (
        <div className="flex-1 min-h-0 overflow-hidden">
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
    )

    if (panelMode === 'floating') {
        return (
            <motion.aside
                className="studio-context-panel--floating bg-[var(--bg-secondary)] border border-[var(--border-default)] flex flex-col rounded-lg shadow-2xl overflow-hidden"
                style={{
                    position: 'fixed',
                    left: panelPosition.x,
                    top: panelPosition.y,
                    width: contextPanelWidth,
                    height: '70vh',
                    zIndex: 50,
                }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
                {panelHeader}
                {panelContent}
            </motion.aside>
        )
    }

    return (
        <motion.aside
            className="studio-context-panel bg-[var(--bg-secondary)] border-l border-[var(--border-subtle)] flex flex-col relative shrink-0"
            style={{ width: contextPanelWidth }}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
            <div
                ref={resizeRef}
                onMouseDown={startResize}
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent-teal)]/20 transition-colors z-10"
            />
            {panelHeader}
            {panelContent}
        </motion.aside>
    )
}

interface UnifiedHit {
    id: string
    kind: 'song' | 'hymn'
    title: string
    subtitle: string
    song?: Song
    hymn?: Hymn
}

function MusicBrowser({ onClose }: { onClose: () => void }) {
    // Songs first and selected by default — they're searched far more often
    // than hymns, and operators kept forgetting to switch to the Songs tab
    // when it sat in second position.
    const [tab, setTab] = useState<'songs' | 'hymns'>('songs')
    // One search box drives a ranked, interleaved list across BOTH songs and
    // hymns, so operators don't have to be on the right tab to find something.
    // Empty query falls back to the per-tab browse lists below.
    const [query, setQuery] = useState('')

    const { songs } = useSongs()
    const { getSong } = useSong()
    const { getAllHymns } = useHymn()
    const { createSongSlides, createHymnSlides } = useSlideCreation()
    const appendActiveSlides = useAppStore((s) => s.appendActiveSlides)
    const [hymns, setHymns] = useState<Hymn[]>([])

    useEffect(() => {
        let alive = true
        void getAllHymns().then((all) => { if (alive) setHymns(all) })
        return () => { alive = false }
    }, [getAllHymns])

    // Combined BM25 index over songs + hymns (rebuilt only when either list
    // changes), plus an id → source map to resolve a hit back to its record.
    const { index, byId } = useMemo(() => {
        const map = new Map<string, UnifiedHit>()
        const items = [
            ...songs.map((s) => {
                const id = `song:${s._id || s.id}`
                map.set(id, { id, kind: 'song', title: s.title, subtitle: s.artist, song: s })
                return { id, title: s.title, subtitle: s.artist, body: s.lyrics || '' }
            }),
            ...hymns.map((h) => {
                const id = `hymn:${h.number}`
                map.set(id, { id, kind: 'hymn', title: h.title, subtitle: `Hymn ${h.number}`, hymn: h })
                return {
                    id,
                    title: h.title,
                    subtitle: `${h.author ?? ''} ${h.number}`.trim(),
                    body: `${h.chorus ?? ''}\n${(h.verses ?? []).join('\n')}`,
                }
            }),
        ]
        return { index: buildMusicIndex(items), byId: map }
    }, [songs, hymns])

    const results = useMemo(() => {
        const q = query.trim()
        if (!q) return []
        return searchMusicIndex(index, q, 40)
            .map((r) => byId.get(r.item.id))
            .filter((h): h is UnifiedHit => !!h)
    }, [index, byId, query])

    const handleSelect = useCallback(async (hit: UnifiedHit) => {
        if (hit.kind === 'song' && hit.song) {
            const full = await getSong(hit.song)
            const slides = createSongSlides((full ?? hit.song) as Song)
            if (slides.length > 0) appendActiveSlides(slides)
        } else if (hit.kind === 'hymn' && hit.hymn) {
            const slides = createHymnSlides(hit.hymn)
            if (slides.length > 0) appendActiveSlides(slides)
        }
        onClose()
    }, [getSong, createSongSlides, createHymnSlides, appendActiveSlides, onClose])

    return (
        <div className="flex flex-col h-full">
            {/* When a song is live, surface its verses for quick navigation. */}
            <LiveSongNavigator />

            {/* Unified search across songs + hymns */}
            <div className="p-2 border-b border-[var(--border-subtle)]">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] w-4 h-4" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search songs & hymns…"
                        className="w-full pl-9 pr-8 py-2 text-sm border border-[var(--border-default)] rounded-lg outline-none bg-[var(--bg-tertiary)] focus:ring-2 focus:ring-[var(--accent-teal)]/30 transition-all"
                    />
                    {query && (
                        <button
                            onClick={() => setQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            aria-label="Clear search"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {query.trim() ? (
                /* Unified results — interleaved, ranked, with a type badge. */
                <div className="flex-1 overflow-y-auto p-2">
                    {results.length === 0 ? (
                        <div className="p-8 text-center text-[var(--text-muted)] text-sm">
                            No songs or hymns match “{query.trim()}”
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {results.map((hit) => (
                                <button
                                    key={hit.id}
                                    onClick={() => handleSelect(hit)}
                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-[var(--bg-tertiary)] transition-colors"
                                >
                                    <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                        hit.kind === 'song'
                                            ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                            : 'bg-amber-500/10 text-amber-500'
                                    }`}>
                                        {hit.kind === 'song' ? 'Song' : 'Hymn'}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm text-[var(--text-primary)] truncate">{hit.title}</span>
                                        {hit.subtitle && (
                                            <span className="block text-xs text-[var(--text-muted)] truncate">{hit.subtitle}</span>
                                        )}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                /* Browse mode — tabs, each list's own search box hidden. */
                <>
                    <div className="flex border-b border-[var(--border-subtle)] px-2">
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
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                        {tab === 'songs' ? (
                            <SongList isInline hideSearch onClose={onClose} />
                        ) : (
                            <HymnList isInline hideSearch onClose={onClose} />
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
