import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useQuery } from 'convex/react'
import { useAuth } from '@clerk/clerk-react'
import { api } from '../../convex/_generated/api'
import type { Slide } from '../types'
import { nativeMultiMonitorService } from '../services/native-multi-monitor'
import { startNativeAudioFeatures } from '../services/visualizer/nativeAudioFeatures'
import { SlideView } from '../components/live/SlideView'
import { useAnalytics } from '../hooks'

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
        slideTransition?: 'fade' | 'morph'
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
    // Read by the channel effect's one-off snapshot check without making that
    // effect re-subscribe on every slide change.
    const currentSlideIdRef = useRef(currentSlideId)
    useEffect(() => {
        currentSlideIdRef.current = currentSlideId
    }, [currentSlideId])
    const [liveState, setLiveState] = useState<LiveState | null>(null)
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
    const [isDesktop, setIsDesktop] = useState(false)
    const { trackPage } = useAnalytics()

    const [flashColor, setFlashColor] = useState<string | null>(null)
    // 'alternate' when this window is the alternate output. Both outputs run this
    // same view and are told apart by which window each event is addressed to;
    // this only affects what the window shows before its first event arrives.
    const outputRole = searchParams.get('output') === 'alternate' ? 'alternate' : 'main'
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
                            // Append when the slide isn't in this window's snapshot
                            // rather than only replacing: the alternate output can
                            // be sent a slide that was never in the queue, and
                            // replace-only left it with nothing to render.
                            const known = prev.slides.some(s => s.id === payload.slideId)
                            const slides = known
                                ? prev.slides.map(s => (s.id === payload.slideId ? payload.slideData! : s))
                                : [...prev.slides, payload.slideData!]
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
                // Adopt an empty live slide too: that is how "Stop Live Output"
                // clears the projector. Skipping falsy ids left the last slide
                // up in front of the congregation. The alternate output takes
                // its content from messages addressed to it, never the feed.
                if (outputRole !== 'alternate') {
                    setCurrentSlideId(event.data.state.liveSlideId || '')
                }
            } else if (event.data?.type === 'slide-update' && outputRole !== 'alternate') {
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
                // eslint-disable-next-line react-hooks/set-state-in-effect -- the snapshot another window wrote, read as this effect subscribes to its updates
                setLiveState(parsed)
                // The alternate output must not adopt the projector's slide — its
                // own content arrives addressed to its window. The rest of this
                // snapshot (fonts, verse-reference styling) is still wanted.
                if (outputRole !== 'alternate' && !currentSlideIdRef.current && parsed.liveSlideId) {
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
        // Not keyed on the current slide: that closed and reopened both
        // channels on every slide change, dropping any message sent in
        // between and re-parsing the whole snapshot at each transition.
    }, [isSessionMode, monitorId, outputRole])

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
            className="h-screen w-screen bg-black relative overflow-hidden"
            style={monitorColor ? { boxShadow: `inset 0 0 0 3px ${monitorColor}` } : undefined}
            onDoubleClick={toggleFullscreen}
        >
            {/* The same renderer as the operator's monitor, so what they
                approve is what the room sees. */}
            <SlideView slide={slide} settings={settings} className="absolute inset-0 h-full w-full" />

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
