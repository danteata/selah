/**
 * Screen Picker Component
 * 
 * UI for selecting which screen to use for live output.
 * Supports both native Tauri multi-monitor and web Presentation API.
 */
import { useState, useEffect } from 'react'
import { Monitor, Tv, Airplay, RefreshCw, X, Check, Cpu } from 'lucide-react'
import { useNativeMultiMonitor, type MonitorInfo } from '../../hooks/useNativeMultiMonitor'

interface ScreenPickerProps {
    onSelect?: (screenId: string) => void
    onClose?: () => void
    showCloseButton?: boolean
}

export function ScreenPicker({ onSelect, onClose, showCloseButton = true }: ScreenPickerProps) {
    const {
        monitors,
        selectedMonitorId,
        liveWindowState,
        isLoading,
        isDesktop,
        detectMonitors,
        openLiveWindow,
        closeLiveWindow,
        isPresentationApiAvailable,
        isScreenEnumerationAvailable,
    } = useNativeMultiMonitor()

    const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)

    // Detect monitors on mount
    useEffect(() => {
        detectMonitors()
    }, [detectMonitors])

    // Handle screen selection
    const handleSelectScreen = async (screenId: string) => {
        setLocalSelectedId(screenId)
        onSelect?.(screenId)
    }

    // Handle going live
    const handleGoLive = async () => {
        const screenId = localSelectedId || selectedMonitorId
        if (screenId) {
            if (isDesktop) {
                await openLiveWindow({
                    monitor_id: screenId,
                    fullscreen: true,
                    decorations: false,
                    always_on_top: true,
                })
            } else {
                onSelect?.(screenId)
            }
        }
    }

    // Handle stop presenting
    const handleStop = async () => {
        await closeLiveWindow()
    }

    // Get icon for screen
    const getScreenIcon = (monitor: MonitorInfo) => {
        if (monitor.is_primary) return Monitor
        return Tv
    }

    const isPresenting = liveWindowState !== 'Closed'

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4 min-w-[320px]">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Select Display
                    </h3>
                    {isDesktop && (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full">
                            <Cpu className="w-3 h-3" />
                            Native
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={detectMonitors}
                        disabled={isLoading}
                        className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                        title="Refresh screens"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    {showCloseButton && onClose && (
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Desktop mode notice */}
            {isDesktop && (
                <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
                    <p className="flex items-center gap-2">
                        <Cpu className="w-4 h-4" />
                        Running in native desktop mode - no browser permissions needed!
                    </p>
                </div>
            )}

            {/* Feature availability notice (web mode only) */}
            {!isDesktop && !isScreenEnumerationAvailable() && (
                <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-700 dark:text-yellow-300">
                    <p>
                        Screen enumeration requires Chrome 100+ or a browser that supports the Screen Enumeration API.
                        Currently showing basic screen info.
                    </p>
                </div>
            )}

            {/* Screen list */}
            <div className="space-y-2 mb-4">
                {monitors.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Monitor className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No screens detected</p>
                        <button
                            onClick={detectMonitors}
                            className="mt-2 text-sm text-blue-600 hover:text-blue-700"
                        >
                            Click to detect screens
                        </button>
                    </div>
                ) : (
                    monitors.map((monitor) => {
                        const Icon = getScreenIcon(monitor)
                        const isSelected = localSelectedId === monitor.id || selectedMonitorId === monitor.id

                        return (
                            <button
                                key={monitor.id}
                                onClick={() => handleSelectScreen(monitor.id)}
                                className={`
                                    w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left
                                    ${isSelected
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                    }
                                `}
                            >
                                {/* Screen icon */}
                                <div className={`
                                    p-2 rounded-lg
                                    ${isSelected
                                        ? 'bg-blue-100 dark:bg-blue-800'
                                        : 'bg-gray-100 dark:bg-gray-800'
                                    }
                                `}>
                                    <Icon className={`w-5 h-5 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`} />
                                </div>

                                {/* Screen info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-gray-900 dark:text-white">
                                            {monitor.name}
                                        </span>
                                        {monitor.is_primary && (
                                            <span className="px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded">
                                                Primary
                                            </span>
                                        )}
                                        {!monitor.is_primary && (
                                            <span className="px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
                                                External
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        {monitor.width} × {monitor.height}
                                        {monitor.scale_factor !== 1 && (
                                            <span className="ml-2 text-xs">
                                                ({Math.round(monitor.scale_factor * 100)}% scale)
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Selected indicator */}
                                {isSelected && (
                                    <div className="flex-shrink-0">
                                        <Check className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                    </div>
                                )}
                            </button>
                        )
                    })
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
                {isPresenting ? (
                    <button
                        onClick={handleStop}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                        <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                        Stop Presenting
                    </button>
                ) : (
                    <>
                        {/* Go Live button */}
                        <button
                            onClick={handleGoLive}
                            disabled={!localSelectedId && !selectedMonitorId}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Monitor className="w-4 h-4" />
                            Go Live
                        </button>

                        {/* Present button (Presentation API - web only) */}
                        {!isDesktop && isPresentationApiAvailable() && (
                            <button
                                onClick={() => onSelect?.('presentation-api')}
                                className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                                title="Present to external display"
                            >
                                <Airplay className="w-4 h-4" />
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Help text */}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 text-center">
                {monitors.length === 1
                    ? 'Connect an external display for projection'
                    : `Select a screen for live output`
                }
            </p>
        </div>
    )
}
