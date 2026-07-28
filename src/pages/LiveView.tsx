import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useQuery } from 'convex/react'
import { useAuth } from '@clerk/clerk-react'
import { api } from '../../convex/_generated/api'
import type { Slide, Countdown } from '../types'
import { slideTypes } from '../types'
import { useFileUrl } from '../hooks/useTemplates'
import { useLocalBackground } from '../hooks/useLocalBackground'
import { useLocalMediaBlobUrl } from '../hooks/useLocalMediaBlobUrl'
import { nativeMultiMonitorService } from '../services/native-multi-monitor'
import { AutoFitText } from '../components/live/AutoFitText'
import { VideoBackground } from '../components/live/VideoBackground'
import { MediaContent } from '../components/live/MediaContent'
import { AudioReactiveBackground } from '../components/live/AudioReactiveBackground'
import { KineticText } from '../components/live/KineticText'
import { startNativeAudioFeatures } from '../services/visualizer/nativeAudioFeatures'
import { audioFeatures } from '../services/visualizer/audioFeatures'
import { useAnalytics } from '../hooks'
import { AnalyticsEventType } from '../services/analytics/types'
import { getVerseRefStyle } from '../utils/verseRefStyle'
import { isCaptionedSlideType, slideCaptionHtml } from '../utils/slideCaption'

const STORAGE_KEY = 'selah-live-state'

interface LiveState {
    slides: Slide[]
    liveSlideId: string | null
    settings: {
        liveWindowFullscreen: boolean
        songAndHymnLabelsVisibility: boolean
        defaultFont: string
        verseRefPosition?: 'top' | 'bottom'
        verseRefColor?: string
        verseRefBold?: boolean
        verseRefItalic?: boolean
        verseRefUnderline?: boolean
        verseRefSizePercent?: number
        animations?: boolean
        transitionInterval?: number
        visualizerEnabled?: boolean
        liveOutputBlanked?: boolean
    }
    overlay?: string
    alert?: unknown
}

export default function LiveView() {
    const [searchParams] = useSearchParams()
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [currentSlideId, setCurrentSlideId] = useState(searchParams.get('slide') || '')
    const [liveState, setLiveState] = useState<LiveState | null>(null)
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
    const [isDesktop, setIsDesktop] = useState(false)
    const { trackPage, trackEvent } = useAnalytics()

    const [flashColor, setFlashColor] = useState<string | null>(null)
    const monitorId = searchParams.get('monitorId') || null
    const monitorColor = searchParams.get('monitorColor') || null
    const monitorName = searchParams.get('monitorName') || null

    const { isSignedIn } = useAuth()
    const sessionId = searchParams.get('session')

    // Track page view on mount
    useEffect(() => {
        trackPage('/live', { has_session: !!sessionId })
    }, [trackPage, sessionId])

    const sharedSession = useQuery(
        api.liveSessions.getSession,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isSignedIn && sessionId ? { sessionId: sessionId as any } : 'skip'
    )

    const sessionSlides = useQuery(
        api.slides.getSlides,
        isSignedIn && sharedSession?.status === 'active' && sharedSession.scheduleId
            ? { scheduleId: sharedSession.scheduleId }
            : 'skip'
    )

    const [countdownSeconds, setCountdownSeconds] = useState<number>(0)
    const [countdownPaused, setCountdownPaused] = useState(false)
    const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const previousSessionSlideRef = useRef<string | null>(null)

    const sessionSlideId = useMemo(() => {
        if (!sharedSession || sharedSession.status !== 'active') return null
        if (sharedSession.isBlank) return ''
        return sharedSession.liveSlideId || null
    }, [sharedSession])

    useEffect(() => {
        if (sessionSlideId !== null && sessionSlideId !== previousSessionSlideRef.current) {
            previousSessionSlideRef.current = sessionSlideId
            requestAnimationFrame(() => setCurrentSlideId(sessionSlideId))
        }
    }, [sessionSlideId])

    // Initialize desktop mode and native event listeners
    useEffect(() => {
        const init = async () => {
            const desktop = await nativeMultiMonitorService.isDesktop()
            setIsDesktop(desktop)

            if (desktop) {
                // Listen for native slide updates
                const unlistenSlide = await nativeMultiMonitorService.onLiveWindowEvent<{
                    slideId: string
                    slideData?: Slide
                }>('slide-update', (payload) => {
                    setCurrentSlideId(payload.slideId)
                    if (payload.slideData) {
                        setLiveState(prev => {
                            if (!prev) return prev
                            const slides = prev.slides.map(s =>
                                s.id === payload.slideId ? payload.slideData! : s
                            )
                            return { ...prev, slides }
                        })
                    }
                })

                // Listen for clear output events
                const unlistenClear = await nativeMultiMonitorService.onLiveWindowEvent<{
                    mode: string
                }>('clear-output', () => {
                    setCurrentSlideId('')
                })

                // Listen for display-settings updates (font, verse ref
                // position, etc.) — the desktop live window is a separate
                // native WebviewWindow, so it can't rely on the
                // BroadcastChannel/localStorage path below to receive
                // settings changes made after it opened.
                const unlistenSettings = await nativeMultiMonitorService.onLiveWindowEvent<{
                    settings: LiveState['settings']
                }>('settings-update', (payload) => {
                    setLiveState(prev => ({
                        slides: prev?.slides ?? [],
                        liveSlideId: prev?.liveSlideId ?? null,
                        settings: payload.settings,
                        overlay: prev?.overlay,
                        alert: prev?.alert,
                    }))
                })

                // The audio-reactive visualizer's `audioFeatures` bus is
                // per-window state — Rust broadcasts `audio-features` to
                // every window, but only whichever window actually calls
                // `startNativeAudioFeatures()` gets its own bus fed. The
                // Sermon Listener panel (and its call to this) only lives in
                // the main operator window, so without this the separate
                // live/projector window's copy of the bus stays permanently
                // stale and AudioReactiveBackground never draws anything.
                const unlistenAudioFeatures = await startNativeAudioFeatures()

                return () => {
                    unlistenSlide()
                    unlistenClear()
                    unlistenSettings()
                    unlistenAudioFeatures()
                }
            }
            return () => { }
        }

        let cleanup: (() => void) | undefined
        init().then(fn => { cleanup = fn })

        return () => {
            cleanup?.()
        }
    }, [])

    // Shared session state takes precedence when sessionId is provided
    const isSessionMode = Boolean(sessionId && isSignedIn && sharedSession?.status === 'active')

    // Initialize BroadcastChannel for cross-window communication
    useEffect(() => {
        if (isSessionMode) return // Don't use localBroadcast when in shared session mode

        broadcastChannelRef.current = new BroadcastChannel('selah-live-channel')

        broadcastChannelRef.current.onmessage = (event) => {
            if (event.data?.type === 'state-update') {
                setLiveState(event.data.state)
                if (event.data.state.liveSlideId) {
                    setCurrentSlideId(event.data.state.liveSlideId)
                }
            } else if (event.data?.type === 'slide-update') {
                setCurrentSlideId(event.data.slideId)
            }
        }

        // Listen for monitor identification flashes (web mode)
        const flashChannel = new BroadcastChannel('selah-monitor-flash')
        flashChannel.onmessage = (event) => {
            const { color, monitorId: targetMonitorId } = event.data || {}
            if (targetMonitorId && monitorId && targetMonitorId !== monitorId) return
            if (color) {
                setFlashColor(color)
                setTimeout(() => setFlashColor(null), 2000)
            }
        }

        // Load initial state from localStorage
        const storedState = localStorage.getItem(STORAGE_KEY)
        if (storedState) {
            try {
                const parsed = JSON.parse(storedState)
                setLiveState(parsed)
                if (!currentSlideId && parsed.liveSlideId) {
                    setCurrentSlideId(parsed.liveSlideId)
                }
            } catch (e) {
                console.error('Failed to parse stored state:', e)
            }
        }

        // Listen for storage events (from other windows)
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY && e.newValue) {
                try {
                    const parsed = JSON.parse(e.newValue)
                    setLiveState(parsed)
                } catch (err) {
                    console.error('Failed to parse storage event:', err)
                }
            }
        }

        window.addEventListener('storage', handleStorageChange)

        return () => {
            broadcastChannelRef.current?.close()
            flashChannel.close()
            window.removeEventListener('storage', handleStorageChange)
        }
    }, [isSessionMode, currentSlideId, monitorId])

    const resolvedSlides = useMemo(() => {
        if (isSessionMode) {
            return (sessionSlides || []) as Slide[]
        }
        return liveState?.slides || []
    }, [isSessionMode, sessionSlides, liveState?.slides])

    // Get current live slide
    const slide = useMemo(() => {
        if (!resolvedSlides.length) return null
        return resolvedSlides.find(s => s.id === currentSlideId) || null
    }, [resolvedSlides, currentSlideId])

    // Get file URL if slide has a backgroundStorageId
    const fileUrl = useFileUrl(slide?.backgroundStorageId || null)

    // Resolve local file paths on desktop
    const localBg = useLocalBackground(slide?.background, slide?.localFilePath)

    // Resolve a local IndexedDB-backed media library item on web
    const localMediaBlobUrl = useLocalMediaBlobUrl(slide?.localMediaId)

    // Determine the background to use
    const backgroundUrl = fileUrl || localBg || localMediaBlobUrl
    const isVideoBackground = slide?.backgroundType === 'video' && backgroundUrl

    const settings = liveState?.settings || {
        liveWindowFullscreen: false,
        songAndHymnLabelsVisibility: true,
        defaultFont: 'Inter',
        animations: true,
        transitionInterval: 0.7,
    }

    // Toggle fullscreen
    const toggleFullscreen = useCallback(async () => {
        if (isDesktop) {
            // Use native fullscreen toggle
            await nativeMultiMonitorService.toggleLiveFullscreen()
            setIsFullscreen(prev => !prev)
        } else {
            // Use web fullscreen API
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen()
                setIsFullscreen(true)
            } else {
                document.exitFullscreen()
                setIsFullscreen(false)
            }
        }
    }, [isDesktop])

    // Listen for fullscreen changes (web mode)
    useEffect(() => {
        if (isDesktop) return

        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }

        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [isDesktop])

    // Auto-enter fullscreen if setting is enabled (web mode)
    useEffect(() => {
        if (isDesktop || !settings.liveWindowFullscreen) return

        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {
                // Ignore errors (user may have denied permission)
            })
        }
    }, [settings.liveWindowFullscreen, isDesktop])

    // Parse "HH:MM:SS" time string into total seconds
    const parseTimeToSeconds = useCallback((timeStr: string): number => {
        const parts = timeStr.split(':').map(Number)
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        } else if (parts.length === 2) {
            return parts[0] * 60 + parts[1]
        }
        return 0
    }, [])

    // Initialize countdown when a countdown slide becomes active
    useEffect(() => {
        if (!slide || slide.type !== 'countdown') {
            // Clean up interval if not a countdown slide
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current)
                countdownIntervalRef.current = null
            }
            return
        }

        // Parse the total seconds from the slide data
        const countdownData = slide.data as Countdown | undefined
        const timeStr = countdownData?.time || slide.contents[1] || '00:05:00'
        const totalSeconds = parseTimeToSeconds(timeStr)

        setCountdownSeconds(totalSeconds)
        setCountdownPaused(false)
    }, [slide?.id, slide?.type]) // Re-initialize when the slide changes

    // Run the countdown interval
    useEffect(() => {
        if (!slide || slide.type !== 'countdown' || countdownPaused) {
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current)
                countdownIntervalRef.current = null
            }
            return
        }

        countdownIntervalRef.current = setInterval(() => {
            setCountdownSeconds((prev) => {
                if (prev <= 1) {
                    clearInterval(countdownIntervalRef.current!)
                    countdownIntervalRef.current = null
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => {
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current)
                countdownIntervalRef.current = null
            }
        }
    }, [slide?.id, slide?.type, countdownPaused])

    // Format seconds into HH:MM:SS or MM:SS
    const formatCountdownTime = useCallback((totalSeconds: number): string => {
        const h = Math.floor(totalSeconds / 3600)
        const m = Math.floor((totalSeconds % 3600) / 60)
        const s = totalSeconds % 60
        const pad = (n: number) => String(n).padStart(2, '0')
        if (h > 0) {
            return `${pad(h)}:${pad(m)}:${pad(s)}`
        }
        return `${pad(m)}:${pad(s)}`
    }, [])

    // Keyboard shortcut for fullscreen (F key)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && document.fullscreenElement) {
                document.exitFullscreen()
                return
            }
            const el = document.activeElement
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.getAttribute('contenteditable') === 'true') return
            if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                toggleFullscreen()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [toggleFullscreen])

    // Read the beat pulse once, exactly when the slide changes (not on every
    // unrelated re-render) — a slide change landing right on a beat gets a
    // punchier entrance instead of the plain fade.
    const isBeatTransition = useMemo(
        () => (settings.visualizerEnabled ?? false) && audioFeatures.beatPulse > 0.5,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [slide?.id]
    )

    // Nothing selected yet (distinct from a deliberate "Clear" — see the
    // liveOutputBlanked guard around the Content section below, which keeps
    // the current slide's background so the audience sees the projector is
    // live, just without text). The audience should see a plain black
    // screen here, not operator-facing debug text. Only the monitor-identify
    // badge (used while setting up multi-monitor output) is worth keeping.
    if (!slide) {
        return (
            <div
                className="h-screen bg-black relative"
                style={monitorColor ? { boxShadow: `inset 0 0 0 3px ${monitorColor}` } : undefined}
            >
                {monitorColor && monitorName && (
                    <div
                        className="absolute top-3 left-3 px-3 py-1.5 rounded-md text-xs font-semibold text-white z-40"
                        style={{ backgroundColor: monitorColor + 'CC' }}
                    >
                        {monitorName}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div
            key={slide?.id}
            className={`h-screen w-screen bg-black relative overflow-hidden studio-slide-transition ${settings.animations === false ? 'no-transition' : ''} ${isBeatTransition ? 'beat-punch' : ''}`}
            style={
                {
                    ...(monitorColor ? { boxShadow: `inset 0 0 0 3px ${monitorColor}` } : {}),
                    '--studio-transition-duration': `${isBeatTransition ? Math.min(settings.transitionInterval ?? 0.7, 0.35) : (settings.transitionInterval ?? 0.7)}s`,
                } as React.CSSProperties
            }
            onDoubleClick={toggleFullscreen}
        >
            {/* Background */}
            {slide.type === slideTypes.media ? (
                /* Media slides render their own full-bleed content below —
                   no dimming filter, since the media IS the content, not a
                   backdrop for text. */
                <div className="absolute inset-0 bg-black" />
            ) : isVideoBackground && backgroundUrl ? (
                <VideoBackground
                    src={backgroundUrl}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{
                        filter: `blur(${slide.slideStyle?.blur || 0}px) brightness(${slide.slideStyle?.brightness || 50}%)`
                    }}
                />
            ) : backgroundUrl ? (
                <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                        backgroundImage: `url(${backgroundUrl})`,
                        filter: `blur(${slide.slideStyle?.blur || 0}px) brightness(${slide.slideStyle?.brightness || 50}%)`
                    }}
                />
            ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-black" />
            )}

            {/* Audio-reactive motion layer (behind lyrics). Passes the synced
                `visualizerEnabled` explicitly — this window's own Zustand
                store only hydrates from localStorage at load time and won't
                see the operator toggling it live in the main window. */}
            <AudioReactiveBackground enabled={settings.visualizerEnabled ?? false} />

            {/* Content — suppressed while the operator has "Cleared" the
                output, keeping the background above so the audience still
                sees the projector is live, just with the text/media hidden
                rather than looking like nothing is being sent at all. */}
            {!settings.liveOutputBlanked && (slide.type === slideTypes.media ? (
                <MediaContent
                    slide={slide}
                    src={backgroundUrl || undefined}
                    className="absolute inset-0 w-full h-full"
                />
            ) : slide.layout === 'lower-third' ? (
                /* Lower Third Layout — strip anchored to the bottom; body auto-fits, caption stays small */
                (() => {
                    const isBible = isCaptionedSlideType(slide.type)
                    const bodyHtml = slide.contents[0] || ''
                    const captionHtml = slideCaptionHtml(slide)
                    const subtitle = slide.slideStyle?.lowerThirdSubtitle || ''
                    // Per-slide setting wins, then global default from settings, then 'bottom'.
                    const effectiveRefPos = slide.slideStyle?.verseRefPosition ?? settings.verseRefPosition ?? 'bottom'
                    const captionOnTop = isBible && effectiveRefPos === 'top'

                    const alignItems = slide.slideStyle?.lowerThirdPosition === 'center' ? 'center'
                        : slide.slideStyle?.lowerThirdPosition === 'right' ? 'flex-end'
                            : 'flex-start'
                    const textAlign = (slide.slideStyle?.lowerThirdPosition as 'left' | 'center' | 'right') || 'left'

                    const styleBar: React.CSSProperties =
                        slide.slideStyle?.lowerThirdStyle === 'minimalist'
                            ? { background: 'transparent' }
                            : slide.slideStyle?.lowerThirdStyle === 'accent-bar'
                                ? {
                                    background: 'rgba(0, 0, 0, 0.75)',
                                    backdropFilter: 'blur(12px)',
                                    borderLeft: `6px solid ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}`,
                                }
                                : slide.slideStyle?.lowerThirdStyle === 'gradient-bar'
                                    ? {
                                        background: `linear-gradient(135deg, ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}ee, ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}88)`,
                                        backdropFilter: 'blur(12px)',
                                    }
                                    : {
                                        background: 'rgba(0, 0, 0, 0.75)',
                                        backdropFilter: 'blur(12px)',
                                    }

                    const captionNode = (captionHtml || subtitle) && (
                        <div
                            className="shrink-0 drop-shadow-lg"
                            style={{
                                fontFamily: slide.slideStyle?.font || settings.defaultFont,
                                lineHeight: 1.25,
                                letterSpacing: '0.02em',
                                width: '100%',
                                textAlign,
                                ...getVerseRefStyle(slide.slideStyle, settings, { minPx: 20, coefficient: 2.4, unit: 'vw', maxPx: 48 }),
                            }}
                            // Bible reference uses raw HTML so the `<b>` book title renders; subtitle is plain.
                            {...(captionHtml
                                ? { dangerouslySetInnerHTML: { __html: captionHtml } }
                                : { children: subtitle })}
                        />
                    )

                    return (
                        <div
                            className="absolute inset-x-0 bottom-0"
                            style={{ height: '30vh' }}
                        >
                            <div
                                className="w-full h-full flex flex-col"
                                style={{
                                    alignItems,
                                    padding: '20px 48px',
                                    gap: '8px',
                                    ...styleBar,
                                }}
                            >
                                {captionOnTop && captionNode}
                                <KineticText enabled={settings.visualizerEnabled ?? false} className="w-full flex-1 min-h-0">
                                    <AutoFitText
                                        html={bodyHtml}
                                        className="w-full h-full text-white drop-shadow-lg tiptap-preview"
                                        minPx={18}
                                        maxPx={160}
                                        style={{
                                            fontFamily: slide.slideStyle?.font || settings.defaultFont,
                                            textAlign,
                                            fontWeight: 600,
                                            lineHeight: 1.2,
                                        }}
                                    />
                                </KineticText>
                                {!captionOnTop && captionNode}
                            </div>
                        </div>
                    )
                })()
            ) : slide.type === 'countdown' ? (
                /* Countdown Layout - live ticking timer */
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {/* Title */}
                    {slide.contents[0] && (
                        <div
                            className="text-white/80 drop-shadow-lg mb-6 text-center"
                            style={{
                                fontSize: '4vw',
                                fontFamily: slide.slideStyle?.font || settings.defaultFont,
                                fontWeight: 400,
                                letterSpacing: '0.04em',
                            }}
                        >
                            {slide.contents[0]}
                        </div>
                    )}

                    {/* Live countdown display */}
                    <div
                        className="text-white drop-shadow-2xl font-mono font-bold tabular-nums"
                        style={{
                            fontSize: '20vw',
                            fontFamily: slide.slideStyle?.font || 'monospace',
                            lineHeight: 1,
                            letterSpacing: '-0.02em',
                            textShadow: '0 4px 32px rgba(0,0,0,0.6)',
                        }}
                    >
                        {formatCountdownTime(countdownSeconds)}
                    </div>

                    {/* Finished state */}
                    {countdownSeconds === 0 && (
                        <div
                            className="text-white/60 mt-8 text-center"
                            style={{
                                fontSize: '3vw',
                                fontFamily: slide.slideStyle?.font || settings.defaultFont,
                            }}
                        >
                            Time's up!
                        </div>
                    )}

                    {/* Pause/Resume controls (hover) */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            setCountdownPaused((p) => !p)
                        }}
                        className="absolute bottom-12 left-1/2 -translate-x-1/2 opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity px-6 py-3 bg-black/50 text-white rounded-full text-sm backdrop-blur-sm"
                    >
                        {countdownPaused ? '▶ Resume' : '⏸ Pause'}
                    </button>
                </div>
            ) : (
                /* Default Centered Layout — auto-fit body fills the screen, references pinned above/below */
                (() => {
                    // Per-slide setting wins, then broadcasted global default, then 'bottom'.
                    const effectiveRefPos = slide.slideStyle?.verseRefPosition ?? settings.verseRefPosition ?? 'bottom'
                    const hasRef = slide.contents.length > 1
                    const refOnTop = hasRef && effectiveRefPos === 'top'
                    const refOnBottom = hasRef && effectiveRefPos !== 'top'
                    return (
                        <div
                            className="absolute inset-0 flex flex-col"
                            style={{
                                paddingLeft: `${slide.slideStyle?.windowPadding?.left ?? 32}px`,
                                paddingRight: `${slide.slideStyle?.windowPadding?.right ?? 32}px`,
                                paddingTop: `${slide.slideStyle?.windowPadding?.top ?? 32}px`,
                                paddingBottom: `${slide.slideStyle?.windowPadding?.bottom ?? 32}px`,
                            }}
                        >
                            {refOnTop && (
                                <div
                                    className="shrink-0 text-center pb-3 drop-shadow-lg"
                                    style={{
                                        fontFamily: slide.slideStyle?.font || settings.defaultFont,
                                        lineHeight: 1.05,
                                        letterSpacing: '0.01em',
                                        textShadow: slide.slideStyle?.textOutlined ? '1px 1px 3px rgba(0,0,0,0.8)' : undefined,
                                        ...getVerseRefStyle(slide.slideStyle, settings, { minPx: 28, coefficient: 3.2, unit: 'vw', maxPx: 80 }),
                                    }}
                                >
                                    {slide.contents.slice(1).map((ref, i) => (
                                        <div key={i} dangerouslySetInnerHTML={{ __html: ref }} />
                                    ))}
                                </div>
                            )}
                            <KineticText enabled={settings.visualizerEnabled ?? false} className="flex-1 min-h-0">
                                <AutoFitText
                                    html={slide.contents[0] || ''}
                                    className="w-full h-full text-white drop-shadow-lg tiptap-preview"
                                    minPx={24}
                                    maxPx={640}
                                    style={{
                                        fontFamily: slide.slideStyle?.font || settings.defaultFont,
                                        textAlign: (slide.slideStyle?.alignment as 'left' | 'center' | 'right') || 'center',
                                        textTransform: (slide.slideStyle?.lettercase as 'uppercase' | 'lowercase' | 'capitalize' | 'none') || 'none',
                                        lineHeight: 1.0,
                                        textShadow: slide.slideStyle?.textOutlined ? '2px 2px 4px rgba(0,0,0,0.8)' : undefined,
                                    }}
                                />
                            </KineticText>
                            {refOnBottom && (
                                <div
                                    className="shrink-0 text-center pt-3 drop-shadow-lg"
                                    style={{
                                        fontFamily: slide.slideStyle?.font || settings.defaultFont,
                                        lineHeight: 1.05,
                                        letterSpacing: '0.01em',
                                        textShadow: slide.slideStyle?.textOutlined ? '1px 1px 3px rgba(0,0,0,0.8)' : undefined,
                                        ...getVerseRefStyle(slide.slideStyle, settings, { minPx: 28, coefficient: 3.2, unit: 'vw', maxPx: 80 }),
                                    }}
                                >
                                    {slide.contents.slice(1).map((ref, i) => (
                                        <div key={i} dangerouslySetInnerHTML={{ __html: ref }} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })()
            ))}

            {/* Title overlay for hymns/songs — also part of the "content"
                the Clear action hides. */}
            {!settings.liveOutputBlanked && slide.title && settings.songAndHymnLabelsVisibility && (
                <div className="absolute top-8 left-8 text-white/80 text-lg">
                    {slide.title}
                </div>
            )}

            {/* Controls (show on hover) - only in web mode */}
            {!isDesktop && (
                <div className="absolute top-4 right-4 opacity-0 hover:opacity-100 transition-opacity flex gap-2">
                    <button
                        onClick={toggleFullscreen}
                        className="p-2 bg-black/50 text-white rounded-lg hover:bg-black/70"
                        title={isFullscreen ? 'Exit Fullscreen (F)' : 'Enter Fullscreen (F)'}
                    >
                        {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                    </button>
                    <button
                        onClick={() => window.close()}
                        className="p-2 bg-black/50 text-white rounded-lg hover:bg-red-600/70"
                        title="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Footer hint - only in web mode */}
            {!isDesktop && !isFullscreen && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/50 text-sm">
                    Double-click to enter fullscreen • Ctrl+F
                </div>
            )}

            {/* Monitor identification flash overlay */}
            {flashColor && (
                <div
                    className="absolute inset-0 z-50 flex items-center justify-center animate-pulse pointer-events-none"
                    style={{ backgroundColor: flashColor + '33' }}
                >
                    <div className="flex flex-col items-center gap-4">
                        <div
                            className="w-32 h-32 rounded-full border-4 flex items-center justify-center"
                            style={{ borderColor: flashColor, backgroundColor: flashColor + '22' }}
                        >
                            <span className="text-4xl font-bold" style={{ color: flashColor }}>
                                {monitorName || 'Display'}
                            </span>
                        </div>
                        <span
                            className="text-lg font-medium px-4 py-2 rounded-lg"
                            style={{ color: flashColor, backgroundColor: flashColor + '22' }}
                        >
                            This is {monitorName || 'this display'}
                        </span>
                    </div>
                </div>
            )}

            {/* Monitor name label (always visible, subtle) */}
            {monitorColor && monitorName && !flashColor && (
                <div
                    className="absolute top-3 left-3 px-3 py-1.5 rounded-md text-xs font-semibold text-white z-40 opacity-60 hover:opacity-100 transition-opacity cursor-default"
                    style={{ backgroundColor: monitorColor + 'CC' }}
                >
                    {monitorName}
                </div>
            )}
        </div>
    )
}
