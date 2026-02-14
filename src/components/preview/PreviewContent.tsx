import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Trash2, Copy, LayoutGrid } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSlideCreation, useGlobalEmit } from '../../hooks'
import { globalEmitter } from '../../hooks/useEmitter'
import type { Slide } from '../../types'
import { appWideActions } from '../../types'
import { SlideCard } from '../slides/SlideCard'
import { EmptyState } from '../utils/EmptyState'

export function PreviewContent() {
    const [activeSlide, setActiveSlide] = useState<Slide | undefined>()
    const [bulkSelectMode, setBulkSelectMode] = useState(false)
    const [selectedSlides, setSelectedSlides] = useState<string[]>([])

    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const removeActiveSlide = useAppStore((state) => state.removeActiveSlide)
    const setActiveSlides = useAppStore((state) => state.setActiveSlides)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)

    const { createTextSlide, duplicateSlide } = useSlideCreation()
    const globalEmit = useGlobalEmit()
    const slidesGridRef = useRef<HTMLDivElement>(null)

    // Derive slides from store - single source of truth
    const slides = useMemo(() => {
        if (activeSchedule) {
            return activeSlides.filter(
                (slide) => slide.scheduleId === activeSchedule._id
            )
        }
        return []
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

    // Listen for events
    useEffect(() => {
        // New text slide
        globalEmitter.on(appWideActions.newSlide, () => {
            const newSlide = createTextSlide()
            setActiveSlide(newSlide)
        })

        // Duplicate slide - accepts Slide or Slide[]
        globalEmitter.on(appWideActions.newText, (data) => {
            let newSlide: Slide | null = null
            if (data) {
                const slide = Array.isArray(data) ? data[0] : data as Slide
                newSlide = duplicateSlide(slide)
            } else {
                newSlide = createTextSlide()
            }
            if (newSlide) {
                setActiveSlide(newSlide)
            }
        })

        // Delete slide
        globalEmitter.on(appWideActions.deleteSlide, (slide) => {
            const s = slide as Slide
            handleDeleteSlide(s.id)
        })

        // Select slides toggle
        globalEmitter.on(appWideActions.selectSlides, () => {
            setBulkSelectMode(prev => !prev)
            setSelectedSlides([])
        })

        // Promote to live
        globalEmitter.on('promote-active-slide-live', () => {
            if (activeSlide) {
                setLiveSlide(activeSlide.id)
            }
        })

        return () => {
            globalEmitter.off(appWideActions.newSlide)
            globalEmitter.off(appWideActions.newText)
            globalEmitter.off(appWideActions.deleteSlide)
            globalEmitter.off(appWideActions.selectSlides)
            globalEmitter.off('promote-active-slide-live')
        }
    }, [createTextSlide, duplicateSlide, activeSlide, setLiveSlide, handleDeleteSlide])

    const handleDuplicateSlide = useCallback((slide: Slide) => {
        const newSlide = duplicateSlide(slide)
        if (newSlide) {
            setActiveSlide(newSlide)
        }
    }, [duplicateSlide])

    const handleSlideClick = useCallback((slide: Slide) => {
        if (bulkSelectMode) {
            setSelectedSlides(prev =>
                prev.includes(slide.id)
                    ? prev.filter(id => id !== slide.id)
                    : [...prev, slide.id]
            )
        } else {
            setActiveSlide(slide)
        }
    }, [bulkSelectMode])

    const handleGoLive = useCallback(() => {
        if (activeSlide) {
            setLiveSlide(activeSlide.id)
        }
    }, [activeSlide, setLiveSlide])

    const handleDeleteSelected = useCallback(() => {
        selectedSlides.forEach(id => {
            const slide = slides.find(s => s.id === id)
            if (slide) {
                removeActiveSlide(slide)
            }
        })
        setSelectedSlides([])
        setBulkSelectMode(false)
    }, [selectedSlides, slides, removeActiveSlide])

    return (
        <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Preview and Edit Content
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setBulkSelectMode(!bulkSelectMode)}
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

                    {bulkSelectMode && selectedSlides.length > 0 && (
                        <button
                            onClick={handleDeleteSelected}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded-lg hover:bg-red-200"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete ({selectedSlides.length})
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
                            isSelected={selectedSlides.includes(slide.id)}
                            selectable={bulkSelectMode}
                            onClick={() => handleSlideClick(slide)}
                            onDuplicate={() => handleDuplicateSlide(slide)}
                            onDelete={() => handleDeleteSlide(slide.id)}
                        />
                    ))
                ) : (
                    <div className="col-span-2">
                        <EmptyState
                            icon="i-bx-slideshow"
                            sub="No slides yet"
                            desc="Create a new slide to get started"
                            actionText="Create new slide"
                            action={() => globalEmit(appWideActions.newSlide)}
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

                    {/* Content editor */}
                    <div className="space-y-2">
                        {activeSlide.contents.map((content, index) => (
                            <div
                                key={index}
                                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg dark:bg-gray-800 dark:text-white min-h-[80px] cursor-pointer hover:border-primary-500 transition-colors"
                                onClick={() => globalEmit(appWideActions.newActiveSlide, activeSlide)}
                            >
                                <div
                                    className="tiptap-preview"
                                    dangerouslySetInnerHTML={{ __html: content || '<p class="text-gray-400">Click to edit...</p>' }}
                                />
                            </div>
                        ))}
                    </div>

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
