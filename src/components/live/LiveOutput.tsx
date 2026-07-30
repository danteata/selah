import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Monitor, ChevronUp, ChevronDown, Radio, Presentation, Crown, Shield, Lightbulb, Check, X, Plus, Eye, EyeOff, Rows3, Columns2, Maximize2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { useNdiOutput, NDI_LIVE_WINDOW_MISSING } from '../../hooks/useNdiOutput'
import { useEntitlements } from '../../providers/LicenseProvider'
import { toast } from 'sonner'
import { useLiveSession, useVerseNavigationShortcuts, useKeyboardShortcut } from '../../hooks'
import { generateSlideContent, calculateScreenFontSize } from '../../hooks/useSlideCreation'
import { useFileUrl } from '../../hooks/useTemplates'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import { useLocalMediaBlobUrl } from '../../hooks/useLocalMediaBlobUrl'
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventType } from '../../services/analytics/types'
import type { Slide, Scripture, Countdown, SlideStyle } from '../../types'
import { slideTypes, backgroundTypes } from '../../types'
import { SlideChip } from '../slides/SlideChip'
import { LocalMediaPlaceholder } from '../slides/LocalMediaPlaceholder'
import { ScreenPicker } from './ScreenPicker'
import { AutoFitText } from './AutoFitText'
import { KineticText } from './KineticText'
import { audioFeatures } from '../../services/visualizer/audioFeatures'
import { BibleVerseNavigator, type BibleVerseNavigatorHandle } from '../bible/BibleVerseNavigator'
import { SermonListenerPanel } from '../sermon-listener/SermonListenerPanel'
import { ContextSectionContent } from '../layout/ContextPanel'
import { VideoBackground } from './VideoBackground'
import { MediaContent, type MediaProgress } from './MediaContent'
import { AudioReactiveBackground } from './AudioReactiveBackground'
import { Play, Pause, Volume2, VolumeX, RotateCcw, Repeat } from 'lucide-react'
import { getVerseRefStyle } from '../../utils/verseRefStyle'
import { slideCaptionHtml } from '../../utils/slideCaption'

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
    const { trackEvent } = useAnalytics()
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const contextPanelOpen = useAppStore((s) => s.contextPanelOpen)
    const lastContentSection = useAppStore((s) => s.lastContentSection)

    // Hide sermon listener panel when the ContextPanel sidebar is already showing it
    const sermonShownInSidebar = activeNavSection === 'sermon' && contextPanelOpen

    const [ctrlOrMetaActive, setCtrlOrMetaActive] = useState(false)
    const [showScreenPicker, setShowScreenPicker] = useState(false)

    // Center layout mode — how Preview / Program / context are arranged:
    //  • 'stacked' — Next Up + Active + Sermon aside beside the feed
    //  • 'split'   — Preview | Program on top, tabbed context (Verses/Sermon) below
    //  • 'focus'   — the live feed maximized, side controls slimmed, context hidden
    // Held in the store (persisted) so a workspace preset can drive it, and the
    // header picker and preset stay in sync.
    const layoutMode = useAppStore((s) => s.liveOutputLayout)
    const setLayoutMode = useAppStore((s) => s.setLiveOutputLayout)

    // Countdown preview state
    const [previewCountdownSeconds, setPreviewCountdownSeconds] = useState(0)
    const previewIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Live media transport state — self-reported by the operator's own muted
    // preview player (see MediaContent's onProgress), used to drive the seek
    // bar. Not synced across windows; only explicit operator actions are.
    const [liveMediaProgress, setLiveMediaProgress] = useState<MediaProgress | null>(null)

    // Ref to the live bible verse navigator — lets the global
    // useVerseNavigationShortcuts hook trigger the navigator's `navigateVerse`
    // function (N / P / ← / →) without the navigator needing its own listener.
    const verseNavigatorRef = useRef<BibleVerseNavigatorHandle | null>(null)

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
        state: ndiState,
    } = useNdiOutput()
    const ndiSending = (ndiState?.framesSent ?? 0) > 0
    const { isPro, startProCheckout } = useEntitlements()


    const activeSchedule = useAppStore((state) => state.activeSchedule)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveOutputSlidesId = useAppStore((state) => state.liveOutputSlidesId)
    const sharedQueueSlideIds = useAppStore((state) => state.sharedQueueSlideIds)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const setLiveSlide = useAppStore((state) => state.setLiveSlide)
    const liveOutputBlanked = useAppStore((state) => state.liveOutputBlanked)
    const setLiveOutputBlanked = useAppStore((state) => state.setLiveOutputBlanked)
    const setLiveOutputSlidesId = useAppStore((state) => state.setLiveOutputSlidesId)
    const removeActiveSlide = useAppStore((state) => state.removeActiveSlide)
    const setEditingSlide = useAppStore((state) => state.setEditingSlide)
    const openModal = useAppStore((state) => state.openModal)
    // Global default for verse reference position (per-slide setting overrides this at render time).
    const globalVerseRefPosition = useAppStore((state) => state.settings.slideStyles?.verseRefPosition)
    // Global defaults for verse reference color/weight/style/underline/size (per-slide overrides at render time).
    const globalSlideStyles = useAppStore((state) => state.settings.slideStyles)
    const animationsEnabled = useAppStore((state) => state.settings.animations ?? true)
    const transitionInterval = useAppStore((state) => state.settings.transitionInterval ?? 0.7)
    const defaultFont = useAppStore((state) => state.settings.defaultFont || 'Inter')
    const visualizerEnabled = useAppStore((state) => state.visualizerEnabled)

    // Read the beat pulse once, exactly when the live slide changes (not on
    // every unrelated re-render) — a slide change landing right on a beat
    // gets a punchier entrance instead of the plain fade.
    const isBeatTransition = useMemo(
        () => visualizerEnabled && audioFeatures.beatPulse > 0.5,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [liveSlideId]
    )

    // Clear stale transport-bar progress from whatever media slide was
    // previously live.
    useEffect(() => {
        setLiveMediaProgress(null)
    }, [liveSlideId])

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
        toggleBlank,
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

    // Shared queue slides — contributed by non-operators.
    //
    // We keep the entry even if the slide isn't in `activeSlides` so the
    // operator always sees a contributor's queue update — including for
    // slides the contributor just created locally that haven't yet
    // round-tripped through Convex. When the slide data is missing we
    // render a lightweight placeholder instead of silently dropping the
    // entry (which is what previously made the queue look "stuck" on the
    // operator's side).
    const sharedQueueSlides = useMemo(() => {
        if (!sharedQueueSlideIds || sharedQueueSlideIds.length === 0) return []
        return sharedQueueSlideIds
            .map((id, idx) => {
                const slide = activeSlides.find(s => s.id === id)
                if (slide) {
                    return {
                        queueKey: `${id}-${idx}`,
                        slideId: id,
                        slide,
                    }
                }
                return {
                    queueKey: `${id}-${idx}`,
                    slideId: id,
                    slide: null,
                }
            })
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

    // Resolve local IndexedDB-backed media library items on web
    const liveSlideLocalMediaBlobUrl = useLocalMediaBlobUrl(liveSlide?.localMediaId)
    const nextSlideLocalMediaBlobUrl = useLocalMediaBlobUrl(nextSlide?.localMediaId)

    // Determine the background URL for live slide
    const liveSlideBackground = liveSlideFileUrl || liveSlideLocalBg || liveSlideLocalMediaBlobUrl
    const isLiveSlideVideo = liveSlide?.backgroundType === 'video' && liveSlideBackground

    const prevSlide = liveOutputSlides[currentIndex - 1]

    // Determine the background URL for next slide preview
    const nextSlideBackground = nextSlideFileUrl || nextSlideLocalBg || nextSlideLocalMediaBlobUrl
    const isNextSlideVideo = nextSlide?.backgroundType === 'video' && nextSlideBackground

    // Split slide HTML into body + reference for two-zone layout (matches LiveView).
    // For bible slides contents[1] is the "Book Chapter:Verse · Version" label;
    // for dictionary slides it is the "Headword · Pack" label.
    const liveBodyHtml = liveSlide?.contents[0] || ''
    const liveRefHtml = slideCaptionHtml(liveSlide)
    const nextUpBodyHtml = nextSlide?.contents[0] || ''
    const nextUpRefHtml = slideCaptionHtml(nextSlide)

    // Blank the live output to a plain black screen without touching
    // liveSlideId, so the queue position/selected slide is preserved and
    // un-blanking simply resumes showing it. Reaches the actual output
    // window via useLiveSync (native IPC + localStorage/BroadcastChannel),
    // and — when in a collaboration session — via the shared `isBlank` flag
    // so other connected viewers see the same thing (toggleBlank no-ops on
    // its own if not applicable, mirroring handleSetLiveSlide below).
    const handleToggleBlank = useCallback(() => {
        const next = !liveOutputBlanked
        setLiveOutputBlanked(next)
        void toggleBlank(next)
    }, [liveOutputBlanked, setLiveOutputBlanked, toggleBlank])

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
            trackEvent(AnalyticsEventType.SLIDE_DISPLAYED, {
                slide_type: slide.type || 'unknown',
                source: isConnected ? 'collaboration' : 'local',
                layout: slide.layout || 'full_text',
            })
            if (slide.layout === 'lower_third' || slide.layout === 'lower-third') {
                trackEvent(AnalyticsEventType.LOWER_THIRD_DISPLAYED, {
                    slide_id: slide.id,
                    title: slide.title,
                })
            }
            if (isDesktop) {
                sendSlideToLive(slideId, slide as unknown as Record<string, unknown>)
            }
            // Broadcast to other windows (for web mode)
            window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
        }
    }, [setLiveSlide, activeSlides, isDesktop, sendSlideToLive, isConnected, isOperator, isOpen, setLiveSlideShared, trackEvent])

    const handleSuggestNext = useCallback(async (slideId: string) => {
        if (!isConnected || isOperator) return
        try {
            await addToQueue([slideId])
        } catch (err) {
            console.error('[LiveOutput] Failed to queue slide:', err)
        }
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

    // Verse navigation (N / P / ← / →). Only active when a bible slide is
    // currently live so it never silently swallows keystrokes for non-bible
    // slides. Does NOT touch ArrowUp/ArrowDown, which are reserved for the
    // slide queue above.
    useVerseNavigationShortcuts(
        () => verseNavigatorRef.current?.navigateVerse('next'),
        () => verseNavigatorRef.current?.navigateVerse('prev'),
        { enabled: liveSlide?.type === 'bible' }
    )

    // "B" — clear/un-clear the live output to black (documented in
    // ShortcutsModal as "Black screen").
    useKeyboardShortcut('b', handleToggleBlank)

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
        trackEvent(AnalyticsEventType.SLIDE_DELETED, {
            slide_type: slide.type || 'unknown',
        })
        removeActiveSlide(slide)
    }, [removeActiveSlide, trackEvent])

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

    // NDI network streaming is Pro-only; free users get an upsell.
    const handleNdiToggle = useCallback(() => {
        if (ndiRunning) {
            void ndiStop()
            return
        }
        if (!isPro) {
            toast.warning('NDI output is a Selah Pro feature', {
                description: 'Upgrade to stream your live output over the network via NDI.',
                duration: 10000,
                action: { label: 'Upgrade', onClick: () => void startProCheckout() },
            })
            return
        }
        // The backend refuses for reasons the operator can act on — no Screen
        // Recording permission, no live output window open, no capture support on
        // this platform. `void ndiStart()` used to drop those on the floor as an
        // uncaught promise, so the most useful sentence in the feature only ever
        // appeared in the devtools console.
        void ndiStart().then((refusal) => {
            if (!refusal) return
            toast.error('NDI output could not start', {
                description: refusal.message,
                duration: 12000,
                // Nobody should have to know that NDI mirrors the live output
                // window, or that the order matters — offer the missing step.
                action: refusal.code === NDI_LIVE_WINDOW_MISSING
                    ? { label: 'Open live output', onClick: () => void handleOpenLive() }
                    : undefined,
            })
        })
    }, [ndiRunning, isPro, startProCheckout, ndiStart, ndiStop, handleOpenLive])

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
        trackEvent(AnalyticsEventType.COUNTDOWN_STARTED, {
            slide_id: liveSlide.id,
            duration_seconds: initialSeconds,
        })

        // Start ticking
        previewIntervalRef.current = setInterval(() => {
            setPreviewCountdownSeconds((prev) => {
                if (prev <= 1) {
                    clearInterval(previewIntervalRef.current!)
                    previewIntervalRef.current = null
                    trackEvent(AnalyticsEventType.COUNTDOWN_COMPLETED, {
                        slide_id: liveSlide.id,
                        duration_seconds: initialSeconds,
                    })
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveSlide?.id, liveSlide?.type])

    // Handle stop presenting
    const handleStopLive = useCallback(async () => {
        await closeLiveWindow()
    }, [closeLiveWindow])

    // Handle verse selection from BibleVerseNavigator
    const handleVerseSelect = useCallback((scripture: Scripture) => {
        if (!liveSlide || liveSlide.type !== 'bible') return

        // scripture.content already holds exactly the verses the navigator
        // selected (single verse, shift-clicked set, or dragged span), so
        // font size must be recomputed from it — otherwise a slide that
        // previously held a whole illegible range would keep that tiny
        // font size even after being narrowed down to one legible verse.
        const contentString = typeof scripture.content === 'string'
            ? scripture.content
            : Array.isArray(scripture.content)
                ? scripture.content.map((v) => v.scripture).join(' ')
                : ''
        const displayVerseNumbers = Array.isArray(scripture.content)
            ? scripture.content.map((v) => Number(v.verse))
            : undefined

        const updatedSlide = {
            ...liveSlide,
            name: scripture.label || liveSlide.name,
            data: scripture,
            contents: generateSlideContent(liveSlide, scripture),
            displayVerseNumbers,
            slideStyle: {
                ...liveSlide.slideStyle,
                fontSize: Number(calculateScreenFontSize(contentString)),
            },
        }

        const updateActiveSlide = useAppStore.getState().updateActiveSlide
        updateActiveSlide(updatedSlide)

        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updatedSlide }))

        if (isDesktop) {
            sendSlideToLive(liveSlide.id, updatedSlide as unknown as Record<string, unknown>)
        }

        void syncSlideContent(updatedSlide)
    }, [liveSlide, generateSlideContent, isDesktop, sendSlideToLive, syncSlideContent])

    // Push a media transport-control change (play/pause/seek/mute/loop) to
    // the live output window, through the same mutate-and-push channel used
    // for every other live slide edit.
    const handleMediaTransportChange = useCallback((patch: Partial<SlideStyle>) => {
        if (!liveSlide) return

        const updatedSlide = {
            ...liveSlide,
            slideStyle: {
                ...liveSlide.slideStyle,
                ...patch,
            },
        }

        const updateActiveSlide = useAppStore.getState().updateActiveSlide
        updateActiveSlide(updatedSlide)

        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updatedSlide }))

        if (isDesktop) {
            sendSlideToLive(liveSlide.id, updatedSlide as unknown as Record<string, unknown>)
        }
    }, [liveSlide, isDesktop, sendSlideToLive])

    // ── Extracted center-area pieces ─────────────────────────────────────
    // Defined once so the layout modes can place them in different spots (in
    // the aside for 'stacked', in the tabbed bottom for 'split', hidden for
    // 'focus') without duplicating markup.
    const sermonBox = !sermonShownInSidebar ? (
        <div className="studio-output-sermon min-h-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/70 p-2 overflow-hidden">
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    Sermon Listener
                </span>
            </div>
            <div className="h-[calc(100%-1.25rem)] min-h-0 overflow-y-auto custom-scrollbar pr-1">
                <SermonListenerPanel compact />
            </div>
        </div>
    ) : null

    const verseNav = liveSlide?.type === 'bible' ? (
        <BibleVerseNavigator
            ref={verseNavigatorRef}
            currentSlide={liveSlide}
            onVerseSelect={handleVerseSelect}
        />
    ) : null

    // Layout picker shown in the header — three arrangements of the center.
    const LAYOUT_OPTIONS = [
        { id: 'stacked' as const, label: 'Stacked', Icon: Rows3 },
        { id: 'split' as const, label: 'Split', Icon: Columns2 },
        { id: 'focus' as const, label: 'Focus', Icon: Maximize2 },
    ]
    const layoutPicker = (
        <div className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--bg-tertiary)]/60 border border-[var(--border-subtle)] flex-shrink-0">
            {LAYOUT_OPTIONS.map(({ id, label, Icon }) => (
                <button
                    key={id}
                    onClick={() => setLayoutMode(id)}
                    className={`p-1.5 rounded-md transition-colors ${
                        layoutMode === id
                            ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                    title={`${label} layout`}
                    aria-pressed={layoutMode === id}
                >
                    <Icon className="w-3.5 h-3.5" />
                </button>
            ))}
        </div>
    )

    // Split-layout context — both surfaces visible at once, no tabs. The verse
    // navigator sits as a short strip directly under the Preview | Program row
    // (only when a scripture is live); the Sermon Listener fills the rest as a
    // wider-but-shorter panel. Both stay in view.
    const splitContext = (
        <div className="studio-output-context flex-1 min-h-0 flex flex-col gap-3">
            {verseNav && (
                <div className="flex-shrink-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 overflow-hidden">
                    {verseNav}
                </div>
            )}
            {sermonShownInSidebar ? (
                // The sermon listener has taken the sidebar — show whatever it
                // displaced there (Bible, Songs, Media, …) in this freed slot, so
                // both stay visible at once.
                lastContentSection && lastContentSection !== 'sermon' ? (
                    <div className="flex-1 min-h-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 overflow-hidden">
                        <ContextSectionContent section={lastContentSection} />
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-center text-[11px] text-[var(--text-muted)] italic px-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40">
                        Sermon Listener is open in the sidebar.
                    </div>
                )
            ) : (
                sermonBox
            )}
        </div>
    )

    return (
        <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
            {/* Header - Broadcast Controls */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/35">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className={`shrink-0 w-2 h-2 rounded-full ${liveSlide ? 'bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.55)]' : 'bg-[var(--text-muted)]/60'}`} />
                        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)] truncate" title="Program Output">
                            Program Output
                        </h2>
                    </div>
                    {liveOutputBlanked && (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20">
                            <EyeOff className="w-2.5 h-2.5" />
                            OUTPUT CLEARED
                        </span>
                    )}
                    {isConnected && roleLabel && (
                        <span className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${isOperator
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
                        /* "Active" used to mean nothing more than "the sender was
                           created", which is how a black feed still read as ACTIVE.
                           It now follows the frames the sender has really pushed. */
                        ndiSending ? (
                            <span
                                title={`Sending ${ndiState?.framesSent?.toLocaleString() ?? 0} frames`}
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] rounded-full border border-[var(--accent-teal)]/20"
                            >
                                NDI ACTIVE
                            </span>
                        ) : (
                            <span
                                title="The NDI source is announced but no frames have been captured yet — receivers will show black."
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20"
                            >
                                NDI — NO FRAMES
                            </span>
                        )
                    )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    {layoutPicker}
                    {ndiAvailable && (
                        <button
                            onClick={handleNdiToggle}
                            className={`p-1.5 rounded-lg transition-colors ${ndiRunning ? 'text-[var(--accent-teal)] bg-[var(--accent-teal)]/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title={isPro ? 'NDI Output' : 'NDI Output (Pro)'}
                        >
                            <Radio className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={handleToggleBlank}
                        className={`flex items-center gap-1.5 p-1.5 rounded-lg transition-colors ${liveOutputBlanked
                            ? 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                            }`}
                        title={liveOutputBlanked ? 'Resume output (B)' : 'Clear output to black (B)'}
                    >
                        {liveOutputBlanked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    {isPresenting ? (
                        <button
                            onClick={handleStopLive}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-red-500/20 whitespace-nowrap flex-shrink-0"
                        >
                            STOP
                        </button>
                    ) : (
                        <button
                            onClick={handleOpenLive}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-teal)] hover:brightness-110 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-[var(--accent-teal)]/20 whitespace-nowrap flex-shrink-0"
                        >
                            <Presentation className="w-4 h-4 shrink-0" />
                            PRESENT
                        </button>
                    )}
                </div>
            </div>

            {/* Main Content — Next Up + Controls on left, Live Feed on right.
                This wrapper (not the panel root) is the query container so the
                fixed Screen Picker modal below isn't trapped by containment. */}
            <div className="studio-liveoutput flex-1 min-h-0 flex flex-col p-3 lg:p-3.5 gap-2.5" data-layout={layoutMode}>
                <div className="studio-output-main flex-1 min-h-0 flex gap-4 lg:gap-5">
                    {/* Left: Next Up + Active Slide controls + Sermon Listener.
                        Width/direction come from a container query (see
                        .studio-output-sidecar in index.css) so a narrow panel
                        stacks these above the feed instead of clipping. */}
                    <aside className="studio-output-sidecar flex-shrink-0 flex gap-3 order-1">
                        {/* Next Up Preview — 16:9. When the panel is narrow the
                            aside stacks above the feed; there Next Up widens to
                            fill the row (see .studio-output-nextup in index.css). */}
                        <div className="studio-output-nextup flex flex-col min-w-0">
                            <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.18em] mb-2">Next Up</div>
                            <div className="aspect-video rounded-xl overflow-hidden relative border border-[var(--border-subtle)] bg-black/30 shadow-sm">
                                {nextSlide ? (
                                    <div
                                        className="w-full h-full relative"
                                        style={{
                                            backgroundImage: nextSlide.type !== slideTypes.media && !isNextSlideVideo && nextSlideBackground ? `url(${nextSlideBackground})` : undefined,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                            backgroundColor: !nextSlideBackground ? '#0a0a0a' : undefined,
                                        }}
                                    >
                                        {nextSlide.type === slideTypes.media ? (
                                            nextSlide.backgroundType !== backgroundTypes.external && !nextSlideBackground ? (
                                                <LocalMediaPlaceholder backgroundType={nextSlide.backgroundType} />
                                            ) : (
                                                <MediaContent
                                                    slide={nextSlide}
                                                    src={nextSlideBackground || undefined}
                                                    muted
                                                    className="absolute inset-0 w-full h-full"
                                                />
                                            )
                                        ) : isNextSlideVideo && (
                                            <VideoBackground
                                                src={nextSlideBackground}
                                                className="absolute inset-0 w-full h-full object-cover"
                                            />
                                        )}
                                        {nextSlide.type === slideTypes.media ? null : nextSlide.layout === 'lower-third' ? (
                                            /* Lower-third Next Up — body in a bottom strip, reference/subtitle as caption */
                                            (() => {
                                                const isBibleNU = nextSlide.type === 'bible'
                                                const subtitleNU = nextSlide.slideStyle?.lowerThirdSubtitle || ''
                                                const captionNU = isBibleNU ? nextUpRefHtml : ''
                                                const captionOnTopNU = isBibleNU &&
                                                    (nextSlide.slideStyle?.verseRefPosition ?? globalVerseRefPosition ?? 'bottom') === 'top'

                                                const alignItemsNU = nextSlide.slideStyle?.lowerThirdPosition === 'center' ? 'center'
                                                    : nextSlide.slideStyle?.lowerThirdPosition === 'right' ? 'flex-end'
                                                        : 'flex-start'
                                                const textAlignNU = (nextSlide.slideStyle?.lowerThirdPosition as 'left' | 'center' | 'right') || 'left'

                                                const styleBarNU: React.CSSProperties =
                                                    nextSlide.slideStyle?.lowerThirdStyle === 'minimalist'
                                                        ? { background: 'transparent' }
                                                        : nextSlide.slideStyle?.lowerThirdStyle === 'accent-bar'
                                                            ? {
                                                                background: 'rgba(0,0,0,0.75)',
                                                                borderLeft: `2px solid ${nextSlide.slideStyle?.lowerThirdAccentColor || '#0d9488'}`,
                                                            }
                                                            : nextSlide.slideStyle?.lowerThirdStyle === 'gradient-bar'
                                                                ? {
                                                                    background: `linear-gradient(135deg, ${nextSlide.slideStyle?.lowerThirdAccentColor || '#0d9488'}ee, ${nextSlide.slideStyle?.lowerThirdAccentColor || '#0d9488'}88)`,
                                                                }
                                                                : { background: 'rgba(0,0,0,0.75)' }

                                                const captionElNU = (captionNU || subtitleNU) && (
                                                    <div
                                                        className="shrink-0 text-white/80 text-[8px] line-clamp-1 truncate"
                                                        style={{ width: '100%', textAlign: textAlignNU }}
                                                        {...(captionNU
                                                            ? { dangerouslySetInnerHTML: { __html: captionNU } }
                                                            : { children: subtitleNU })}
                                                    />
                                                )

                                                return (
                                                    <div className="absolute inset-x-0 bottom-0" style={{ height: '32%' }}>
                                                        <div
                                                            className="w-full h-full flex flex-col px-2 py-1"
                                                            style={{ alignItems: alignItemsNU, gap: '2px', ...styleBarNU }}
                                                        >
                                                            {captionOnTopNU && captionElNU}
                                                            <div
                                                                className="flex-1 min-h-0 text-white text-[10px] font-semibold drop-shadow-lg tiptap-preview line-clamp-2 leading-tight"
                                                                style={{ width: '100%', textAlign: textAlignNU }}
                                                                dangerouslySetInnerHTML={{ __html: nextUpBodyHtml }}
                                                            />
                                                            {!captionOnTopNU && captionElNU}
                                                        </div>
                                                    </div>
                                                )
                                            })()
                                        ) : (
                                            // Default branch — no opaque overlay so the slide's video/image bg
                                            // shows through. Text legibility is carried by drop-shadow-2xl and
                                            // a subtle vignette at the top/bottom edges only where the caption sits.
                                            <div className="absolute inset-0 flex flex-col p-3">
                                                {nextUpRefHtml && (nextSlide.slideStyle?.verseRefPosition ?? globalVerseRefPosition ?? 'bottom') === 'top' && (
                                                    <div
                                                        className="shrink-0 text-center pb-1 truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
                                                        style={getVerseRefStyle(nextSlide.slideStyle, globalSlideStyles, { minPx: 7, coefficient: 1.4, unit: 'cqw', maxPx: 13 })}
                                                        dangerouslySetInnerHTML={{ __html: nextUpRefHtml }}
                                                    />
                                                )}
                                                <AutoFitText
                                                    html={nextUpBodyHtml}
                                                    className="flex-1 min-h-0 text-white text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                                                    minPx={10}
                                                    maxPx={36}
                                                    style={{ lineHeight: 1.2 }}
                                                />
                                                {nextUpRefHtml && (nextSlide.slideStyle?.verseRefPosition ?? globalVerseRefPosition ?? 'bottom') !== 'top' && (
                                                    <div
                                                        className="shrink-0 text-center pt-1 truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
                                                        style={getVerseRefStyle(nextSlide.slideStyle, globalSlideStyles, { minPx: 7, coefficient: 1.4, unit: 'cqw', maxPx: 13 })}
                                                        dangerouslySetInnerHTML={{ __html: nextUpRefHtml }}
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-black/30 text-[var(--text-muted)] italic text-[10px] text-center leading-tight px-2">
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
                                {isConnected && !isOperator && !isStrict && nextSlide && (
                                    <button
                                        onClick={() => handleSuggestNext(nextSlide.id)}
                                        className="flex-1 py-1.5 bg-[var(--accent-teal)]/15 hover:bg-[var(--accent-teal)] text-[var(--accent-teal)] hover:text-white rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-1"
                                        title={isOpen ? 'Add this slide to the shared queue' : 'Suggest this slide for the operator to review'}
                                    >
                                        {isOpen ? (
                                            <>
                                                <Plus className="w-3 h-3" />
                                                Add
                                            </>
                                        ) : (
                                            <>
                                                <Lightbulb className="w-3 h-3" />
                                                Suggest
                                            </>
                                        )}
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

                        {/* Sermon Listener sits in the aside only in 'stacked'.
                            In 'split' it moves to the tabbed context below; in
                            'focus' it's hidden (still available in the sidebar). */}
                        {layoutMode === 'stacked' && sermonBox}
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
                                        key={liveSlide.id}
                                        className={`w-full h-full relative studio-slide-transition ${animationsEnabled ? '' : 'no-transition'} ${isBeatTransition ? 'beat-punch' : ''}`}
                                        style={{
                                            '--studio-transition-duration': `${isBeatTransition ? Math.min(transitionInterval, 0.35) : transitionInterval}s`,
                                            backgroundImage: liveSlide.type !== slideTypes.media && !isLiveSlideVideo && liveSlideBackground ? `url(${liveSlideBackground})` : undefined,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                        } as React.CSSProperties}
                                    >
                                        {liveSlide.type === slideTypes.media ? (
                                            liveSlide.backgroundType !== backgroundTypes.external && !liveSlideBackground ? (
                                                <LocalMediaPlaceholder backgroundType={liveSlide.backgroundType} />
                                            ) : (
                                                <MediaContent
                                                    slide={liveSlide}
                                                    src={liveSlideBackground || undefined}
                                                    muted
                                                    className="absolute inset-0 w-full h-full"
                                                    onProgress={setLiveMediaProgress}
                                                />
                                            )
                                        ) : isLiveSlideVideo && (
                                            <VideoBackground
                                                src={liveSlideBackground}
                                                className="absolute inset-0 w-full h-full object-cover"
                                            />
                                        )}
                                        <AudioReactiveBackground />
                                        {liveSlide.type === slideTypes.media ? null : liveSlide.type === 'countdown' ? (
                                            <div className="absolute inset-0 flex items-center justify-center p-6">
                                                <AutoFitText
                                                    html={formatSecondsToTime(previewCountdownSeconds)}
                                                    className="w-full h-full text-white font-mono font-bold tabular-nums drop-shadow-2xl"
                                                    minPx={24}
                                                    maxPx={320}
                                                    style={{ lineHeight: 1 }}
                                                />
                                            </div>
                                        ) : liveSlide.layout === 'lower-third' ? (
                                            /* Lower Third Preview — body auto-fits inside a bottom strip, reference as caption */
                                            (() => {
                                                const isBibleLT = liveSlide.type === 'bible'
                                                const subtitleLT = liveSlide.slideStyle?.lowerThirdSubtitle || ''
                                                const captionLT = isBibleLT ? liveRefHtml : ''
                                                const captionOnTopLT = isBibleLT &&
                                                    (liveSlide.slideStyle?.verseRefPosition ?? globalVerseRefPosition ?? 'bottom') === 'top'

                                                const alignItemsLT = liveSlide.slideStyle?.lowerThirdPosition === 'center' ? 'center'
                                                    : liveSlide.slideStyle?.lowerThirdPosition === 'right' ? 'flex-end'
                                                        : 'flex-start'
                                                const textAlignLT = (liveSlide.slideStyle?.lowerThirdPosition as 'left' | 'center' | 'right') || 'left'

                                                const styleBarLT: React.CSSProperties =
                                                    liveSlide.slideStyle?.lowerThirdStyle === 'minimalist'
                                                        ? { background: 'transparent' }
                                                        : liveSlide.slideStyle?.lowerThirdStyle === 'accent-bar'
                                                            ? {
                                                                background: 'rgba(0,0,0,0.75)',
                                                                backdropFilter: 'blur(8px)',
                                                                borderLeft: `3px solid ${liveSlide.slideStyle?.lowerThirdAccentColor || '#0d9488'}`,
                                                            }
                                                            : liveSlide.slideStyle?.lowerThirdStyle === 'gradient-bar'
                                                                ? {
                                                                    background: `linear-gradient(135deg, ${liveSlide.slideStyle?.lowerThirdAccentColor || '#0d9488'}ee, ${liveSlide.slideStyle?.lowerThirdAccentColor || '#0d9488'}88)`,
                                                                    backdropFilter: 'blur(8px)',
                                                                }
                                                                : {
                                                                    background: 'rgba(0,0,0,0.75)',
                                                                    backdropFilter: 'blur(8px)',
                                                                }

                                                const captionNodeLT = (captionLT || subtitleLT) && (
                                                    <div
                                                        className="shrink-0 drop-shadow-lg"
                                                        style={{
                                                            fontFamily: liveSlide.slideStyle?.font || defaultFont,
                                                            lineHeight: 1.25,
                                                            width: '100%',
                                                            textAlign: textAlignLT,
                                                            ...getVerseRefStyle(liveSlide.slideStyle, globalSlideStyles, { minPx: 14, coefficient: 3, unit: 'cqw', maxPx: 36 }),
                                                        }}
                                                        {...(captionLT
                                                            ? { dangerouslySetInnerHTML: { __html: captionLT } }
                                                            : { children: subtitleLT })}
                                                    />
                                                )

                                                return (
                                                    <div
                                                        className="absolute inset-x-0 bottom-0"
                                                        style={{ height: '30cqh' }}
                                                    >
                                                        <div
                                                            className="w-full h-full flex flex-col"
                                                            style={{
                                                                alignItems: alignItemsLT,
                                                                padding: '10px 18px',
                                                                gap: '4px',
                                                                ...styleBarLT,
                                                            }}
                                                        >
                                                            {captionOnTopLT && captionNodeLT}
                                                            <KineticText enabled={visualizerEnabled} className="w-full flex-1 min-h-0">
                                                                <AutoFitText
                                                                    html={liveBodyHtml}
                                                                    className="w-full h-full text-white drop-shadow-lg tiptap-preview"
                                                                    minPx={10}
                                                                    maxPx={120}
                                                                    style={{
                                                                        fontFamily: liveSlide.slideStyle?.font || defaultFont,
                                                                        textAlign: textAlignLT,
                                                                        fontWeight: 600,
                                                                        lineHeight: 1.2,
                                                                    }}
                                                                />
                                                            </KineticText>
                                                            {!captionOnTopLT && captionNodeLT}
                                                        </div>
                                                    </div>
                                                )
                                            })()
                                        ) : (
                                            <div className="absolute inset-0 flex flex-col p-6">
                                                {liveRefHtml && (liveSlide.slideStyle?.verseRefPosition ?? globalVerseRefPosition ?? 'bottom') === 'top' && (
                                                    <div
                                                        className="shrink-0 text-center pb-2 drop-shadow-lg"
                                                        style={{
                                                            fontFamily: liveSlide.slideStyle?.font || defaultFont,
                                                            lineHeight: 1.05,
                                                            // cqw (not vw) so the reference scales with the preview
                                                            // box, and a low px floor so it doesn't dominate the
                                                            // small monitor — matches the output's 2.4vw proportion.
                                                            ...getVerseRefStyle(liveSlide.slideStyle, globalSlideStyles, { minPx: 8, coefficient: 2.4, unit: 'cqw', maxPx: 28 }),
                                                        }}
                                                        dangerouslySetInnerHTML={{ __html: liveRefHtml }}
                                                    />
                                                )}
                                                <KineticText enabled={visualizerEnabled} className="flex-1 min-h-0">
                                                    <AutoFitText
                                                        html={liveBodyHtml}
                                                        className="w-full h-full text-white text-center drop-shadow-2xl tiptap-preview"
                                                        minPx={14}
                                                        maxPx={240}
                                                        style={{
                                                            fontFamily: liveSlide.slideStyle?.font || defaultFont,
                                                            textAlign: (liveSlide.slideStyle?.alignment as 'left' | 'center' | 'right') || 'center',
                                                            textTransform: (liveSlide.slideStyle?.lettercase as 'uppercase' | 'lowercase' | 'capitalize' | 'none') || 'none',
                                                            lineHeight: 1.0,
                                                            textShadow: liveSlide.slideStyle?.textOutlined ? '2px 2px 4px rgba(0,0,0,0.8)' : undefined,
                                                        }}
                                                    />
                                                </KineticText>
                                                {liveRefHtml && (liveSlide.slideStyle?.verseRefPosition ?? globalVerseRefPosition ?? 'bottom') !== 'top' && (
                                                    <div
                                                        className="shrink-0 text-center pt-2 drop-shadow-lg"
                                                        style={{
                                                            fontFamily: liveSlide.slideStyle?.font || defaultFont,
                                                            lineHeight: 1.05,
                                                            // cqw (not vw) so the reference scales with the preview
                                                            // box, and a low px floor so it doesn't dominate the
                                                            // small monitor — matches the output's 2.4vw proportion.
                                                            ...getVerseRefStyle(liveSlide.slideStyle, globalSlideStyles, { minPx: 8, coefficient: 2.4, unit: 'cqw', maxPx: 28 }),
                                                        }}
                                                        dangerouslySetInnerHTML={{ __html: liveRefHtml }}
                                                    />
                                                )}
                                            </div>
                                        )}
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

                        {/* Media transport controls — only when a media video (local or embedded) is live */}
                        {liveSlide?.type === slideTypes.media &&
                            (liveSlide.backgroundType === backgroundTypes.video || liveSlide.backgroundType === backgroundTypes.external) && (
                                <div className="flex-shrink-0">
                                <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.18em] mb-2">Media Controls</div>
                                <div className="rounded-xl p-2.5 border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/45 flex items-center gap-2">
                                    <button
                                        onClick={() => handleMediaTransportChange({ isMediaPlaying: liveSlide.slideStyle?.isMediaPlaying === false })}
                                        className="p-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] text-[var(--text-primary)] flex-shrink-0"
                                        title={liveSlide.slideStyle?.isMediaPlaying === false ? 'Play' : 'Pause'}
                                    >
                                        {liveSlide.slideStyle?.isMediaPlaying === false
                                            ? <Play className="w-4 h-4" />
                                            : <Pause className="w-4 h-4" />}
                                    </button>

                                    {liveSlide.backgroundType === backgroundTypes.video && (
                                        <>
                                            <button
                                                onClick={() => handleMediaTransportChange({ mediaSeekPosition: 0, isMediaPlaying: true })}
                                                className="p-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] text-[var(--text-primary)] flex-shrink-0"
                                                title="Restart"
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                            </button>
                                            <input
                                                type="range"
                                                min={0}
                                                max={liveMediaProgress?.duration || 0}
                                                step={0.1}
                                                value={liveMediaProgress?.currentTime || 0}
                                                onChange={(e) => handleMediaTransportChange({ mediaSeekPosition: Number(e.target.value) })}
                                                className="flex-1 accent-[var(--accent-teal)] min-w-0"
                                            />
                                            <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums flex-shrink-0 w-20 text-right">
                                                {formatSecondsToTime(Math.floor(liveMediaProgress?.currentTime || 0))} / {formatSecondsToTime(Math.floor(liveMediaProgress?.duration || 0))}
                                            </span>
                                            <button
                                                onClick={() => handleMediaTransportChange({ repeatMedia: !(liveSlide.slideStyle?.repeatMedia ?? false) })}
                                                className={`p-2 rounded-lg flex-shrink-0 hover:brightness-110 ${liveSlide.slideStyle?.repeatMedia ? 'bg-[var(--accent-teal)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}
                                                title="Loop"
                                            >
                                                <Repeat className="w-4 h-4" />
                                            </button>
                                        </>
                                    )}

                                    <button
                                        onClick={() => handleMediaTransportChange({ isMediaMuted: !(liveSlide.slideStyle?.isMediaMuted ?? false) })}
                                        className="p-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] text-[var(--text-primary)] flex-shrink-0"
                                        title={liveSlide.slideStyle?.isMediaMuted ? 'Unmute' : 'Mute'}
                                    >
                                        {liveSlide.slideStyle?.isMediaMuted
                                            ? <VolumeX className="w-4 h-4" />
                                            : <Volume2 className="w-4 h-4" />}
                                    </button>
                                </div>
                                </div>
                            )}

                        {/* Verse navigator sits under the feed only in 'stacked';
                            'split' moves it into the tabbed context below. */}
                        {layoutMode === 'stacked' && verseNav}
                    </div>
                </div>

                {/* Split layout: tabbed context (Verses / Sermon) below the top row. */}
                {layoutMode === 'split' && splitContext}

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
                                    {entry.slide ? (
                                        <>
                                            <div className="text-[10px] text-white/70 truncate">{entry.slide.name}</div>
                                            <div className="text-[8px] text-blue-400 mt-0.5">
                                                {entry.slide.type === 'bible' ? 'Bible' : entry.slide.type === 'song' ? 'Song' : entry.slide.type === 'hymn' ? 'Hymn' : entry.slide.type === 'dictionary' ? 'Definition' : 'Slide'}
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="text-[10px] text-white/40 truncate italic">Pending slide</div>
                                            <div className="text-[8px] text-blue-400/60 mt-0.5">Syncing…</div>
                                        </>
                                    )}
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
