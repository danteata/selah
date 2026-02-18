import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Trash2, Copy, LayoutGrid, BookOpen, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
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

    const handleEditSlide = useCallback((slide: Slide) => {
        setEditingSlide(slide)
        openModal('editor')
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
        <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Preview and Edit Content
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={toggleBulkSelectMode}
                        className={`
              flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors
              ${bulkSelectMode
                                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200'
                            }
            `}
                    >
                        <LayoutGrid className="w-4 h-4" />
                        {bulkSelectMode ? 'Cancel' : 'Select'}
                    </button>

                    {bulkSelectMode && selectedSlideIds.length > 0 && (
                        <button
                            onClick={handleDeleteSelected}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded-lg hover:bg-red-200"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete ({selectedSlideIds.length})
                        </button>
                    )}

                    <button
                        onClick={handleGoLive}
                        disabled={!activeSlide}
                        className="flex items-center gap-2 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Go Live
                    </button>
                </div>
            </div>

            {/* Slides Grid */}
            <div
                ref={slidesGridRef}
                className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 mb-4"
            >
                {slides.length > 0 ? (
                    slides.map((slide) => (
                        <SlideCard
                            key={slide.id}
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
                            onGoLive={() => setLiveSlide(slide.id)}
                        />
                    ))
                ) : (
                    <div className="col-span-2">
                        <EmptyState
                            icon="i-bx-slideshow"
                            sub="No slides yet"
                            desc="Create a new slide to get started"
                            actionText="Create new slide"
                            action={handleCreateNewSlide}
                        />
                    </div>
                )}
            </div>

            {/* Slide Editor (simplified) */}
            {activeSlide && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900 dark:text-white">
                            {activeSlide.name}
                        </h3>
                        <div className="flex items-center gap-2">
                            {activeSlide.type !== 'bible' && (
                                <button
                                    onClick={() => handleEditSlide(activeSlide)}
                                    className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                                    title="Edit"
                                >
                                    <BookOpen className="w-4 h-4" />
                                </button>
                            )}
                            <button
                                onClick={() => handleDuplicateSlide(activeSlide)}
                                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                                title="Duplicate"
                            >
                                <Copy className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDeleteSlide(activeSlide.id)}
                                className="p-2 text-red-500 hover:text-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                                title="Delete"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Bible Verse Content - Show related verses */}
                    {activeSlide.type === 'bible' && scriptureRef ? (
                        <div className="space-y-3">
                            {/* Navigation Controls */}
                            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                                <button
                                    onClick={() => navigateVerse('prev')}
                                    disabled={scriptureRef.startVerse <= 1}
                                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-30"
                                    title="Previous verse"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">
                                        {scriptureRef.bookName} {scriptureRef.chapter}:{scriptureRef.startVerse}
                                        {scriptureRef.endVerse !== scriptureRef.startVerse && `-${scriptureRef.endVerse}`}
                                    </span>
                                    <BibleVersionSelect
                                        selectedVersion={scriptureRef.version}
                                        onChange={handleVersionChange}
                                    />
                                </div>
                                <button
                                    onClick={() => navigateVerse('next')}
                                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                    title="Next verse"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Loading State */}
                            {loadingVerses && (
                                <div className="flex items-center justify-center py-4">
                                    <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
                                </div>
                            )}

                            {/* Related Verses Display */}
                            {!loadingVerses && (
                                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                    {/* Previous verses */}
                                    {relatedVerses.prev.map((v) => (
                                        <button
                                            key={v.verse}
                                            onClick={() => handleVerseSelect(parseInt(v.verse))}
                                            className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                        >
                                            <sup className="text-primary-500 font-medium">{v.verse}</sup>
                                            <span className="text-gray-700 dark:text-gray-300 ml-1">{v.scripture}</span>
                                        </button>
                                    ))}

                                    {/* Current verses (highlighted) */}
                                    {currentVerses.map((v) => (
                                        <div
                                            key={v.verse}
                                            className="px-3 py-2 text-sm rounded-lg bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700"
                                        >
                                            <sup className="text-primary-600 dark:text-primary-400 font-bold">{v.verse}</sup>
                                            <span className="text-gray-900 dark:text-white ml-1 font-medium">{v.scripture}</span>
                                        </div>
                                    ))}

                                    {/* Next verses */}
                                    {relatedVerses.next.map((v) => (
                                        <button
                                            key={v.verse}
                                            onClick={() => handleVerseSelect(parseInt(v.verse))}
                                            className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                        >
                                            <sup className="text-primary-500 font-medium">{v.verse}</sup>
                                            <span className="text-gray-700 dark:text-gray-300 ml-1">{v.scripture}</span>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Verse Quick Selector */}
                            {!loadingVerses && currentVerses.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-2 border-t border-gray-200 dark:border-gray-700">
                                    {relatedVerses.prev.map((v) => (
                                        <button
                                            key={v.verse}
                                            onClick={() => handleVerseSelect(parseInt(v.verse))}
                                            className="w-7 h-7 flex items-center justify-center text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
                                        >
                                            {v.verse}
                                        </button>
                                    ))}
                                    {currentVerses.map((v) => (
                                        <span
                                            key={v.verse}
                                            className="w-7 h-7 flex items-center justify-center text-xs rounded bg-primary-500 text-white font-medium"
                                        >
                                            {v.verse}
                                        </span>
                                    ))}
                                    {relatedVerses.next.map((v) => (
                                        <button
                                            key={v.verse}
                                            onClick={() => handleVerseSelect(parseInt(v.verse))}
                                            className="w-7 h-7 flex items-center justify-center text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
                                        >
                                            {v.verse}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Non-bible slides - show content editor */
                        <div className="space-y-2">
                            {activeSlide.contents.map((content, index) => (
                                <div
                                    key={index}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg dark:bg-gray-800 dark:text-white min-h-[80px] cursor-pointer hover:border-primary-500 transition-colors"
                                    onClick={() => handleEditSlide(activeSlide)}
                                >
                                    <div
                                        className="tiptap-preview"
                                        dangerouslySetInnerHTML={{ __html: content || '<p class="text-gray-400">Click to edit...</p>' }}
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-end mt-3">
                        <button
                            onClick={handleGoLive}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Take Live
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
