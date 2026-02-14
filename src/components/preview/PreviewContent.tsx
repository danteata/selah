import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Trash2, Copy, LayoutGrid } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSlideCreation } from '../../hooks'
import type { Slide } from '../../types'
import { SlideCard } from '../slides/SlideCard'
import { EmptyState } from '../utils/EmptyState'

export function PreviewContent() {
    const [activeSlide, setActiveSlide] = useState<Slide | undefined>()

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
                                onClick={() => handleEditSlide(activeSlide)}
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
