import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Trash2, Copy, LayoutGrid, BookOpen, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, CheckSquare, Square, MinusSquare, Rows3, Plus, GripVertical, AlertTriangle, Music, AlignJustify, Clock, FileText, ListX, Zap, type LucideIcon } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSlideCreation, useLibrary, useScripture, useLiveSession, useVerseNavigationShortcuts } from '../../hooks'
import type { Slide, Scripture, BibleVerse } from '../../types'
import { bibleBooks } from '../../types'
import { SlideCard } from '../slides/SlideCard'
import { EmptyState } from '../utils/EmptyState'
import { BibleVersionSelect } from '../bible/BibleVersionSelect'
import { SongVerseBrowser } from '../slides/SongVerseBrowser'
import { groupQueueItems, type SongGroupItem } from './groupQueueItems'

export function PreviewContent() {
    const [activeSlide, setActiveSlide] = useState<Slide | undefined>()
    const [relatedVerses, setRelatedVerses] = useState<{ prev: BibleVerse[]; next: BibleVerse[] }>({ prev: [], next: [] })
    const [currentVerses, setCurrentVerses] = useState<BibleVerse[]>([])
    const [loadingVerses, setLoadingVerses] = useState(false)

    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const removeActiveSlide = useAppStore((state) => state.removeActiveSlide)
    const reorderActiveSlides = useAppStore((state) => state.reorderActiveSlides)
    const setActiveSlides = useAppStore((state) => state.setActiveSlides)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const bulkSelectMode = useAppStore((state) => state.bulkSelectMode)
    const selectedSlideIds = useAppStore((state) => state.selectedSlideIds)
    const toggleBulkSelectMode = useAppStore((state) => state.toggleBulkSelectMode)
    const toggleSlideSelection = useAppStore((state) => state.toggleSlideSelection)
    const clearSelectedSlides = useAppStore((state) => state.clearSelectedSlides)
    const setSelectedSlideIds = useAppStore((state) => state.setSelectedSlideIds)
    const setEditingSlide = useAppStore((state) => state.setEditingSlide)
    const openModal = useAppStore((state) => state.openModal)

    const { createTextSlide, duplicateSlide } = useSlideCreation()
    const { addToLibrary, isInLibrary } = useLibrary()
    const { fetchScripture } = useScripture()
    const {
        isOperator,
        isContributor,
        isConnected,
        isOpen,
        isStrict,
        addToQueue,
        setLiveSlide: setSharedLiveSlide,
        sessionScheduleId,
    } = useLiveSession()
    const slidesGridRef = useRef<HTMLDivElement>(null)
    const activeSlideRef = useRef<HTMLDivElement>(null)
    const liveSlideRef = useRef<HTMLDivElement>(null)
    const userClickedSlideRef = useRef(false)
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
    const [isDraggingIndex, setIsDraggingIndex] = useState<number | null>(null)
    const dragStateRef = useRef<number | null>(null)
    // When a whole song group is being dragged, its verse slide ids (so the
    // drop moves the entire block, not a single slide).
    const dragGroupIdsRef = useRef<string[] | null>(null)
    const [showClearConfirm, setShowClearConfirm] = useState(false)
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

    // Queue density: 'comfortable' = full slide previews (one big card per row),
    // 'compact' = a scannable one-line list so an operator can see and jump
    // across a long queue (dozens of slides) at a glance. Persisted so the
    // preference sticks across sessions.
    const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
        if (typeof window === 'undefined') return 'comfortable'
        return localStorage.getItem('selah-queue-density') === 'compact' ? 'compact' : 'comfortable'
    })
    useEffect(() => {
        localStorage.setItem('selah-queue-density', density)
    }, [density])

    // Auto-scroll to active slide ONLY when user explicitly clicked it.
    // Voice commands and auto-advance should not cause jumpy scrolling.
    useEffect(() => {
        if (userClickedSlideRef.current && activeSlide && activeSlideRef.current) {
            activeSlideRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            userClickedSlideRef.current = false
        }
    }, [activeSlide?.id])

    // Keep the LIVE slide centered in the queue so the operator always sees it
    // and its neighbouring queued slides. This fires on every live change —
    // including auto-advance and the song tracker — sliding to reposition on
    // the newly-activated slide. It deliberately runs only WHEN live changes,
    // so between activations a user who scrolls away to look around is left
    // alone until the next slide goes live.
    useEffect(() => {
        if (!liveSlideId) return
        const node = liveSlideRef.current
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [liveSlideId])

    // Derive slides from store - single source of truth
    // Show slides that match the active schedule, or slides without a schedule if no active schedule
    const slides = useMemo(() => {
        const effectiveScheduleId = sessionScheduleId || activeSchedule?._id
        if (effectiveScheduleId) {
            return activeSlides.filter(
                (slide) => slide.scheduleId === effectiveScheduleId || slide.scheduleId === ''
            )
        }
        // If no active schedule, show all slides without a scheduleId
        return activeSlides.filter((slide) => !slide.scheduleId || slide.scheduleId === '')
    }, [activeSlides, activeSchedule?._id, sessionScheduleId])

    // Collapse a song's verse slides (createSongSlides materializes one per
    // verse, up front, so the tracker/auto-detect features have somewhere to
    // point setLiveSlide at) into a single row in the queue — a song with a
    // dozen verses otherwise buries every other slide under a wall of
    // "Verse 1", "Verse 2", ... entries. Only groups CONSECUTIVE same-songId
    // runs (how they're created) into one row; a lone verse (song with just
    // one section, or one manually separated from its siblings) renders as a
    // normal single row, matching prior behavior exactly.
    const queueItems = useMemo(() => groupQueueItems(slides), [slides])

    const [expandedSongGroups, setExpandedSongGroups] = useState<Set<string>>(new Set())
    const toggleSongGroupExpanded = useCallback((key: string) => {
        setExpandedSongGroups((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }, [])
    const [browsingSongGroup, setBrowsingSongGroup] = useState<SongGroupItem | null>(null)

    const canGoLive = !isConnected || isOperator || (isContributor && isOpen)
    const canQueueSlide = isConnected && isContributor && !isStrict

    // Enter promotes the previewed (active) slide to live — the keyboard
    // counterpart to the always-visible Live button. Ignored while typing or
    // when a button/link is focused (so it doesn't double-fire with a click).
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter') return
            const el = document.activeElement as HTMLElement | null
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON' || el.tagName === 'A' || el.isContentEditable)) return
            if (!activeSlide || !canGoLive || liveSlideId === activeSlide.id) return
            e.preventDefault()
            void setSharedLiveSlide(activeSlide.id)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [activeSlide, canGoLive, liveSlideId, setSharedLiveSlide])

    const handleDeleteSlide = useCallback((slideId: string) => {
        const slide = slides.find(s => s.id === slideId)
        if (slide) {
            removeActiveSlide(slide)
            if (activeSlide?.id === slideId) {
                setActiveSlide(undefined)
            }
        }
    }, [slides, activeSlide, removeActiveSlide])

    const handleCreateNewSlide = useCallback(() => {
        const newSlide = createTextSlide()
        if (newSlide) {
            setActiveSlide(newSlide)
            appendActiveSlide(newSlide)
            // Open the editor modal to allow editing the new slide
            setEditingSlide(newSlide)
            openModal('editor')
        }
    }, [createTextSlide, appendActiveSlide, setEditingSlide, openModal])

    const handleDuplicateSlide = useCallback((slide: Slide) => {
        const newSlide = duplicateSlide(slide)
        if (newSlide) {
            setActiveSlide(newSlide)
        }
    }, [duplicateSlide])

    const handleSlideClick = useCallback((slide: Slide) => {
        if (bulkSelectMode) {
            toggleSlideSelection(slide.id)
        } else {
            userClickedSlideRef.current = true
            setActiveSlide(slide)
        }
    }, [bulkSelectMode, toggleSlideSelection])

    const handleDeleteSelected = useCallback(() => {
        if (selectedSlideIds.length === 0) return
        setShowBulkDeleteConfirm(true)
    }, [selectedSlideIds])

    const confirmBulkDelete = useCallback(() => {
        selectedSlideIds.forEach(id => {
            const slide = slides.find(s => s.id === id)
            if (slide) {
                removeActiveSlide(slide)
            }
        })
        clearSelectedSlides()
        setShowBulkDeleteConfirm(false)
    }, [selectedSlideIds, slides, removeActiveSlide, clearSelectedSlides])

    const cancelBulkDelete = useCallback(() => {
        setShowBulkDeleteConfirm(false)
    }, [])

    const handleClearQueue = useCallback(() => {
        if (slides.length === 0) return
        setShowClearConfirm(true)
    }, [slides])

    const confirmClearQueue = useCallback(() => {
        const slideIdsToClear = new Set(slides.map((slide) => slide.id))
        const remainingSlides = activeSlides.filter((slide) => !slideIdsToClear.has(slide.id))

        setActiveSlides(remainingSlides)
        if (liveSlideId && slideIdsToClear.has(liveSlideId)) {
            setLiveSlide('')
        }
        clearSelectedSlides()
        setActiveSlide(undefined)
        setShowClearConfirm(false)
    }, [slides, activeSlides, setActiveSlides, liveSlideId, setLiveSlide, clearSelectedSlides])

    const cancelClearQueue = useCallback(() => {
        setShowClearConfirm(false)
    }, [])

    // Check if all slides are selected
    const allSelected = slides.length > 0 && selectedSlideIds.length === slides.length
    const someSelected = selectedSlideIds.length > 0 && selectedSlideIds.length < slides.length

    // Handle select all / deselect all
    const handleSelectAll = useCallback(() => {
        if (allSelected) {
            // Deselect all
            setSelectedSlideIds([])
        } else {
            // Select all slides
            setSelectedSlideIds(slides.map(slide => slide.id))
        }
    }, [allSelected, slides, setSelectedSlideIds])

    // A collapsed song group stands in for a run of per-verse slides, so
    // deleting it removes every verse in one go — the queue treats it like a
    // single row (matching the single-slide delete affordance).
    const handleDeleteSongGroup = useCallback((item: SongGroupItem) => {
        const groupIds = new Set(item.verses.map((v) => v.slide.id))
        item.verses.forEach(({ slide }) => removeActiveSlide(slide))
        if (activeSlide && groupIds.has(activeSlide.id)) {
            setActiveSlide(undefined)
        }
    }, [removeActiveSlide, activeSlide])

    // Whether every verse of a group is currently selected (bulk mode).
    const isSongGroupSelected = useCallback((item: SongGroupItem) =>
        item.verses.length > 0 && item.verses.every((v) => selectedSlideIds.includes(v.slide.id)),
        [selectedSlideIds])

    // Toggle selection for a whole song group — select all its verses, or, if
    // they're already all selected, deselect them.
    const handleToggleSongGroupSelection = useCallback((item: SongGroupItem) => {
        const groupIds = item.verses.map((v) => v.slide.id)
        const allSelectedInGroup = groupIds.every((id) => selectedSlideIds.includes(id))
        if (allSelectedInGroup) {
            setSelectedSlideIds(selectedSlideIds.filter((id) => !groupIds.includes(id)))
        } else {
            setSelectedSlideIds([...new Set([...selectedSlideIds, ...groupIds])])
        }
    }, [selectedSlideIds, setSelectedSlideIds])

    const handleEditSlide = useCallback((slide: Slide) => {
        setEditingSlide(slide)
        // Open the appropriate editor based on slide type and layout
        if (slide.layout === 'lower-third') {
            openModal('lowerThirdEditor')
        } else if (slide.type === 'countdown') {
            openModal('countdownModal')
        } else if (slide.type === 'alert') {
            openModal('alertModal')
        } else {
            openModal('editor')
        }
    }, [setEditingSlide, openModal])

    const handleSaveToLibrary = useCallback((slide: Slide) => {
        addToLibrary(slide)
    }, [addToLibrary])

    // Parse scripture reference from bible slide
    const scriptureRef = useMemo(() => {
        if (!activeSlide || activeSlide.type !== 'bible') return null

        const data = activeSlide.data as Scripture | undefined
        if (!data) return null

        // Parse labelShortFormat (e.g., "43:3:16-18" for John 3:16-18)
        const parts = data.labelShortFormat?.split(':')
        if (!parts || parts.length < 3) return null

        const bookIndex = parseInt(parts[0])
        const chapter = parseInt(parts[1])
        const versePart = parts[2]

        let startVerse: number
        let endVerse: number

        if (versePart.includes('-')) {
            const [start, end] = versePart.split('-')
            startVerse = parseInt(start)
            endVerse = parseInt(end)
        } else {
            startVerse = parseInt(versePart)
            endVerse = startVerse
        }

        return {
            bookIndex,
            bookName: bibleBooks[bookIndex - 1] || '',
            chapter,
            startVerse,
            endVerse,
            version: data.version || 'KJV',
        }
    }, [activeSlide])

    // Fetch related verses when scripture reference changes
    useEffect(() => {
        if (!scriptureRef) {
            setRelatedVerses({ prev: [], next: [] })
            setCurrentVerses([])
            return
        }

        const fetchRelatedVerses = async () => {
            setLoadingVerses(true)
            const { bookIndex, chapter, startVerse, endVerse, version } = scriptureRef

            // Fetch current verses
            const currentLabel = `${bookIndex}:${chapter}:${startVerse}${endVerse !== startVerse ? `-${endVerse}` : ''}`
            const currentResult = await fetchScripture(currentLabel, version)
            if (currentResult && Array.isArray(currentResult.content)) {
                setCurrentVerses(currentResult.content as BibleVerse[])
            }

            // Fetch previous verses (5 before)
            const prevStart = Math.max(1, startVerse - 5)
            if (prevStart < startVerse) {
                const prevLabel = `${bookIndex}:${chapter}:${prevStart}-${startVerse - 1}`
                const prevResult = await fetchScripture(prevLabel, version)
                if (prevResult && Array.isArray(prevResult.content)) {
                    setRelatedVerses(prev => ({ ...prev, prev: prevResult.content as BibleVerse[] }))
                }
            } else {
                setRelatedVerses(prev => ({ ...prev, prev: [] }))
            }

            // Fetch next verses (5 after)
            const nextLabel = `${bookIndex}:${chapter}:${endVerse + 1}-${endVerse + 5}`
            const nextResult = await fetchScripture(nextLabel, version)
            if (nextResult && Array.isArray(nextResult.content)) {
                setRelatedVerses(prev => ({ ...prev, next: nextResult.content as BibleVerse[] }))
            } else {
                setRelatedVerses(prev => ({ ...prev, next: [] }))
            }

            setLoadingVerses(false)
        }

        fetchRelatedVerses()
    }, [scriptureRef, fetchScripture])

    // Handle verse selection for bible slides
    const handleVerseSelect = useCallback(async (verseNum: number) => {
        if (!scriptureRef || !activeSlide) return

        const label = `${scriptureRef.bookIndex}:${scriptureRef.chapter}:${verseNum}`
        const result = await fetchScripture(label, scriptureRef.version)
        if (result && Array.isArray(result.content)) {
            const verse = result.content[0] as BibleVerse
            const updatedSlide: Slide = {
                ...activeSlide,
                name: `${scriptureRef.bookName} ${scriptureRef.chapter}:${verseNum}`,
                data: {
                    label: `${scriptureRef.bookName} ${scriptureRef.chapter}:${verseNum}`,
                    labelShortFormat: `${scriptureRef.bookIndex}:${scriptureRef.chapter}:${verseNum}`,
                    version: scriptureRef.version,
                    content: result.content,
                } as Scripture,
                contents: [
                    `<p class="scripture-content"><sup>${verseNum}</sup> ${verse.scripture}</p>`,
                    `<p class="scripture-label"><b>${scriptureRef.bookName} ${scriptureRef.chapter}:${verseNum}</b> · ${scriptureRef.version}</p>`,
                ],
            }
            // Update the slide in activeSlides array
            const updatedSlides = activeSlides.map(s =>
                s.id === updatedSlide.id ? updatedSlide : s
            )
            setActiveSlides(updatedSlides)
            setActiveSlide(updatedSlide)
        }
    }, [scriptureRef, activeSlide, fetchScripture, activeSlides, setActiveSlides, setActiveSlide])

    // Navigate to previous/next verse
    const navigateVerse = useCallback((direction: 'prev' | 'next') => {
        if (!scriptureRef) return

        const { startVerse, endVerse } = scriptureRef
        const range = endVerse - startVerse + 1

        if (direction === 'prev') {
            const newStart = Math.max(1, startVerse - range)
            handleVerseSelect(newStart)
        } else {
            handleVerseSelect(endVerse + 1)
        }
    }, [scriptureRef, handleVerseSelect])

    // Verse navigation keyboard shortcuts (N / P / ← / →). Only active when
    // a bible slide is selected for preview, so the keys don't get swallowed
    // while browsing non-bible slides in the queue.
    useVerseNavigationShortcuts(
        () => navigateVerse('next'),
        () => navigateVerse('prev'),
        { enabled: activeSlide?.type === 'bible' }
    )

    // Handle version change
    const handleVersionChange = useCallback(async (newVersion: string) => {
        if (!scriptureRef || !activeSlide) return

        const { bookIndex, chapter, startVerse, endVerse, bookName } = scriptureRef
        const label = `${bookIndex}:${chapter}:${startVerse}${endVerse !== startVerse ? `-${endVerse}` : ''}`
        const result = await fetchScripture(label, newVersion)

        if (result && Array.isArray(result.content)) {
            const verses = result.content as BibleVerse[]
            const contents = verses.map(v => `<p><sup>${v.verse}</sup> ${v.scripture}</p>`)

            const updatedSlide: Slide = {
                ...activeSlide,
                data: {
                    label: `${bookName} ${chapter}:${startVerse}${endVerse !== startVerse ? `-${endVerse}` : ''}`,
                    labelShortFormat: `${bookIndex}:${chapter}:${startVerse}${endVerse !== startVerse ? `-${endVerse}` : ''}`,
                    version: newVersion,
                    content: result.content,
                } as Scripture,
                contents: [
                    `<p class="scripture-content">${contents.join(' ')}</p>`,
                    `<p class="scripture-label"><b>${bookName} ${chapter}:${startVerse}${endVerse !== startVerse ? `-${endVerse}` : ''}</b> · ${newVersion}</p>`,
                ],
            }

            const updatedSlides = activeSlides.map(s =>
                s.id === updatedSlide.id ? updatedSlide : s
            )
            setActiveSlides(updatedSlides)
            setActiveSlide(updatedSlide)
        }
    }, [scriptureRef, activeSlide, fetchScripture, activeSlides, setActiveSlides, setActiveSlide])

    const handleSelectVerseFromBrowser = useCallback((slideId: string) => {
        setLiveSlide(slideId)
        if (isConnected) {
            void setSharedLiveSlide(slideId)
        }
    }, [setLiveSlide, isConnected, setSharedLiveSlide])

    // One queue row for a single slide — shared between top-level rows and
    // the rows nested under an expanded song group, so both stay identical.
    const renderSlideRow = (slide: Slide, index: number) => (
        <div
            key={slide.id}
            data-slide-index={index}
            ref={liveSlideId === slide.id ? liveSlideRef : activeSlide?.id === slide.id ? activeSlideRef : undefined}
            // Double-click / double-tap a queued slide to send it live (single
            // click still just previews). Gated by collaboration mode.
            onDoubleClick={() => { if (canGoLive && liveSlideId !== slide.id) void setSharedLiveSlide(slide.id) }}
            className={`transition-all ${
                isDraggingIndex === index ? 'opacity-50 scale-95' : ''
            } ${
                dragOverIndex === index && isDraggingIndex != null && isDraggingIndex !== index
                    ? 'border-t-2 border-[var(--accent-teal)] pt-2'
                    : ''
            }`}
        >
            <div className="flex items-center gap-1">
                {/* Drag handle */}
                {!bulkSelectMode && (
                    <div
                        onPointerDown={(e) => {
                            if (e.button !== 0) return
                            e.preventDefault()
                            dragStateRef.current = index
                            setIsDraggingIndex(index)
                            if (slidesGridRef.current) {
                                slidesGridRef.current.style.userSelect = 'none'
                                slidesGridRef.current.style.cursor = 'grabbing'
                            }
                        }}
                        className="cursor-grab active:cursor-grabbing p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] touch-none"
                        title="Drag to reorder"
                    >
                        <GripVertical className="w-4 h-4" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <SlideCard
                        slide={slide}
                        isActive={activeSlide?.id === slide.id}
                        isLive={liveSlideId === slide.id}
                        isSelected={selectedSlideIds.includes(slide.id)}
                        selectable={bulkSelectMode}
                        onClick={() => handleSlideClick(slide)}
                        onDuplicate={() => handleDuplicateSlide(slide)}
                        onDelete={() => handleDeleteSlide(slide.id)}
                        onEdit={() => handleEditSlide(slide)}
                        onSaveToLibrary={() => handleSaveToLibrary(slide)}
                        isSaved={isInLibrary(slide.id)}
                        onGoLive={canGoLive ? () => { void setSharedLiveSlide(slide.id) } : undefined}
                        onSuggestToQueue={canQueueSlide ? () => { void addToQueue([slide.id]) } : undefined}
                        isStickyActive={activeSlide?.id === slide.id}
                    />
                </div>
            </div>
        </div>
    )

    // Icon for a slide's type, used by the compact list rows.
    const compactTypeIcon = (type: string): LucideIcon => {
        switch (type) {
            case 'bible': return BookOpen
            case 'song':
            case 'hymn': return Music
            case 'countdown': return Clock
            case 'alert': return AlertTriangle
            default: return FileText
        }
    }

    // Row label — for song/hymn verses the name is just "Song – Verse N" (the
    // verse number is already the row index), so show a lyrics preview instead;
    // everything else (bible refs, etc.) keeps its descriptive name.
    const compactRowLabel = (slide: Slide): string => {
        if ((slide.songId || slide.type === 'song' || slide.type === 'hymn') && slide.contents?.[0]) {
            const text = slide.contents[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            if (text) return text
        }
        return slide.name || 'Untitled slide'
    }

    // Compact one-line row — same interactions as the full card (click to
    // preview, double-click to go live, drag to reorder, bulk-select, delete)
    // but dense enough to scan a long queue. See the `density` state above.
    const renderCompactRow = (slide: Slide, index: number) => {
        const isLive = liveSlideId === slide.id
        const isActive = activeSlide?.id === slide.id
        const isSelected = selectedSlideIds.includes(slide.id)
        const TypeIcon = compactTypeIcon(slide.type)
        return (
            <div
                key={slide.id}
                data-slide-index={index}
                ref={isLive ? liveSlideRef : isActive ? activeSlideRef : undefined}
                onClick={() => handleSlideClick(slide)}
                onDoubleClick={() => { if (canGoLive && !isLive) void setSharedLiveSlide(slide.id) }}
                className={`group flex items-center gap-2 pl-1.5 pr-1.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                    isDraggingIndex === index ? 'opacity-50' : ''
                } ${
                    dragOverIndex === index && isDraggingIndex != null && isDraggingIndex !== index
                        ? 'border-t-2 border-t-[var(--accent-teal)]'
                        : ''
                } ${
                    isLive ? 'border-red-500/50 bg-red-500/10'
                        : isActive ? 'border-[var(--accent-teal)]/50 bg-[var(--accent-teal)]/5'
                            : isSelected ? 'border-[var(--accent-teal)]/40 bg-[var(--accent-teal)]/5'
                                : 'border-transparent hover:bg-[var(--bg-tertiary)]/50'
                }`}
            >
                {bulkSelectMode ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleSlideSelection(slide.id) }}
                        className={`p-0.5 shrink-0 ${isSelected ? 'text-[var(--accent-teal)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                        title={isSelected ? 'Deselect' : 'Select'}
                    >
                        {isSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    </button>
                ) : (
                    <div
                        onPointerDown={(e) => {
                            if (e.button !== 0) return
                            e.preventDefault()
                            dragStateRef.current = index
                            setIsDraggingIndex(index)
                            if (slidesGridRef.current) {
                                slidesGridRef.current.style.userSelect = 'none'
                                slidesGridRef.current.style.cursor = 'grabbing'
                            }
                        }}
                        className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-secondary)] touch-none opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Drag to reorder"
                    >
                        <GripVertical className="w-3.5 h-3.5" />
                    </div>
                )}
                <span className="text-[10px] tabular-nums text-[var(--text-muted)] w-5 text-right shrink-0">{index + 1}</span>
                <TypeIcon className={`w-3.5 h-3.5 shrink-0 ${isLive ? 'text-red-500' : 'text-[var(--text-muted)]'}`} />
                <span className="flex-1 min-w-0 truncate text-xs text-[var(--text-primary)]">{compactRowLabel(slide)}</span>
                {isLive && <span className="text-[9px] font-bold uppercase tracking-wide text-red-500 shrink-0">Live</span>}
                {!bulkSelectMode && (
                    <>
                        {canGoLive && !isLive && (
                            <button
                                onClick={(e) => { e.stopPropagation(); void setSharedLiveSlide(slide.id) }}
                                className="p-1 rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--accent-teal)] opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                title="Send to Live"
                            >
                                <Zap className="w-3.5 h-3.5" />
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteSlide(slide.id) }}
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                            title="Delete slide"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </>
                )}
            </div>
        )
    }

    // Density-aware queue slide renderer — used both at the top level and for a
    // song group's expanded verses so the whole queue honours the toggle.
    const renderQueueSlide = (slide: Slide, index: number) =>
        density === 'compact' ? renderCompactRow(slide, index) : renderSlideRow(slide, index)

    // Collapsed row for a song's grouped verses — see queueItems above.
    // Expanding reveals the same per-slide rows (drag handle + SlideCard,
    // real data-slide-index) as any other slide, so reordering/deleting
    // individual verses works exactly as before once expanded.
    const renderSongGroup = (item: SongGroupItem) => {
        const isExpanded = expandedSongGroups.has(item.key)
        const liveVerse = item.verses.find((v) => v.slide.id === liveSlideId)
        // Use the group's first verse position as its drop target so a normal
        // slide can be dragged and dropped onto a collapsed song group (which
        // otherwise has no data-slide-index and nothing to drop against).
        const dropIndex = item.verses[0].index
        return (
            <div
                key={item.key}
                data-slide-index={dropIndex}
                className={`flex flex-col gap-1 transition-all ${
                    dragOverIndex === dropIndex && isDraggingIndex != null && isDraggingIndex !== dropIndex
                        ? 'border-t-2 border-[var(--accent-teal)] pt-1'
                        : ''
                }`}
                // When a live verse sits inside a COLLAPSED group its own row
                // isn't in the DOM, so anchor the auto-center on the group
                // header instead. (Expanded groups let the inner row claim it.)
                ref={liveVerse && !isExpanded ? liveSlideRef : undefined}
            >
                <div
                    className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${liveVerse
                        ? 'border-red-500/40 bg-red-500/5'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 hover:bg-[var(--bg-tertiary)]/70'
                        }`}
                >
                    {bulkSelectMode && (
                        <button
                            onClick={() => handleToggleSongGroupSelection(item)}
                            className={`p-1 flex-shrink-0 transition-colors ${
                                isSongGroupSelected(item)
                                    ? 'text-[var(--accent-teal)]'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                            }`}
                            title={isSongGroupSelected(item) ? 'Deselect song' : 'Select song'}
                        >
                            {isSongGroupSelected(item) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                        </button>
                    )}
                    {/* Drag handle — drags the whole song (all its verses) as a block. */}
                    {!bulkSelectMode && (
                        <div
                            onPointerDown={(e) => {
                                if (e.button !== 0) return
                                e.preventDefault()
                                dragStateRef.current = dropIndex
                                dragGroupIdsRef.current = item.verses.map((v) => v.slide.id)
                                setIsDraggingIndex(dropIndex)
                                if (slidesGridRef.current) {
                                    slidesGridRef.current.style.userSelect = 'none'
                                    slidesGridRef.current.style.cursor = 'grabbing'
                                }
                            }}
                            className="cursor-grab active:cursor-grabbing p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] touch-none flex-shrink-0"
                            title="Drag song to reorder"
                        >
                            <GripVertical className="w-4 h-4" />
                        </div>
                    )}
                    <button
                        onClick={() => toggleSongGroupExpanded(item.key)}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0"
                        title={isExpanded ? 'Collapse' : 'Expand'}
                    >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <Music className="w-4 h-4 text-[var(--accent-teal)] flex-shrink-0" />
                    <button
                        onClick={() => setBrowsingSongGroup(item)}
                        className="flex-1 min-w-0 text-left"
                        title="Browse verses"
                    >
                        <div className="text-sm font-medium text-[var(--text-primary)] truncate">{item.songTitle}</div>
                        <div className="text-xs text-[var(--text-muted)]">
                            {item.verses.length} verses
                            {liveVerse && (
                                <span className="ml-1 font-semibold text-red-500">
                                    · {liveVerse.slide.verseLabel || `Verse ${(liveVerse.slide.verseIndex ?? 0) + 1}`} live
                                </span>
                            )}
                        </div>
                    </button>
                    {liveVerse && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                    {!bulkSelectMode && (
                        <button
                            onClick={() => handleDeleteSongGroup(item)}
                            className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10 rounded flex-shrink-0 transition-colors"
                            title="Delete song from queue"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </div>
                {isExpanded && (
                    <div className="ml-6 flex flex-col gap-2">
                        {item.verses.map(({ slide, index }) => renderQueueSlide(slide, index))}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="relative flex-1 flex flex-col h-full bg-transparent overflow-hidden">
            {/* Header - Compact */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/20">
                <div className="flex items-center gap-2">
                    <Rows3 className="w-4 h-4 text-[var(--accent-teal)]" />
                    <h2 className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                        Slide Queue
                    </h2>
                    <span className="text-[10px] font-medium text-[var(--text-muted)] tabular-nums">
                        {slides.length}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))}
                        className={`p-1.5 rounded-lg transition-all ${
                            density === 'compact'
                                ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                        title={density === 'compact' ? 'Comfortable view (full previews)' : 'Compact list view'}
                    >
                        <AlignJustify className="w-4 h-4" />
                    </button>
                    <button
                        onClick={toggleBulkSelectMode}
                        className={`p-1.5 rounded-lg transition-all ${
                            bulkSelectMode
                                ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                        title="Bulk Select"
                    >
                        <LayoutGrid className="w-4 h-4" />
                    </button>
                    {bulkSelectMode && (
                        <>
                            <button
                                onClick={handleSelectAll}
                                disabled={slides.length === 0}
                                className={`p-1.5 rounded-lg disabled:opacity-30 transition-colors ${
                                    allSelected
                                        ? 'text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                                }`}
                                title={allSelected ? 'Deselect all' : 'Select all'}
                            >
                                {allSelected ? <CheckSquare className="w-4 h-4" /> : someSelected ? <MinusSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            </button>
                            <button
                                onClick={handleDeleteSelected}
                                disabled={selectedSlideIds.length === 0}
                                className="flex items-center gap-1 pl-1.5 pr-2 py-1.5 text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10 rounded-lg disabled:opacity-30 transition-colors"
                                title={`Delete ${selectedSlideIds.length} selected slide${selectedSlideIds.length === 1 ? '' : 's'}`}
                            >
                                <Trash2 className="w-4 h-4" />
                                <span className="text-[11px] font-semibold tabular-nums">{selectedSlideIds.length}</span>
                            </button>
                        </>
                    )}
                    {slides.length > 0 && (
                        <button
                            onClick={handleClearQueue}
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10 rounded-lg transition-colors"
                            title="Clear entire queue"
                        >
                            <ListX className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Slides List — pointer-based reorderable queue */}
            <div
                ref={slidesGridRef}
                className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 custom-scrollbar"
                onPointerMove={(e) => {
                    if (dragStateRef.current == null) return
                    const el = document.elementFromPoint(e.clientX, e.clientY)
                    if (!el) return
                    const dropTarget = (el as HTMLElement).closest('[data-slide-index]')
                    if (dropTarget) {
                        const targetIndex = Number(dropTarget.getAttribute('data-slide-index'))
                        if (!Number.isNaN(targetIndex) && dragStateRef.current !== targetIndex) {
                            setDragOverIndex(targetIndex)
                        }
                    }
                }}
                onPointerUp={(e) => {
                    if (dragStateRef.current == null) return
                    const el = document.elementFromPoint(e.clientX, e.clientY)
                    if (el) {
                        const dropTarget = (el as HTMLElement).closest('[data-slide-index]')
                        if (dropTarget) {
                            const targetIndex = Number(dropTarget.getAttribute('data-slide-index'))
                            if (!Number.isNaN(targetIndex) && dragStateRef.current !== targetIndex) {
                                const toSlide = slides[targetIndex]
                                if (dragGroupIdsRef.current) {
                                    // Move a whole song group: pull its verse slides
                                    // out and re-insert the block before the target.
                                    const groupSet = new Set(dragGroupIdsRef.current)
                                    if (!groupSet.has(toSlide.id)) {
                                        const without = activeSlides.filter(s => !groupSet.has(s.id))
                                        const groupSlides = activeSlides.filter(s => groupSet.has(s.id))
                                        let insertAt = without.findIndex(s => s.id === toSlide.id)
                                        if (insertAt === -1) insertAt = without.length
                                        setActiveSlides([...without.slice(0, insertAt), ...groupSlides, ...without.slice(insertAt)])
                                    }
                                } else {
                                    const fromIdx = dragStateRef.current
                                    const fromSlide = slides[fromIdx]
                                    // Don't drop a non-group slide INTO a song group
                                    // (that would alter its verses) — snap to the
                                    // group's boundary: below it when dragging down,
                                    // above it when dragging up.
                                    let effectiveTargetIndex = targetIndex
                                    const targetSongId = slides[targetIndex]?.songId
                                    if (targetSongId && fromSlide.songId !== targetSongId) {
                                        let start = targetIndex
                                        let end = targetIndex
                                        while (start > 0 && slides[start - 1]?.songId === targetSongId) start--
                                        while (end < slides.length - 1 && slides[end + 1]?.songId === targetSongId) end++
                                        if (end > start) effectiveTargetIndex = fromIdx < start ? end : start
                                    }
                                    const dropSlide = slides[effectiveTargetIndex]
                                    const fromActiveIndex = activeSlides.findIndex(s => s.id === fromSlide.id)
                                    const toActiveIndex = activeSlides.findIndex(s => s.id === dropSlide.id)
                                    if (fromActiveIndex !== -1 && toActiveIndex !== -1 && fromActiveIndex !== toActiveIndex) {
                                        reorderActiveSlides(fromActiveIndex, toActiveIndex)
                                    }
                                }
                            }
                        }
                    }
                    dragStateRef.current = null
                    dragGroupIdsRef.current = null
                    setDragOverIndex(null)
                    setIsDraggingIndex(null)
                    if (slidesGridRef.current) {
                        slidesGridRef.current.style.userSelect = ''
                        slidesGridRef.current.style.cursor = ''
                    }
                }}
                onPointerLeave={() => {
                    if (dragStateRef.current == null) return
                    dragStateRef.current = null
                    dragGroupIdsRef.current = null
                    setDragOverIndex(null)
                    setIsDraggingIndex(null)
                    if (slidesGridRef.current) {
                        slidesGridRef.current.style.userSelect = ''
                        slidesGridRef.current.style.cursor = ''
                    }
                }}
            >
                {queueItems.length > 0 ? (
                    queueItems.map((item) =>
                        item.type === 'single' ? renderQueueSlide(item.slide, item.index) : renderSongGroup(item)
                    )
                ) : (
                    <div className="py-20 flex flex-col items-center opacity-40">
                        <EmptyState
                            icon="i-bx-slideshow"
                            sub="Queue Empty"
                            desc="Add slides to get started"
                            actionText="Create Slide"
                            action={handleCreateNewSlide}
                        />
                    </div>
                )}
            </div>

            {/* Song verse browser — chapter-style panel for a song's verses,
                modeled on the Bible list's browse-and-push-live pattern. */}
            {browsingSongGroup && (
                <SongVerseBrowser
                    songTitle={browsingSongGroup.songTitle}
                    artist={browsingSongGroup.artist}
                    verses={browsingSongGroup.verses}
                    liveSlideId={liveSlideId}
                    onSelectVerse={(slideId) => {
                        handleSelectVerseFromBrowser(slideId)
                        setBrowsingSongGroup(null)
                    }}
                    onClose={() => setBrowsingSongGroup(null)}
                />
            )}

            {/* Clear Queue Confirmation */}
            {showClearConfirm && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl p-5 max-w-sm w-full mx-4 shadow-xl">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-amber-500/10 rounded-full">
                                <AlertTriangle className="w-5 h-5 text-amber-500" />
                            </div>
                            <h3 className="font-semibold text-[var(--text-primary)]">Clear Queue?</h3>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mb-5">
                            Remove {slides.length} slide{slides.length === 1 ? '' : 's'} from the queue? This cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={cancelClearQueue}
                                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmClearQueue}
                                className="px-4 py-2 text-sm bg-[var(--accent-rose)] hover:bg-red-600 text-white rounded-lg transition-colors"
                            >
                                Clear All
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Delete Confirmation */}
            {showBulkDeleteConfirm && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl p-5 max-w-sm w-full mx-4 shadow-xl">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-amber-500/10 rounded-full">
                                <AlertTriangle className="w-5 h-5 text-amber-500" />
                            </div>
                            <h3 className="font-semibold text-[var(--text-primary)]">Delete Selected?</h3>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mb-5">
                            Remove {selectedSlideIds.length} selected slide{selectedSlideIds.length === 1 ? '' : 's'}? This cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={cancelBulkDelete}
                                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmBulkDelete}
                                className="px-4 py-2 text-sm bg-[var(--accent-rose)] hover:bg-red-600 text-white rounded-lg transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Footer */}
            <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <button
                    onClick={handleCreateNewSlide}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-[var(--bg-tertiary)] hover:bg-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg text-xs font-medium transition-all border border-[var(--border-default)] hover:border-[var(--accent-teal)]/30"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add New Slide
                </button>
            </div>
        </div>
    )
}
