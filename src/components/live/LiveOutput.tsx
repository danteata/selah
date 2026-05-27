import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Monitor, ChevronUp, ChevronDown, Radio, Presentation, Crown, Shield, Lightbulb, Check, X, Mic } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { useNdiOutput } from '../../hooks/useNdiOutput'
import { useLiveSession } from '../../hooks'
import { generateSlideContent } from '../../hooks/useSlideCreation'
import { useFileUrl } from '../../hooks/useTemplates'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import type { Slide, Scripture, Countdown } from '../../types'
import { SlideChip } from '../slides/SlideChip'
import { ScreenPicker } from './ScreenPicker'
import { BibleVerseNavigator } from '../bible/BibleVerseNavigator'
import { SermonListenerPanel } from '../sermon-listener/SermonListenerPanel'
import { useSermonListenerContext } from '../sermon-listener/SermonListenerContext'

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
    const sermonListener = useSermonListenerContext()
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const contextPanelOpen = useAppStore((s) => s.contextPanelOpen)

    // Hide sermon listener panel when the ContextPanel sidebar is already showing it
    const sermonShownInSidebar = activeNavSection === 'sermon' && contextPanelOpen

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
        isStrict,
        sessionScheduleId,
        collaborationMode,
        setLiveSlide: setLiveSlideShared,
        syncSlideContent,
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

        // Prefer session schedule while collaborating; fallback to selected schedule.
        const effectiveScheduleId = sessionScheduleId || activeSchedule?._id
        if (effectiveScheduleId) {
            return slides.filter(slide =>
                slide.scheduleId === effectiveScheduleId || !slide.scheduleId || slide.scheduleId === ''
            )
        }
        // If no active schedule, show all slides without a scheduleId
        return slides.filter(slide => !slide.scheduleId || slide.scheduleId === '')
    }, [liveOutputSlidesId, activeSlides, activeSchedule?._id, sessionScheduleId])

    // Shared queue slides — contributed by non-operators
    const sharedQueueSlides = useMemo(() => {
        if (!sharedQueueSlideIds || sharedQueueSlideIds.length === 0) return []
        return sharedQueueSlideIds
            .map((id, idx) => {
                const slide = activeSlides.find(s => s.id === id)
                if (!slide) return null
                return {
                    queueKey: `${id}-${idx}`,
                    slideId: id,
                    slide,
                }
            })
            .filter((entry): entry is { queueKey: string; slideId: string; slide: Slide } => entry !== null)
    }, [sharedQueueSlideIds, activeSlides])

    // Get live slide
    const liveSlide = useMemo(() => {
        return activeSlides.find(slide => slide.id === liveSlideId)
    }, [activeSlides, liveSlideId])

    // Get next/prev slide indices (used both for hook params and for reading slides)
    const currentIndex = useMemo(() => {
        return liveOutputSlides.findIndex(slide => slide.id === liveSlideId)
    }, [liveOutputSlides, liveSlideId])
    const nextSlide = liveOutputSlides[currentIndex + 1]
    const nextSlideStorageId = nextSlide?.backgroundStorageId || null

    // Get file URL for live slide and next slide backgrounds (hooks must be at top level)
    const liveSlideFileUrl = useFileUrl(liveSlide?.backgroundStorageId || null)
    const nextSlideFileUrl = useFileUrl(nextSlideStorageId)

    // Resolve local file paths on desktop
    const liveSlideLocalBg = useLocalBackground(liveSlide?.background, liveSlide?.localFilePath)
    const nextSlideLocalBg = useLocalBackground(nextSlide?.background, nextSlide?.localFilePath)

    // Determine the background URL for live slide
    const liveSlideBackground = liveSlideFileUrl || liveSlideLocalBg
    const isLiveSlideVideo = liveSlide?.backgroundType === 'video' && liveSlideBackground

    const prevSlide = liveOutputSlides[currentIndex - 1]

    // Determine the background URL for next slide preview
    const nextSlideBackground = nextSlideFileUrl || nextSlideLocalBg
    const isNextSlideVideo = nextSlide?.backgroundType === 'video' && nextSlideBackground
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
        if (isConnected && !isOperator && !isOpen) {
            return
        }

        setLiveSlide(slideId)

        if (isConnected) {
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

    // Handle open live with screen picker or auto-open
    const handleOpenLive = useCallback(async () => {
        if (liveOutputMonitorId && isDesktop) {
            await openLiveWindow({
                monitor_id: liveOutputMonitorId,
                fullscreen: true,
                decorations: false,
                always_on_top: true,
                initial_slide_id: liveSlideId || undefined,
            })
        } else if (!isDesktop && liveOutputMonitorId) {
            // Web mode with saved monitor preference
            await openLiveWindow({
                monitor_id: liveOutputMonitorId,
                fullscreen: true,
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
        } else {
            // Web mode: use Presentation API or popup window
            await openLiveWindow({
                monitor_id: screenId,
                fullscreen: true,
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

        void syncSlideContent(updatedSlide)
        if (isConnected) {
            void setLiveSlideShared(updatedSlide.id)
        }
    }, [liveSlide, generateSlideContent, isDesktop, sendSlideToLive, syncSlideContent, isConnected, setLiveSlideShared])

    return (
        <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
            {/* Header - Broadcast Controls */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/35">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${liveSlide ? 'bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.55)]' : 'bg-[var(--text-muted)]/60'}`} />
                        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
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
                        <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] rounded-full border border-[var(--accent-teal)]/20">
                            NDI ACTIVE
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {ndiAvailable && (
                        <button
                            onClick={ndiRunning ? () => ndiStop() : () => ndiStart()}
                            className={`p-1.5 rounded-lg transition-colors ${ndiRunning ? 'text-[var(--accent-teal)] bg-[var(--accent-teal)]/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title="NDI Output"
                        >
                            <Radio className="w-4 h-4" />
                        </button>
                    )}
                    {isPresenting ? (
                        <button
                            onClick={handleStopLive}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-red-500/20"
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

            {/* Main Content — Next Up + Controls on left, Live Feed on right */}
            <div className="flex-1 min-h-0 flex flex-col p-4 lg:p-5 gap-3">
                <div className="flex-1 min-h-0 flex gap-4 lg:gap-5">
                    {/* Left: Next Up + Active Slide controls + Sermon Listener */}
                    <aside className="studio-output-sidecar w-[320px] flex-shrink-0 flex flex-col gap-3 order-1">
                        {/* Next Up Preview — 16:9 aspect ratio */}
                        <div className="flex flex-col">
                            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.18em] mb-2">Next Up</div>
                            <div className="aspect-video rounded-xl overflow-hidden relative border border-[var(--border-subtle)] bg-black/30 shadow-sm">
                                {nextSlide ? (
                                    <div
                                        className="w-full h-full relative"
                                        style={{
                                            backgroundImage: !isNextSlideVideo && nextSlideBackground ? `url(${nextSlideBackground})` : undefined,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                            backgroundColor: !nextSlideBackground ? '#0a0a0a' : undefined,
                                        }}
                                    >
                                        {isNextSlideVideo && (
                                            <video
                                                src={nextSlideBackground}
                                                className="absolute inset-0 w-full h-full object-cover"
                                                autoPlay loop muted playsInline
                                            />
                                        )}
                                        <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/40">
                                            <div
                                                className="text-white/70 text-center text-sm line-clamp-3 drop-shadow-lg"
                                                dangerouslySetInnerHTML={{ __html: nextUpHtml }}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-black/30 text-[var(--text-muted)] italic text-[10px]">
                                        End of Schedule
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Active Slide Controls — always visible */}
                        <div className="flex-shrink-0 rounded-xl p-3 border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/45">
                            <div className="flex items-center justify-between mb-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.16em]">Active</div>
                                    <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                                        {liveSlide?.name || 'None'}
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0 ml-2">
                                    <div className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.16em]">Pos</div>
                                    <div className="text-xs font-mono text-[var(--text-primary)]">
                                        {currentIndex >= 0 ? `${currentIndex + 1}/${liveOutputSlides.length}` : '-/-'}
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-1.5">
                                <button
                                    onClick={() => prevSlide && handleSetLiveSlide(prevSlide.id)}
                                    disabled={!prevSlide || (!isOperator && isConnected && !isOpen)}
                                    className="flex-1 py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] disabled:opacity-25 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs font-medium border border-[var(--border-subtle)]"
                                >
                                    <ChevronUp className="w-4 h-4 mx-auto" />
                                </button>
                                {isConnected && !isOperator && !isOpen && !isStrict && nextSlide && (
                                    <button
                                        onClick={() => handleSuggestNext(nextSlide.id)}
                                        className="flex-1 py-1.5 bg-[var(--accent-teal)]/15 hover:bg-[var(--accent-teal)] text-[var(--accent-teal)] hover:text-white rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-1"
                                        title="Suggest this slide be queued next"
                                    >
                                        <Lightbulb className="w-3 h-3" />
                                        Suggest
                                    </button>
                                )}
                                <button
                                    onClick={() => nextSlide && handleSetLiveSlide(nextSlide.id)}
                                    disabled={!nextSlide || (!isOperator && isConnected && !isOpen)}
                                    className="flex-1 py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] disabled:opacity-25 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs font-medium border border-[var(--border-subtle)]"
                                >
                                    <ChevronDown className="w-4 h-4 mx-auto" />
                                </button>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70 p-2 overflow-hidden">
                            <div className="mb-2 flex items-center justify-between px-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                                    Sermon Listener
                                </span>
                            </div>
                            <div className="h-[calc(100%-1.25rem)] min-h-0 overflow-y-auto custom-scrollbar pr-1">
                                {sermonShownInSidebar ? (
                                    <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
                                        <Mic className={`w-5 h-5 ${sermonListener?.isListening ? 'text-red-500' : 'text-[var(--text-muted)]'}`} />
                                        {sermonListener?.isListening && (
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                                            </span>
                                        )}
                                        <p className="text-[10px] text-[var(--text-muted)]">
                                            {sermonListener?.isListening ? 'Recording — see sidebar' : 'Open in sidebar'}
                                        </p>
                                    </div>
                                ) : (
                                    <SermonListenerPanel compact />
                                )}
                            </div>
                        </div>
                    </aside>

                    {/* Right: Live Feed + contextual Bible navigator */}
                    <div className="flex-1 min-w-0 flex flex-col gap-3 order-2">
                        <div className="relative group flex-1 min-h-0 flex flex-col">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-[10px] font-bold text-red-500 uppercase tracking-[0.18em] flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                                    Live Output
                                </div>
                                <div className="text-[10px] font-medium text-[var(--text-muted)]">
                                    {liveSlide ? liveSlide.name : 'No slide on air'}
                                </div>
                            </div>
                            <div className={`flex-1 min-h-0 studio-live-monitor ${liveSlide ? 'is-live' : ''}`}>
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
                                                    className="text-white text-center drop-shadow-2xl tiptap-preview w-full max-w-full max-h-full overflow-y-auto"
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

                        {/* Bible verse navigation — only when a bible slide is live */}
                        {liveSlide?.type === 'bible' && (
                            <BibleVerseNavigator
                                currentSlide={liveSlide}
                                onVerseSelect={handleVerseSelect}
                            />
                        )}
                    </div>
                </div>

                {/* Shared Queue — contributions from non-operators */}
                {isConnected && sharedQueueSlides.length > 0 && (
                    <div className="flex-shrink-0 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                                Suggested ({sharedQueueSlides.length})
                            </div>
                            {isOperator && (
                                <button
                                    onClick={() => {
                                        const queueIds = sharedQueueSlides.map(s => s.slideId)
                                        acceptFromQueue(queueIds)
                                    }}
                                    className="text-[10px] font-medium text-[var(--accent-teal)] hover:text-[var(--accent-teal)]/80 transition-colors"
                                >
                                    Accept All
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {sharedQueueSlides.map((entry) => (
                                <div
                                    key={entry.queueKey}
                                    className="flex-shrink-0 w-32 bg-gray-800/50 border border-blue-500/20 rounded-lg p-2 group relative"
                                >
                                    <div className="text-[10px] text-white/70 truncate">{entry.slide.name}</div>
                                    <div className="text-[8px] text-blue-400 mt-0.5">
                                        {entry.slide.type === 'bible' ? 'Bible' : entry.slide.type === 'song' ? 'Song' : entry.slide.type === 'hymn' ? 'Hymn' : 'Slide'}
                                    </div>
                                    {isOperator && (
                                        <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => acceptFromQueue([entry.slideId])}
                                                className="p-0.5 bg-[var(--accent-teal)]/20 text-[var(--accent-teal)] rounded hover:bg-[var(--accent-teal)]/30"
                                                title="Accept slide"
                                            >
                                                <Check className="w-2.5 h-2.5" />
                                            </button>
                                            <button
                                                onClick={() => removeFromQueue([entry.slideId])}
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
