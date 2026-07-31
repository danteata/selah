import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    X, BookOpen, BookA, Music, Image, Layout, Clock,
    AlertCircle, Archive, Calendar, Mic, Settings, Maximize2, Pin, Search, Zap, Plus, Edit, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSongs, useSong, useHymn, useSlideCreation } from '../../hooks'
import { useGoLive } from '../../hooks/useGoLive'
import { useResultNavigation } from '../../hooks/useResultNavigation'
import { buildMusicIndex, searchMusicIndex } from '../../lib/search/musicSearch'
import { isInlineNavSection, type NavSection } from '../../types/studio'
import type { Slide, ExternalVideo, Song, Hymn } from '../../types'
import type { TemplateItem } from '../../hooks/useTemplates'
import { resolveLocalUrl } from '../../hooks/useLocalBackground'
import { generateObjectId } from '../../hooks/useSlideCreation'

import { BibleList } from '../bible/BibleList'
import { DictionaryPanel } from '../dictionary/DictionaryPanel'
import { HymnList } from '../hymns/HymnList'
import { SongList } from '../songs/SongList'
import { AddSongModal } from '../songs/AddSongModal'
import { LiveSongNavigator } from '../songs/LiveSongNavigator'
import { SermonListenerPanel } from '../sermon-listener/SermonListenerPanel'
import { MediaPicker, type MediaItem } from '../media/MediaPicker'
import { TemplateBrowser } from '../templates/TemplateBrowser'
import { TemplateSelector } from '../templates/TemplateSelector'
import { AddCountdownModal } from '../countdown/AddCountdownModal'
import { AddAlertModal } from '../alerts/AddAlertModal'


const SECTION_META: Record<NavSection, { icon: React.ElementType; title: string }> = {
    bible: { icon: BookOpen, title: 'Bible' },
    dictionary: { icon: BookA, title: 'Dictionary' },
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

    if (!contextPanelOpen || !isInlineNavSection(activeNavSection) || !activeNavSection) return null

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
            <ContextSectionContent section={activeNavSection} onClose={handleClose} />
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

// The content for a nav section (Bible, Songs & Hymns, Media, …). Shared so it
// can render both in the sidebar (ContextPanel) and, when the sermon listener
// displaces it from the sidebar, in the center split (LiveOutput).
export function ContextSectionContent({
    section,
    onClose = () => {},
}: {
    section: NavSection
    onClose?: () => void
}) {
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

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={section}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full"
            >
                {section === 'bible' && (
                    <div className="h-full">
                        <BibleList isInline onClose={onClose} />
                    </div>
                )}
                {section === 'dictionary' && (
                    <div className="h-full">
                        <DictionaryPanel isInline onClose={onClose} />
                    </div>
                )}
                {section === 'music' && (
                    <MusicBrowser onClose={onClose} />
                )}
                {section === 'sermon' && (
                    <div className="h-full">
                        <SermonListenerPanel onHide={onClose} />
                    </div>
                )}
                {section === 'media' && (
                    <div className="h-full">
                        <MediaPicker isInline onSelect={handleMediaSelect} />
                    </div>
                )}
                {section === 'templates' && (
                    <div className="h-full">
                        <TemplateBrowser isInline onSelect={handleTemplateSelect} />
                    </div>
                )}
                {section === 'countdown' && (
                    <div className="h-full">
                        <AddCountdownModal isInline onAdd={handleCountdownCreate} editingSlide={editingSlide} />
                    </div>
                )}
                {section === 'alerts' && (
                    <div className="h-full">
                        <AddAlertModal isInline editingSlide={editingSlide} />
                    </div>
                )}
            </motion.div>
        </AnimatePresence>
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

// Subtitle under a result title — the author when it's meaningful, otherwise a
// short lyrics preview for songs (many have "Unknown" authors), so the second
// line helps you decide to Add / go Live instead of just reading "Unknown".
function hitSubtitle(hit: UnifiedHit): string {
    if (hit.kind === 'song' && hit.song) {
        const artist = (hit.song.artist || '').trim()
        if (artist && artist.toLowerCase() !== 'unknown') return artist
        const preview = (hit.song.lyrics || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        return preview || hit.subtitle
    }
    return hit.subtitle
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

    const { songs, deleteSong } = useSongs()
    const { getSong } = useSong()
    const { getAllHymns } = useHymn()
    const { createSongSlides, createHymnSlides } = useSlideCreation()
    const [hymns, setHymns] = useState<Hymn[]>([])
    // Song to edit / delete straight from a search result — the browse list
    // (which normally carries these actions) is hidden while searching, so
    // without these you'd have to clear the query and scroll thousands of songs.
    // The unified search built slides with no template at all, so a lower-third
    // (or any) template could not be applied to anything found here.
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)
    const [songToEdit, setSongToEdit] = useState<Song | null>(null)
    const [songToDelete, setSongToDelete] = useState<Song | null>(null)
    const [showAddSong, setShowAddSong] = useState(false)
    const searchInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        let alive = true
        void getAllHymns().then((all) => { if (alive) setHymns(all) })
        return () => { alive = false }
    }, [getAllHymns])

    // Focus the search box as soon as the music panel opens, so you can type
    // immediately without an extra click — matching the Bible panel.
    useEffect(() => {
        searchInputRef.current?.focus()
    }, [])

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

    const { canGoLive, addToQueue, addAndGoLive } = useGoLive()
    // No alternate-output button: everything here is a song or a hymn, which are
    // groups of slides, and that output holds one. See the note in SongList.

    // Primary action on a result is "go live" (append + verse 1 live); the
    // secondary Add button just queues it. Going live closes the panel; Add
    // keeps it open so several items can be queued in a row.
    const handleSelect = useCallback(async (hit: UnifiedHit, goLive: boolean) => {
        let slides: Slide[] = []
        if (hit.kind === 'song' && hit.song) {
            const full = await getSong(hit.song)
            slides = createSongSlides((full ?? hit.song) as Song, { template: selectedTemplate })
        } else if (hit.kind === 'hymn' && hit.hymn) {
            slides = createHymnSlides(hit.hymn, { template: selectedTemplate })
        }
        if (slides.length === 0) return
        // Keep the panel open on both Add and Live — the LiveSongNavigator
        // lives here, so staying open lets the operator immediately navigate
        // the verses of the song they just put live (and keep searching).
        if (goLive) {
            addAndGoLive(slides)
        } else {
            addToQueue(slides)
        }
    }, [getSong, createSongSlides, createHymnSlides, selectedTemplate, addAndGoLive, addToQueue])

    // Keyboard contract shared with the Bible and dictionary panels: the top
    // ranked hit is highlighted as results arrive, Enter sends it live and
    // Shift+Enter queues it — no reach for the mouse mid-service.
    const { focusedIndex, setFocusedIndex, handleKeyDown, listRef } = useResultNavigation<HTMLDivElement>({
        count: results.length,
        resetKey: `${query}:${results.length}`,
        onActivate: (index, { queue }) => {
            const hit = results[index]
            if (hit) void handleSelect(hit, !queue)
        },
    })

    return (
        <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
            {/* When a song is live, surface its verses for quick navigation. */}
            <LiveSongNavigator />

            {/* Unified search across songs + hymns, with a compact New-song
                action on the same line to save vertical space. */}
            <div className="p-2 border-b border-[var(--border-subtle)] flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] w-4 h-4" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search songs & hymns…"
                        autoFocus
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
                <button
                    onClick={() => setShowAddSong(true)}
                    title="New song"
                    aria-label="New song"
                    className="flex-shrink-0 flex items-center justify-center w-9 h-9 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>

            <div className="px-2 pt-2">
                <TemplateSelector
                    slideType="song"
                    selectedTemplate={selectedTemplate}
                    onSelect={setSelectedTemplate}
                />
            </div>

            {results.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-1.5 text-[10px] text-[var(--text-muted)]">
                    <span>Enter = Live</span>
                    <span>Shift+Enter = Add to queue</span>
                    <span>↑↓ Navigate</span>
                </div>
            )}

            {query.trim() ? (
                /* Unified results — interleaved, ranked, with a type badge. */
                <div className="flex-1 overflow-y-auto p-2" ref={listRef}>
                    {results.length === 0 ? (
                        <div className="p-8 text-center text-[var(--text-muted)] text-sm">
                            No songs or hymns match “{query.trim()}”
                        </div>
                    ) : (
                        <div
                            className="grid gap-1"
                            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
                        >
                            {results.map((hit, index) => (
                                <div
                                    key={hit.id}
                                    data-result-index={index}
                                    onMouseEnter={() => setFocusedIndex(index)}
                                    className={`w-full flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors group ${
                                        focusedIndex === index
                                            ? 'bg-[var(--accent-teal)]/8 ring-1 ring-inset ring-[var(--accent-teal)]/20'
                                            : 'hover:bg-[var(--bg-tertiary)]'
                                    }`}
                                >
                                    {/* Primary: title area sends it live in one click. */}
                                    <button
                                        onClick={() => void handleSelect(hit, true)}
                                        className="min-w-0 flex-1 flex items-center gap-2 text-left"
                                        title="Send to live output"
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
                                            {hitSubtitle(hit) && (
                                                <span className="block text-xs text-[var(--text-muted)] truncate">{hitSubtitle(hit)}</span>
                                            )}
                                        </span>
                                    </button>
                                    {/* Edit — songs only; opens the editor so you
                                        can fix a song found via search without
                                        clearing the query to reach the browse list. */}
                                    {hit.kind === 'song' && hit.song && (
                                        <>
                                            <button
                                                onClick={() => setSongToEdit(hit.song!)}
                                                className="flex-shrink-0 p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] hidden group-hover:flex items-center justify-center"
                                                title="Edit song"
                                            >
                                                <Edit className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => setSongToDelete(hit.song!)}
                                                className="flex-shrink-0 p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10 hidden group-hover:flex items-center justify-center"
                                                title="Delete song"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </>
                                    )}
                                    {/* Secondary: queue without projecting. */}
                                    <button
                                        onClick={() => void handleSelect(hit, false)}
                                        className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10 transition-colors"
                                        title="Add to queue"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Add
                                    </button>
                                    {canGoLive && (
                                        <button
                                            onClick={() => void handleSelect(hit, true)}
                                            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
                                            title="Send to live output"
                                        >
                                            <Zap className="w-3.5 h-3.5" />
                                            Live
                                        </button>
                                    )}
                                </div>
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

            {/* Editor for a song opened from the search results, or a new song
                started from the + button. */}
            <AddSongModal
                isOpen={songToEdit !== null || showAddSong}
                song={songToEdit}
                onClose={() => { setSongToEdit(null); setShowAddSong(false) }}
                onSuccess={() => { setSongToEdit(null); setShowAddSong(false) }}
            />

            {/* Delete confirmation for a song removed from the search results. */}
            {songToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-sm bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-xl shadow-2xl p-6">
                        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Delete Song?</h3>
                        <p className="text-[var(--text-secondary)] mb-4">
                            Delete &ldquo;{songToDelete.title}&rdquo;? This can&rsquo;t be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setSongToDelete(null)}
                                className="px-4 py-2 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    await deleteSong(songToDelete._id || songToDelete.id)
                                    setSongToDelete(null)
                                }}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
