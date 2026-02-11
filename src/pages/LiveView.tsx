import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export default function LiveView() {
    const [searchParams] = useSearchParams()
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [currentSlide, setCurrentSlide] = useState(searchParams.get('slide') || '')

    const activeSlides = useAppStore((state) => state.activeSlides)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const settings = useAppStore((state) => state.settings)

    // Get current live slide
    const slide = useMemo(() => {
        return activeSlides.find(s => s.id === (currentSlide || liveSlideId))
    }, [activeSlides, liveSlideId, currentSlide])

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

    // Listen for slide updates from broadcast channel
    useEffect(() => {
        const handleBroadcast = (event: MessageEvent) => {
            if (event.data?.type === 'slide-update') {
                setCurrentSlide(event.data.slideId)
            }
        }

        // Also listen for custom events from same window
        const handleCustomEvent = (e: CustomEvent) => {
            if (e.detail?.id) {
                setCurrentSlide(e.detail.id)
            }
        }

        window.addEventListener('message', handleBroadcast)
        window.addEventListener('broadcast-slide' as never, handleCustomEvent as EventListener)

        return () => {
            window.removeEventListener('message', handleBroadcast)
            window.removeEventListener('broadcast-slide' as never, handleCustomEvent as EventListener)
        }
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
                    className="text-center max-w-full"
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
                        <p
                            key={index}
                            className="text-white mb-4 drop-shadow-lg"
                            style={{
                                color: slide.type === 'countdown' ? 'white' : undefined,
                                fontWeight: slide.type === 'countdown' ? 'bold' : undefined
                            }}
                        >
                            {content}
                        </p>
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
