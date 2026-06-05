import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Trash2, Copy, LayoutGrid, BookOpen, RefreshCw, ChevronLeft, ChevronRight, CheckSquare, Rows3, Plus, GripVertical, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSlideCreation, useLibrary, useScripture, useLiveSession, useVerseNavigationShortcuts } from '../../hooks'
import type { Slide, Scripture, BibleVerse } from '../../types'
import { bibleBooks } from '../../types'
import { SlideCard } from '../slides/SlideCard'
import { EmptyState } from '../utils/EmptyState'
import { BibleVersionSelect } from '../bible/BibleVersionSelect'

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
    const userClickedSlideRef = useRef(false)
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
    const [isDraggingIndex, setIsDraggingIndex] = useState<number | null>(null)
    const dragStateRef = useRef<number | null>(null)
    const [showClearConfirm, setShowClearConfirm] = useState(false)
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

    // Auto-scroll to active slide ONLY when user explicitly clicked it.
    // Voice commands and auto-advance should not cause jumpy scrolling.
    useEffect(() => {
        if (userClickedSlideRef.current && activeSlide && activeSlideRef.current) {
            activeSlideRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            userClickedSlideRef.current = false
        }
    }, [activeSlide?.id])

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

    const canGoLive = !isConnected || isOperator || (isContributor && isOpen)
    const canQueueSlide = isConnected && isContributor && !isStrict

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
                        <button
                            onClick={handleDeleteSelected}
                            disabled={selectedSlideIds.length === 0}
                            className="p-1.5 text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10 rounded-lg disabled:opacity-30 transition-colors"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                    {slides.length > 0 && (
                        <button
                            onClick={handleClearQueue}
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/10 rounded-lg transition-colors"
                            title="Clear slide queue"
                        >
                            <Trash2 className="w-4 h-4" />
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
                                const fromSlide = slides[dragStateRef.current]
                                const toSlide = slides[targetIndex]
                                const fromActiveIndex = activeSlides.findIndex(s => s.id === fromSlide.id)
                                const toActiveIndex = activeSlides.findIndex(s => s.id === toSlide.id)
                                if (fromActiveIndex !== -1 && toActiveIndex !== -1) {
                                    reorderActiveSlides(fromActiveIndex, toActiveIndex)
                                }
                            }
                        }
                    }
                    dragStateRef.current = null
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
                    setDragOverIndex(null)
                    setIsDraggingIndex(null)
                    if (slidesGridRef.current) {
                        slidesGridRef.current.style.userSelect = ''
                        slidesGridRef.current.style.cursor = ''
                    }
                }}
            >
                {slides.length > 0 ? (
                    slides.map((slide, index) => (
                        <div
                            key={slide.id}
                            data-slide-index={index}
                            ref={activeSlide?.id === slide.id ? activeSlideRef : undefined}
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
                    ))
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
