import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Maximize2, Minimize2, X } from 'lucide-react'
import type { Slide } from '../types'

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

export default function LiveView() {
    const [searchParams] = useSearchParams()
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [currentSlideId, setCurrentSlideId] = useState(searchParams.get('slide') || '')
    const [liveState, setLiveState] = useState<LiveState | null>(null)
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null)

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

    const settings = liveState?.settings || {
        liveWindowFullscreen: false,
        songAndHymnLabelsVisibility: true,
        defaultFont: 'Inter',
    }

    // Toggle fullscreen
    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen()
            setIsFullscreen(true)
        } else {
            document.exitFullscreen()
            setIsFullscreen(false)
        }
    }, [])

    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }

        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    // Auto-enter fullscreen if setting is enabled
    useEffect(() => {
        if (settings.liveWindowFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {
                // Ignore errors (user may have denied permission)
            })
        }
    }, [settings.liveWindowFullscreen])

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
            {slide.background ? (
                <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                        backgroundImage: `url(${slide.background})`,
                        filter: `blur(${slide.slideStyle?.blur || 0}px) brightness(${slide.slideStyle?.brightness || 50}%)`
                    }}
                />
            ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-black" />
            )}

            {/* Content */}
            <div
                className="absolute inset-0 flex items-center justify-center p-12"
                style={{
                    paddingLeft: `${slide.slideStyle?.windowPadding?.left || 24}px`,
                    paddingRight: `${slide.slideStyle?.windowPadding?.right || 24}px`,
                    paddingTop: `${slide.slideStyle?.windowPadding?.top || 24}px`,
                    paddingBottom: `${slide.slideStyle?.windowPadding?.bottom || 24}px`,
                }}
            >
                <div
                    className="text-center max-w-full tiptap-preview"
                    style={{
                        fontSize: `${slide.slideStyle?.fontSize || 6}vw`,
                        fontFamily: slide.slideStyle?.font || 'Inter',
                        textAlign: (slide.slideStyle?.alignment as 'left' | 'center' | 'right') || 'center',
                        textTransform: slide.slideStyle?.lettercase as 'uppercase' | 'lowercase' | 'capitalize' | 'none' || 'none',
                        lineHeight: slide.slideStyle?.lineSpacing || 'normal',
                        textShadow: slide.slideStyle?.textOutlined ? '2px 2px 4px rgba(0,0,0,0.8)' : undefined,
                    }}
                >
                    {slide.contents.map((content, index) => (
                        <div
                            key={index}
                            className="text-white mb-4 drop-shadow-lg"
                            style={{
                                color: slide.type === 'countdown' ? 'white' : undefined,
                                fontWeight: slide.type === 'countdown' ? 'bold' : undefined
                            }}
                            dangerouslySetInnerHTML={{ __html: content }}
                        />
                    ))}
                </div>
            </div>

            {/* Title overlay for hymns/songs */}
            {slide.title && settings.songAndHymnLabelsVisibility && (
                <div className="absolute top-8 left-8 text-white/80 text-lg">
                    {slide.title}
                </div>
            )}

            {/* Controls (show on hover) */}
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

            {/* Footer hint */}
            {!isFullscreen && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/50 text-sm">
                    Double-click to enter fullscreen • Ctrl+F
                </div>
            )}
        </div>
    )
}
