import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Monitor, ChevronUp, ChevronDown, Radio, Presentation, Crown, Shield, Lightbulb, Check, X } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { useNdiOutput } from '../../hooks/useNdiOutput'
import { useLiveSession } from '../../hooks'
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
    const sharedQueueSlideIds = useAppStore((state) => state.sharedQueueSlideIds)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
    const setLiveOutputSlidesId = useAppStore((state) => state.setLiveOutputSlidesId)
    const removeActiveSlide = useAppStore((state) => state.removeActiveSlide)
    const setEditingSlide = useAppStore((state) => state.setEditingSlide)
    const openModal = useAppStore((state) => state.openModal)

    // Shared live session — operator controls
    const {
        isOperator,
        isContributor,
        isViewer,
        isConnected,
        isOpen,
        collaborationMode,
        setLiveSlide: setLiveSlideShared,
        addToQueue,
        removeFromQueue,
        acceptFromQueue,
    } = useLiveSession()

    // Role badge label
    const roleLabel = useMemo(() => {
        if (isOperator) return 'Operator'
        if (isContributor) return 'Contributor'
        if (isViewer) return 'Viewer'
        return ''
    }, [isOperator, isContributor, isViewer])

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

    // Shared queue slides — contributed by non-operators
    const sharedQueueSlides = useMemo(() => {
        if (!sharedQueueSlideIds || sharedQueueSlideIds.length === 0) return []
        return sharedQueueSlideIds
            .map(id => activeSlides.find(slide => slide.id === id))
            .filter((slide): slide is Slide => slide !== undefined)
    }, [sharedQueueSlideIds, activeSlides])

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
    const liveHtml = liveSlide
        ? (liveSlide.type === 'bible' && liveSlide.contents[1]
            ? `${liveSlide.contents[0] || ''}${liveSlide.contents[1] || ''}`
            : (liveSlide.contents[0] || ''))
        : ''
    const nextUpHtml = nextSlide
        ? (nextSlide.type === 'bible' && nextSlide.contents[1]
            ? `${nextSlide.contents[0] || ''}${nextSlide.contents[1] || ''}`
            : (nextSlide.contents[0] || ''))
        : ''

    const handleSetLiveSlide = useCallback((slideId: string) => {
        setLiveSlide(slideId)

        // Sync to shared session if operator or open-mode contributor
        if (isConnected && (isOperator || isOpen)) {
            setLiveSlideShared(slideId)
        }

        // Send to live window via native API
        const slide = activeSlides.find(s => s.id === slideId)
        if (slide) {
            if (isDesktop) {
                sendSlideToLive(slideId, slide as unknown as Record<string, unknown>)
            }
            // Broadcast to other windows (for web mode)
            window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
        }
    }, [setLiveSlide, activeSlides, isDesktop, sendSlideToLive, isConnected, isOperator, isOpen, setLiveSlideShared])

    const handleSuggestNext = useCallback((slideId: string) => {
        if (!isConnected || isOperator) return
        addToQueue([slideId])
    }, [isConnected, isOperator, addToQueue])

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
    }, [nextSlide, prevSlide, handleSetLiveSlide])

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
    }, [liveOutputSlides, handleSetLiveSlide])

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
        <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
            {/* Header - Broadcast Controls */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isPresenting ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Program Output
                        </h2>
                    </div>
                    {isConnected && roleLabel && (
                        <span className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${
                            isOperator
                                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                : isContributor
                                ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                                : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                        }`}>
                            {isOperator && <Crown className="w-2.5 h-2.5" />}
                            {isContributor && <Shield className="w-2.5 h-2.5" />}
                            {roleLabel}
                        </span>
                    )}
                    {ndiRunning && (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded-full border border-purple-500/30">
                            NDI ACTIVE
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {ndiAvailable && (
                        <button
                            onClick={ndiRunning ? () => ndiStop() : () => ndiStart()}
                            className={`p-1.5 rounded transition-colors ${ndiRunning ? 'text-purple-400 bg-purple-400/10' : 'text-gray-400 hover:text-white'}`}
                            title="NDI Output"
                        >
                            <Radio className="w-4 h-4" />
                        </button>
                    )}
                    {isPresenting ? (
                        <button
                            onClick={handleStopLive}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-all"
                        >
                            STOP
                        </button>
                    ) : (
                        <button
                            onClick={handleOpenLive}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-teal)] hover:brightness-110 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-[var(--accent-teal)]/20"
                        >
                            <Presentation className="w-4 h-4" />
                            PRESENT
                        </button>
                    )}
                </div>
            </div>

            {/* Main Monitor Area */}
            <div className="flex-1 flex flex-col p-6 overflow-y-auto">
                {/* Primary Monitor */}
                <div className="space-y-4 max-w-5xl mx-auto w-full">
                    <div className="relative group">
                        <div className="absolute -top-6 left-0 text-[10px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                            Live Feed
                        </div>
                        <div className={`studio-live-monitor border border-gray-800 ring-1 ring-white/5 shadow-2xl ${liveSlide ? 'is-live' : ''}`}>
                            {liveSlide ? (
                                <div
                                    className="w-full h-full relative"
                                    style={{
                                        backgroundImage: !isLiveSlideVideo && liveSlideBackground ? `url(${liveSlideBackground})` : undefined,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                    }}
                                >
                                    {isLiveSlideVideo && (
                                        <video
                                            src={liveSlideBackground}
                                            className="absolute inset-0 w-full h-full object-cover"
                                            autoPlay loop muted playsInline
                                        />
                                    )}
                                    <div className="absolute inset-0 flex items-center justify-center p-[5%]">
                                        {liveSlide.type === 'countdown' ? (
                                            <div className="text-white font-mono font-bold tabular-nums drop-shadow-2xl" style={{ fontSize: '8vw' }}>
                                                {formatSecondsToTime(previewCountdownSeconds)}
                                            </div>
                                        ) : (
                                            <div
                                                className="text-white text-center drop-shadow-2xl tiptap-preview w-full"
                                                style={{ fontSize: '2.5vw' }}
                                                dangerouslySetInnerHTML={{ __html: liveHtml }}
                                            />
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]">
                                    <div className="w-16 h-16 rounded-full bg-[var(--accent-teal)]/5 flex items-center justify-center border border-[var(--accent-teal)]/10">
                                        <Monitor className="w-8 h-8 text-[var(--accent-teal)]/20" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm font-semibold text-[var(--text-primary)] opacity-40">Selah</p>
                                        <p className="text-[10px] text-[var(--text-muted)] mt-1">Nothing is live yet</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Shared Queue — contributions from non-operators */}
                    {isConnected && sharedQueueSlides.length > 0 && (
                        <div className="mt-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                                    Suggested ({sharedQueueSlides.length})
                                </div>
                                {isOperator && (
                                    <button
                                        onClick={() => {
                                            const queueIds = sharedQueueSlides.map(s => s.id)
                                            acceptFromQueue(queueIds)
                                        }}
                                        className="text-[10px] font-medium text-[var(--accent-teal)] hover:text-[var(--accent-teal)]/80 transition-colors"
                                    >
                                        Accept All
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-1">
                                {sharedQueueSlides.map((slide) => (
                                    <div
                                        key={slide.id}
                                        className="flex-shrink-0 w-32 bg-gray-800/50 border border-blue-500/20 rounded-lg p-2 group relative"
                                    >
                                        <div className="text-[10px] text-white/70 truncate">{slide.name}</div>
                                        <div className="text-[8px] text-blue-400 mt-0.5">
                                            {slide.type === 'bible' ? 'Bible' : slide.type === 'song' ? 'Song' : slide.type === 'hymn' ? 'Hymn' : 'Slide'}
                                        </div>
                                        {isOperator && (
                                            <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => acceptFromQueue([slide.id])}
                                                    className="p-0.5 bg-[var(--accent-teal)]/20 text-[var(--accent-teal)] rounded hover:bg-[var(--accent-teal)]/30"
                                                    title="Accept slide"
                                                >
                                                    <Check className="w-2.5 h-2.5" />
                                                </button>
                                                <button
                                                    onClick={() => removeFromQueue([slide.id])}
                                                    className="p-0.5 bg-rose-500/20 text-rose-400 rounded hover:bg-rose-500/30"
                                                    title="Dismiss slide"
                                                >
                                                    <X className="w-2.5 h-2.5" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Secondary/Next Preview & Controls Row */}
                    <div className="grid grid-cols-2 gap-6">
                        {/* Next Preview */}
                        <div className="space-y-2">
                            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Next Up</div>
                            <div className="aspect-video bg-gray-900 border border-gray-800 rounded-lg overflow-hidden relative opacity-60 grayscale-[0.5]">
                                {nextSlide ? (
                                    <div className="w-full h-full p-4 flex items-center justify-center">
                                        <div
                                            className="text-white/60 text-center text-[0.8vw] line-clamp-3"
                                            dangerouslySetInnerHTML={{ __html: nextUpHtml }}
                                        />
                                    </div>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-800 italic text-[10px]">
                                        End of Schedule
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Quick Telemetry & Shortcuts */}
                        <div className="flex flex-col justify-end gap-4">
                            <div className="bg-gray-800/50 rounded-xl p-4 border border-white/5">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">Active Slide</div>
                                        <div className="text-sm font-bold text-white truncate max-w-[150px]">
                                            {liveSlide?.name || 'None'}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">Position</div>
                                        <div className="text-sm font-mono text-white">
                                            {currentIndex >= 0 ? `${currentIndex + 1} / ${liveOutputSlides.length}` : '- / -'}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => prevSlide && handleSetLiveSlide(prevSlide.id)}
                                        disabled={!prevSlide || (!isOperator && isConnected && !isOpen)}
                                        className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-20 rounded-lg text-white transition-colors"
                                    >
                                        <ChevronUp className="w-5 h-5 mx-auto" />
                                    </button>
                                    {isConnected && !isOperator && !isOpen && nextSlide && (
                                        <button
                                            onClick={() => handleSuggestNext(nextSlide.id)}
                                            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-xs font-medium transition-colors flex items-center justify-center gap-1"
                                            title="Suggest this slide be queued next"
                                        >
                                            <Lightbulb className="w-4 h-4" />
                                            Suggest
                                        </button>
                                    )}
                                    <button
                                        onClick={() => nextSlide && handleSetLiveSlide(nextSlide.id)}
                                        disabled={!nextSlide || (!isOperator && isConnected && !isOpen)}
                                        className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-20 rounded-lg text-white transition-colors"
                                    >
                                        <ChevronDown className="w-5 h-5 mx-auto" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Screen Picker Modal */}
            {showScreenPicker && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <ScreenPicker
                        onSelect={handleScreenSelect}
                        onClose={() => setShowScreenPicker(false)}
                    />
                </div>
            )}
        </div>
    )
}
