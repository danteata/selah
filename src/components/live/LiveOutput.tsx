import { useState, useEffect, useCallback, useMemo } from 'react'
import { Eye, Trash2, Edit, Monitor, Airplay } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useMultiMonitor } from '../../hooks/useMultiMonitor'
import { generateSlideContent } from '../../hooks/useSlideCreation'
import { useFileUrl } from '../../hooks/useTemplates'
import type { Slide, Scripture } from '../../types'
import { SlideChip } from '../slides/SlideChip'
import { ScreenPicker } from './ScreenPicker'
import { BibleVerseNavigator } from '../bible/BibleVerseNavigator'

export function LiveOutput() {
    const [ctrlOrMetaActive, setCtrlOrMetaActive] = useState(false)
    const [showScreenPicker, setShowScreenPicker] = useState(false)

    const { isPresenting, selectedScreenId, detectScreens, openLiveViewOnScreen, terminatePresentation } = useMultiMonitor()

    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveOutputSlidesId = useAppStore((state) => state.liveOutputSlidesId)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
    const removeActiveSlide = useAppStore((state) => state.removeActiveSlide)
    const setEditingSlide = useAppStore((state) => state.setEditingSlide)
    const openModal = useAppStore((state) => state.openModal)

    // Get live output slides
    const liveOutputSlides = useMemo(() => {
        if (!liveOutputSlidesId) return []

        const slides = liveOutputSlidesId
            .map(id => activeSlides.find(slide => slide.id === id))
            .filter((slide): slide is Slide => slide !== undefined)

        // Filter by active schedule
        return slides.filter(slide => slide.scheduleId === activeSchedule?._id)
    }, [liveOutputSlidesId, activeSlides, activeSchedule])

    // Get live slide
    const liveSlide = useMemo(() => {
        return activeSlides.find(slide => slide.id === liveSlideId)
    }, [activeSlides, liveSlideId])

    // Get file URL for live slide if it has a backgroundStorageId
    const liveSlideFileUrl = useFileUrl(liveSlide?.backgroundStorageId || null)

    // Determine the background URL for live slide
    const liveSlideBackground = liveSlideFileUrl || liveSlide?.background
    const isLiveSlideVideo = liveSlide?.backgroundType === 'video' && liveSlideBackground

    // Get next and previous slides
    const currentIndex = useMemo(() => {
        return liveOutputSlides.findIndex(slide => slide.id === liveSlideId)
    }, [liveOutputSlides, liveSlideId])

    const nextSlide = liveOutputSlides[currentIndex + 1]
    const prevSlide = liveOutputSlides[currentIndex - 1]

    // Keyboard shortcuts for navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                setCtrlOrMetaActive(true)
            }
        }

        const handleKeyUp = () => {
            setCtrlOrMetaActive(false)
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
        }
    }, [])

    // Arrow key navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown' && nextSlide) {
                handleSetLiveSlide(nextSlide.id)
            } else if (e.key === 'ArrowUp' && prevSlide) {
                handleSetLiveSlide(prevSlide.id)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [nextSlide, prevSlide])

    // Number shortcuts (Ctrl/Cmd + 0-9)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                const num = parseInt(e.key, 10)
                if (!isNaN(num) && num >= 0 && num <= 9) {
                    e.preventDefault()
                    const targetIndex = num === 0 ? liveOutputSlides.length - 1 : num - 1
                    const targetSlide = liveOutputSlides[targetIndex]
                    if (targetSlide?._id) {
                        handleSetLiveSlide(targetSlide.id)
                    }
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [liveOutputSlides])

    const handleSetLiveSlide = useCallback((slideId: string) => {
        setLiveSlide(slideId)
        // Broadcast to other windows
        const slide = activeSlides.find(s => s.id === slideId)
        if (slide) {
            window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
        }
    }, [setLiveSlide, activeSlides])

    const handleDeleteSlide = useCallback((slide: Slide) => {
        removeActiveSlide(slide)
    }, [removeActiveSlide])

    const handleEditSlide = useCallback((slide: Slide) => {
        setEditingSlide(slide)
        openModal('editor')
    }, [setEditingSlide, openModal])

    // Handle open live with screen picker
    const handleOpenLive = useCallback(async () => {
        await detectScreens()
        setShowScreenPicker(true)
    }, [detectScreens])

    // Handle screen selection
    const handleScreenSelect = useCallback(async (screenId: string) => {
        await openLiveViewOnScreen(screenId, liveSlideId || undefined)
        setShowScreenPicker(false)
    }, [openLiveViewOnScreen, liveSlideId])

    // Handle stop presenting
    const handleStopLive = useCallback(async () => {
        await terminatePresentation()
    }, [terminatePresentation])

    // Handle verse selection from BibleVerseNavigator
    const handleVerseSelect = useCallback((scripture: Scripture) => {
        if (!liveSlide) return

        // Update the live slide with new scripture content
        const updatedSlide = {
            ...liveSlide,
            data: scripture,
            contents: generateSlideContent(liveSlide, scripture),
        }

        // Update the slide in activeSlides
        const setActiveSlides = useAppStore.getState().setActiveSlides
        const activeSlides = useAppStore.getState().activeSlides
        const updatedSlides = activeSlides.map(s =>
            s.id === liveSlide.id ? updatedSlide : s
        )
        setActiveSlides(updatedSlides)

        // Broadcast the updated slide
        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updatedSlide }))
    }, [liveSlide, generateSlideContent])

    return (
        <div className="max-w-[400px] bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4 flex flex-col relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Slide Schedule
                </h2>
                <div className="flex items-center gap-2">
                    {isPresenting ? (
                        <button
                            onClick={handleStopLive}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                        >
                            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                            Stop Live
                        </button>
                    ) : (
                        <button
                            onClick={handleOpenLive}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            <Eye className="w-4 h-4" />
                            Open Live
                        </button>
                    )}
                </div>
            </div>

            {/* Screen Picker Modal */}
            {showScreenPicker && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-lg">
                    <ScreenPicker
                        onSelect={handleScreenSelect}
                        onClose={() => setShowScreenPicker(false)}
                    />
                </div>
            )}

            {/* Slides list */}
            <div className="flex-1 overflow-y-auto space-y-2 max-h-[calc(100vh-350px)]">
                {liveOutputSlides.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <p>No slides in schedule</p>
                        <p className="text-sm">Add slides from the preview panel</p>
                    </div>
                ) : (
                    liveOutputSlides.map((slide, index) => (
                        <button
                            key={slide.id}
                            onClick={() => handleSetLiveSlide(slide.id)}
                            onDoubleClick={() => handleEditSlide(slide)}
                            className={`
                w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all relative group
                ${liveSlideId === slide.id
                                    ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent'
                                }
              `}
                        >
                            {/* Slide thumbnail */}
                            <div
                                className="w-20 h-12 rounded overflow-hidden flex-shrink-0 bg-gray-800"
                                style={{
                                    backgroundImage: slide.background ? `url(${slide.background})` : undefined,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                }}
                            >
                                {slide.contents[0] && (
                                    <div
                                        className="w-full h-full flex items-center justify-center p-1 tiptap-preview text-white text-[6px] text-center line-clamp-2"
                                        dangerouslySetInnerHTML={{ __html: slide.contents[0].slice(0, 100) }}
                                    />
                                )}
                            </div>

                            {/* Slide info */}
                            <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm text-gray-900 dark:text-white truncate">
                                    {slide.name}
                                </h4>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <SlideChip slideType={slide.type} />
                                </div>
                            </div>

                            {/* Live indicator */}
                            {liveSlideId === slide.id && (
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded-full">
                                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                    LIVE
                                </div>
                            )}

                            {/* Index number when Ctrl is pressed */}
                            {ctrlOrMetaActive && (
                                <div className="absolute bottom-2 left-2 bg-gray-600 text-white text-xs font-mono px-1.5 py-0.5 rounded">
                                    {index === liveOutputSlides.length - 1 ? 0 : index + 1}
                                </div>
                            )}

                            {/* Hover actions */}
                            <div className="hidden group-hover:flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <div
                                    onClick={() => handleEditSlide(slide)}
                                    className="p-1.5 text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded cursor-pointer"
                                    role="button"
                                    title="Edit"
                                >
                                    <Edit className="w-4 h-4" />
                                </div>
                                <div
                                    onClick={() => handleDeleteSlide(slide)}
                                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded cursor-pointer"
                                    role="button"
                                    title="Delete"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </div>
                            </div>
                        </button>
                    ))
                )}
            </div>

            {/* Live preview */}
            {liveSlide && (
                <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Currently Live
                    </h3>
                    <div
                        className="aspect-video rounded-lg overflow-hidden relative"
                        style={{
                            backgroundImage: !isLiveSlideVideo && liveSlideBackground ? `url(${liveSlideBackground})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            backgroundColor: !liveSlideBackground ? '#1f2937' : undefined,
                        }}
                    >
                        {/* Video background */}
                        {isLiveSlideVideo && (
                            <video
                                src={liveSlideBackground}
                                className="absolute inset-0 w-full h-full object-cover"
                                autoPlay
                                loop
                                muted
                                playsInline
                            />
                        )}
                        {liveSlide.contents[0] && (
                            <div className="absolute inset-0 flex items-center justify-center p-6">
                                <div
                                    className="text-white text-center drop-shadow-lg tiptap-preview"
                                    style={{ fontSize: '1.5vw' }}
                                    dangerouslySetInnerHTML={{ __html: liveSlide.contents[0] }}
                                />
                            </div>
                        )}

                        {/* Live badge */}
                        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded-full">
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                            LIVE
                        </div>
                    </div>
                </div>
            )}

            {/* Bible Verse Navigator - shown when live slide is a bible slide */}
            {liveSlide?.type === 'bible' && (
                <BibleVerseNavigator
                    currentSlide={liveSlide}
                    onVerseSelect={handleVerseSelect}
                />
            )}

            {/* Navigation hints */}
            <div className="mt-4 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-2">
                    <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">âââ </kbd>
                    <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">âââ¬</kbd>
                    Navigate
                </div>
                <div className="flex items-center gap-2">
                    <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">Ctrl+0-9</kbd>
                    Quick select
                </div>
            </div>
        </div>
    )
}
