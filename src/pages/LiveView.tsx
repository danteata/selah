import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Maximize2, Minimize2, X } from 'lucide-react'
import type { Slide, Countdown } from '../types'
import { useFileUrl } from '../hooks/useTemplates'
import { nativeMultiMonitorService } from '../services/native-multi-monitor'

const STORAGE_KEY = 'selah-live-state'

interface LiveState {
    slides: Slide[]
    liveSlideId: string | null
    settings: {
        liveWindowFullscreen: boolean
        songAndHymnLabelsVisibility: boolean
        defaultFont: string
    }
}

// Check if running in Tauri
function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

export default function LiveView() {
    const [searchParams] = useSearchParams()
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [currentSlideId, setCurrentSlideId] = useState(searchParams.get('slide') || '')
    const [liveState, setLiveState] = useState<LiveState | null>(null)
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null)
    const [isDesktop, setIsDesktop] = useState(false)

    // Countdown timer state
    const [countdownSeconds, setCountdownSeconds] = useState<number>(0)
    const [countdownPaused, setCountdownPaused] = useState(false)
    const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

                return () => {
                    unlistenSlide()
                    unlistenClear()
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

    // Initialize BroadcastChannel for cross-window communication
    useEffect(() => {
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
            window.removeEventListener('storage', handleStorageChange)
        }
    }, [currentSlideId])

    // Get current live slide
    const slide = useMemo(() => {
        if (!liveState?.slides) return null
        return liveState.slides.find(s => s.id === currentSlideId)
    }, [liveState, currentSlideId])

    // Get file URL if slide has a backgroundStorageId
    const fileUrl = useFileUrl(slide?.backgroundStorageId || null)

    // Determine the background to use
    const backgroundUrl = fileUrl || slide?.background
    const isVideoBackground = slide?.backgroundType === 'video' && backgroundUrl

    const settings = liveState?.settings || {
        liveWindowFullscreen: false,
        songAndHymnLabelsVisibility: true,
        defaultFont: 'Inter',
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
            if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                toggleFullscreen()
            }
            if (e.key === 'Escape' && document.fullscreenElement) {
                document.exitFullscreen()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [toggleFullscreen])

    if (!slide) {
        return (
            <div className="h-screen bg-black flex items-center justify-center text-white">
                <div className="text-center">
                    <p className="text-xl mb-2">No slide selected</p>
                    <p className="text-gray-400">Select a slide from the main window to display here</p>
                    {isDesktop && (
                        <p className="text-green-400 text-sm mt-4">Running in native desktop mode</p>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div
            className="h-screen w-screen bg-black relative overflow-hidden"
            onDoubleClick={toggleFullscreen}
        >
            {/* Background */}
            {isVideoBackground && backgroundUrl ? (
                <video
                    src={backgroundUrl}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{
                        filter: `blur(${slide.slideStyle?.blur || 0}px) brightness(${slide.slideStyle?.brightness || 50}%)`
                    }}
                    autoPlay
                    loop
                    muted
                    playsInline
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

            {/* Content */}
            {slide.layout === 'lower-third' ? (
                /* Lower Third Layout */
                <div
                    className="absolute inset-x-0 bottom-0"
                    style={{
                        padding: '0',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: slide.slideStyle?.lowerThirdPosition === 'center' ? 'center'
                                : slide.slideStyle?.lowerThirdPosition === 'right' ? 'flex-end'
                                    : 'flex-start',
                            padding: '24px 48px',
                            ...(slide.slideStyle?.lowerThirdStyle === 'standard' ? {
                                background: 'rgba(0, 0, 0, 0.75)',
                                backdropFilter: 'blur(12px)',
                            } : slide.slideStyle?.lowerThirdStyle === 'minimalist' ? {
                                background: 'transparent',
                            } : slide.slideStyle?.lowerThirdStyle === 'accent-bar' ? {
                                background: 'rgba(0, 0, 0, 0.75)',
                                backdropFilter: 'blur(12px)',
                                borderLeft: `6px solid ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}`,
                            } : slide.slideStyle?.lowerThirdStyle === 'gradient-bar' ? {
                                background: `linear-gradient(135deg, ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}ee, ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}88)`,
                                backdropFilter: 'blur(12px)',
                            } : {
                                background: 'rgba(0, 0, 0, 0.75)',
                                backdropFilter: 'blur(12px)',
                            }),
                        }}
                    >
                        <div
                            className="tiptap-preview"
                            style={{
                                fontFamily: slide.slideStyle?.font || 'Inter',
                                textAlign: (slide.slideStyle?.lowerThirdPosition as 'left' | 'center' | 'right') || 'left',
                            }}
                        >
                            {slide.contents.map((content, index) => (
                                <div
                                    key={index}
                                    className="text-white drop-shadow-lg"
                                    style={{
                                        fontSize: `${slide.slideStyle?.fontSize || 3.5}vw`,
                                        fontWeight: 600,
                                        lineHeight: 1.3,
                                    }}
                                    dangerouslySetInnerHTML={{ __html: content }}
                                />
                            ))}
                            {slide.slideStyle?.lowerThirdSubtitle && (
                                <div
                                    className="text-white/80 drop-shadow-lg"
                                    style={{
                                        fontSize: `${(slide.slideStyle?.fontSize || 3.5) * 0.55}vw`,
                                        marginTop: '0.3em',
                                        fontWeight: 400,
                                        letterSpacing: '0.02em',
                                    }}
                                >
                                    {slide.slideStyle.lowerThirdSubtitle}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : slide.type === 'countdown' ? (
                /* Countdown Layout - live ticking timer */
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {/* Title */}
                    {slide.contents[0] && (
                        <div
                            className="text-white/80 drop-shadow-lg mb-6 text-center"
                            style={{
                                fontSize: '4vw',
                                fontFamily: slide.slideStyle?.font || 'Inter',
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
                                fontFamily: slide.slideStyle?.font || 'Inter',
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
                /* Default Centered Layout */
                <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                        paddingLeft: `${slide.slideStyle?.windowPadding?.left || 64}px`,
                        paddingRight: `${slide.slideStyle?.windowPadding?.right || 64}px`,
                        paddingTop: `${slide.slideStyle?.windowPadding?.top || 64}px`,
                        paddingBottom: `${slide.slideStyle?.windowPadding?.bottom || 64}px`,
                    }}
                >
                    <div
                        className="text-center max-w-full tiptap-preview"
                        style={{
                            fontSize: `${slide.slideStyle?.fontSize || 4.5}vw`,
                            fontFamily: slide.slideStyle?.font || 'Inter',
                            textAlign: (slide.slideStyle?.alignment as 'left' | 'center' | 'right') || 'center',
                            textTransform: slide.slideStyle?.lettercase as 'uppercase' | 'lowercase' | 'capitalize' | 'none' || 'none',
                            lineHeight: 1.4,
                            textShadow: slide.slideStyle?.textOutlined ? '2px 2px 4px rgba(0,0,0,0.8)' : undefined,
                        }}
                    >
                        {slide.contents.map((content, index) => (
                            <div
                                key={index}
                                className="text-white drop-shadow-lg"
                                style={{
                                    marginBottom: index < slide.contents.length - 1 ? '0.4em' : 0
                                }}
                                dangerouslySetInnerHTML={{ __html: content }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Title overlay for hymns/songs */}
            {slide.title && settings.songAndHymnLabelsVisibility && (
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
        </div>
    )
}
