import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Trash2, Copy, LayoutGrid, BookOpen, RefreshCw, ChevronLeft, ChevronRight, CheckSquare } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSlideCreation, useLibrary, useScripture } from '../../hooks'
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
    const setActiveSlides = useAppStore((state) => state.setActiveSlides)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
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
    const slidesGridRef = useRef<HTMLDivElement>(null)

    // Derive slides from store - single source of truth
    // Show slides that match the active schedule, or slides without a schedule if no active schedule
    const slides = useMemo(() => {
        if (activeSchedule) {
            return activeSlides.filter(
                (slide) => slide.scheduleId === activeSchedule._id || slide.scheduleId === ''
            )
        }
        // If no active schedule, show all slides without a scheduleId
        return activeSlides.filter((slide) => !slide.scheduleId || slide.scheduleId === '')
    }, [activeSlides, activeSchedule])

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
            setActiveSlide(slide)
        }
    }, [bulkSelectMode, toggleSlideSelection])

    const handleGoLive = useCallback(() => {
        if (activeSlide) {
            setLiveSlide(activeSlide.id)
        }
    }, [activeSlide, setLiveSlide])

    const handleDeleteSelected = useCallback(() => {
        selectedSlideIds.forEach(id => {
            const slide = slides.find(s => s.id === id)
            if (slide) {
                removeActiveSlide(slide)
            }
        })
        clearSelectedSlides()
    }, [selectedSlideIds, slides, removeActiveSlide, clearSelectedSlides])

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
                contents: [`<p><sup>${verseNum}</sup> ${verse.scripture}</p>`],
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
                contents,
            }

            const updatedSlides = activeSlides.map(s =>
                s.id === updatedSlide.id ? updatedSlide : s
            )
            setActiveSlides(updatedSlides)
            setActiveSlide(updatedSlide)
        }
    }, [scriptureRef, activeSlide, fetchScripture, activeSlides, setActiveSlides, setActiveSlide])

    return (
        <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
            {/* Header - Compact */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Slide Queue
                </h2>
                <div className="flex items-center gap-1">
                    <button
                        onClick={toggleBulkSelectMode}
                        className={`p-1.5 rounded transition-colors ${bulkSelectMode ? 'bg-amber-500/20 text-amber-500' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                        title="Bulk Select"
                    >
                        <LayoutGrid className="w-4 h-4" />
                    </button>
                    {bulkSelectMode && (
                        <button
                            onClick={handleDeleteSelected}
                            disabled={selectedSlideIds.length === 0}
                            className="p-1.5 text-red-500 hover:bg-red-500/10 rounded disabled:opacity-30"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Slides List - High Density Vertical */}
            <div
                ref={slidesGridRef}
                className="flex-1 overflow-y-auto p-2 space-y-2"
            >
                {slides.length > 0 ? (
                    slides.map((slide, index) => (
                        <SlideCard
                            key={slide.id}
                            slide={slide}
                            index={index + 1}
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
                            onGoLive={() => setLiveSlide(slide.id)}
                            variant="compact"
                        />
                    ))
                ) : (
                    <div className="py-20">
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

            {/* Quick Add Footer */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                <button
                    onClick={handleCreateNewSlide}
                    className="w-full py-2 px-4 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors border border-gray-300 dark:border-gray-700"
                >
                    + Add New Slide
                </button>
            </div>
        </div>
    )
}
