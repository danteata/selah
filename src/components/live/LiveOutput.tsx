import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Eye, Trash2, Edit, Monitor, Airplay, ChevronUp, ChevronDown, Cpu, Radio, RadioTower } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { useNdiOutput } from '../../hooks/useNdiOutput'
import { generateSlideContent } from '../../hooks/useSlideCreation'
import { useFileUrl } from '../../hooks/useTemplates'
import type { Slide, Scripture, Countdown } from '../../types'
import { SlideChip } from '../slides/SlideChip'
import { ScreenPicker } from './ScreenPicker'
import { BibleVerseNavigator } from '../bible/BibleVerseNavigator'

// Helper: parse "HH:MM:SS" or "MM:SS" to total seconds
function parseTimeStringToSeconds(timeStr: string): number {
    const parts = timeStr.split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return 0
}

// Helper: format total seconds to "HH:MM:SS" or "MM:SS"
function formatSecondsToTime(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function LiveOutput() {
    const [ctrlOrMetaActive, setCtrlOrMetaActive] = useState(false)
    const [showScreenPicker, setShowScreenPicker] = useState(false)

    // Countdown preview state
    const [previewCountdownSeconds, setPreviewCountdownSeconds] = useState(0)
    const previewIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const {
        isPresenting,
        isDesktop,
        detectMonitors,
        openLiveWindow,
        closeLiveWindow,
        sendSlideToLive,
    } = useNativeMultiMonitor()

    const {
        isAvailable: ndiAvailable,
        isRunning: ndiRunning,
        isLoading: ndiLoading,
        startOutput: ndiStart,
        stopOutput: ndiStop,
    } = useNdiOutput()

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

        // Filter by active schedule (show slides with matching scheduleId or no scheduleId)
        if (activeSchedule) {
            return slides.filter(slide =>
                slide.scheduleId === activeSchedule._id || !slide.scheduleId || slide.scheduleId === ''
            )
        }
        // If no active schedule, show all slides without a scheduleId
        return slides.filter(slide => !slide.scheduleId || slide.scheduleId === '')
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
            const el = document.activeElement
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.getAttribute('contenteditable') === 'true') return
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
            const el = document.activeElement
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.getAttribute('contenteditable') === 'true') return
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

        // Send to live window via native API
        const slide = activeSlides.find(s => s.id === slideId)
        if (slide) {
            if (isDesktop) {
                sendSlideToLive(slideId, slide as unknown as Record<string, unknown>)
            }
            // Broadcast to other windows (for web mode)
            window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
        }
    }, [setLiveSlide, activeSlides, isDesktop, sendSlideToLive])

    const handleDeleteSlide = useCallback((slide: Slide) => {
        removeActiveSlide(slide)
    }, [removeActiveSlide])

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

    const liveOutputMonitorId = useAppStore((state) => state.settings.liveOutputMonitorId)

    // Handle open live with screen picker
    const handleOpenLive = useCallback(async () => {
        if (liveOutputMonitorId && isDesktop) {
            await openLiveWindow({
                monitor_id: liveOutputMonitorId,
                fullscreen: true,
                decorations: false,
                always_on_top: true,
                initial_slide_id: liveSlideId || undefined,
            })
        } else {
            await detectMonitors()
            setShowScreenPicker(true)
        }
    }, [liveOutputMonitorId, isDesktop, openLiveWindow, detectMonitors, liveSlideId])

    // Handle screen selection
    const handleScreenSelect = useCallback(async (screenId: string) => {
        if (isDesktop) {
            await openLiveWindow({
                monitor_id: screenId,
                fullscreen: true,
                decorations: false,
                always_on_top: true,
                initial_slide_id: liveSlideId || undefined,
            })
        }
        setShowScreenPicker(false)
    }, [isDesktop, openLiveWindow, liveSlideId])

    // Initialize & run countdown preview when live slide is a countdown
    useEffect(() => {
        // Clear any existing interval
        if (previewIntervalRef.current) {
            clearInterval(previewIntervalRef.current)
            previewIntervalRef.current = null
        }

        if (!liveSlide || liveSlide.type !== 'countdown') {
            setPreviewCountdownSeconds(0)
            return
        }

        // Parse initial time from slide data
        const countdownData = liveSlide.data as Countdown | undefined
        const timeStr = countdownData?.time || liveSlide.contents[1] || '00:05:00'
        const initialSeconds = parseTimeStringToSeconds(timeStr)
        setPreviewCountdownSeconds(initialSeconds)

        // Start ticking
        previewIntervalRef.current = setInterval(() => {
            setPreviewCountdownSeconds((prev) => {
                if (prev <= 1) {
                    clearInterval(previewIntervalRef.current!)
                    previewIntervalRef.current = null
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => {
            if (previewIntervalRef.current) {
                clearInterval(previewIntervalRef.current)
                previewIntervalRef.current = null
            }
        }
    }, [liveSlide?.id, liveSlide?.type])

    // Handle stop presenting
    const handleStopLive = useCallback(async () => {
        await closeLiveWindow()
    }, [closeLiveWindow])

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

        // Send to native live window
        if (isDesktop) {
            sendSlideToLive(liveSlide.id, updatedSlide as unknown as Record<string, unknown>)
        }
    }, [liveSlide, generateSlideContent, isDesktop, sendSlideToLive])

    return (
        <div className="max-w-[400px] bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4 flex flex-col relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Slide Schedule
                    </h2>
                    {isDesktop && (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full">
                            <Cpu className="w-3 h-3" />
                            Native
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {ndiAvailable && (
                        ndiRunning ? (
                            <button
                                onClick={ndiStop}
                                disabled={ndiLoading}
                                className="flex items-center gap-1.5 px-2 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                                title="Stop NDI output stream"
                            >
                                <RadioTower className="w-3.5 h-3.5" />
                                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                NDI
                            </button>
                        ) : (
                            <button
                                onClick={ndiStart}
                                disabled={ndiLoading}
                                className="flex items-center gap-1.5 px-2 py-1.5 text-sm border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/30 disabled:opacity-50"
                                title="Start NDI output to stream live view over the network"
                            >
                                <Radio className="w-3.5 h-3.5" />
                                NDI
                            </button>
                        )
                    )}
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
                            title={liveOutputMonitorId ? 'Go Live on pre-selected display' : 'Choose a display and go live'}
                        >
                            <Eye className="w-4 h-4" />
                            {liveOutputMonitorId ? 'Go Live' : 'Open Live'}
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
                        {/* Countdown preview - live ticking */}
                        {liveSlide.type === 'countdown' ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center p-2 bg-gray-900/60">
                                {liveSlide.contents[0] && (
                                    <p className="text-white/70 text-[9px] mb-1 text-center truncate max-w-full px-1">
                                        {liveSlide.contents[0]}
                                    </p>
                                )}
                                <div className="text-white font-mono font-bold tabular-nums leading-none"
                                    style={{ fontSize: 'clamp(14px, 4vw, 28px)' }}
                                >
                                    {formatSecondsToTime(previewCountdownSeconds)}
                                </div>
                            </div>
                        ) : liveSlide.contents[0] ? (
                            <div className="absolute inset-0 flex items-center justify-center p-6">
                                <div
                                    className="text-white text-center drop-shadow-lg tiptap-preview"
                                    style={{ fontSize: '1.5vw' }}
                                    dangerouslySetInnerHTML={{ __html: liveSlide.contents[0] }}
                                />
                            </div>
                        ) : null}

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

            {/* Navigation controls */}
            <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center justify-between">
                    {/* Previous/Next buttons */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => prevSlide && handleSetLiveSlide(prevSlide.id)}
                            disabled={!prevSlide}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronUp className="w-4 h-4" />
                            Prev
                        </button>
                        <button
                            onClick={() => nextSlide && handleSetLiveSlide(nextSlide.id)}
                            disabled={!nextSlide}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                            <ChevronDown className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Slide position indicator */}
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        {liveOutputSlides.length > 0 ? (
                            <span>{currentIndex + 1} / {liveOutputSlides.length}</span>
                        ) : (
                            <span>No slides</span>
                        )}
                    </div>
                </div>

                {/* Keyboard shortcut hints */}
                <div className="mt-2 flex items-center justify-center gap-4 text-xs text-gray-400 dark:text-gray-500">
                    <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">↑</kbd>
                        <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">↓</kbd>
                        Navigate
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Ctrl+1-9</kbd>
                        Jump to slide
                    </span>
                </div>
            </div>
        </div>
    )
}
