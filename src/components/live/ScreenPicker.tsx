/**
 * Screen Picker Component
 * 
 * UI for selecting which screen to use for live output.
 * Supports both native Tauri multi-monitor and web Presentation API.
 * Includes per-monitor color identification, layout preview, and flash-to-identify.
 */
import { useState, useEffect } from 'react'
import { Monitor, Tv, Airplay, RefreshCw, X, Check, Cpu, Zap } from 'lucide-react'
import { useNativeMultiMonitor, type MonitorInfo } from '../../hooks/useNativeMultiMonitor'

interface ScreenPickerProps {
    onSelect?: (screenId: string) => void
    onClose?: () => void
    showCloseButton?: boolean
}

function MonitorLayoutPreview({ monitors, selectedId, onSelect }: {
    monitors: MonitorInfo[]
    selectedId: string | null
    onSelect: (id: string) => void
}) {
    if (monitors.length < 2) return null

    const minX = Math.min(...monitors.map(m => m.position_x))
    const minY = Math.min(...monitors.map(m => m.position_y))
    const maxX = Math.max(...monitors.map(m => m.position_x + m.width))
    const maxY = Math.max(...monitors.map(m => m.position_y + m.height))
    const totalW = maxX - minX
    const totalH = maxY - minY

    if (totalW === 0 || totalH === 0) return null

    const SCALE = 200 / Math.max(totalW, totalH)

    return (
        <div className="mb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Display Layout</p>
            <div
                className="relative bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                style={{
                    width: Math.ceil(totalW * SCALE) + 16,
                    height: Math.ceil(totalH * SCALE) + 16,
                    margin: '0 auto',
                }}
            >
                {monitors.map((monitor) => {
                    const x = (monitor.position_x - minX) * SCALE + 8
                    const y = (monitor.position_y - minY) * SCALE + 8
                    const w = monitor.width * SCALE
                    const h = monitor.height * SCALE
                    const isSelected = selectedId === monitor.id
                    const color = monitor.color || '#6B7280'

                    return (
                        <button
                            key={monitor.id}
                            onClick={() => onSelect(monitor.id)}
                            className="absolute rounded cursor-pointer transition-all group"
                            style={{
                                left: x,
                                top: y,
                                width: w,
                                height: h,
                                border: `2px solid ${isSelected ? color : color + '66'}`,
                                backgroundColor: isSelected ? color + '30' : color + '15',
                            }}
                            title={monitor.name}
                        >
                            <div
                                className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900"
                                style={{ backgroundColor: color }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[9px] font-bold leading-none" style={{ color }}>
                                    {monitor.is_primary ? 'P' : 'E'}
                                </span>
                            </div>
                        </button>
                    )
                })}
            </div>
        </div>
    )
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
        flashMonitor: flashMonitorNative,
    } = useNativeMultiMonitor()

    const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
    const [flashingMonitorId, setFlashingMonitorId] = useState<string | null>(null)

    useEffect(() => {
        detectMonitors()
    }, [detectMonitors])

    const handleSelectScreen = async (screenId: string) => {
        setLocalSelectedId(screenId)
        onSelect?.(screenId)
    }

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

    const handleStop = async () => {
        await closeLiveWindow()
    }

    const handleFlashMonitor = async (monitor: MonitorInfo) => {
        if (flashingMonitorId) return
        setFlashingMonitorId(monitor.id)
        const color = monitor.color || '#3B82F6'
        if (isDesktop) {
            await flashMonitorNative(color)
        }
        const channel = new BroadcastChannel('selah-monitor-flash')
        channel.postMessage({ monitorId: monitor.id, color })
        channel.close()
        setTimeout(() => setFlashingMonitorId(null), 2500)
    }

    const effectiveSelectedId = localSelectedId || selectedMonitorId

    const getScreenIcon = (monitor: MonitorInfo) => {
        if (monitor.is_primary) return Monitor
        return Tv
    }

    const isPresenting = liveWindowState !== 'Closed'

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4 min-w-[340px]">
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

            {isDesktop && (
                <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
                    <p className="flex items-center gap-2">
                        <Cpu className="w-4 h-4" />
                        Running in native desktop mode — no browser permissions needed!
                    </p>
                </div>
            )}

            {!isDesktop && !isScreenEnumerationAvailable() && (
                <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-700 dark:text-yellow-300">
                    <p>
                        Screen enumeration requires Chrome 100+ or a browser that supports the Screen Enumeration API.
                        Currently showing basic screen info.
                    </p>
                </div>
            )}

            <MonitorLayoutPreview
                monitors={monitors}
                selectedId={effectiveSelectedId}
                onSelect={handleSelectScreen}
            />

            {monitors.length > 1 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Click Identify to flash the matching color on that display
                </p>
            )}

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
                        const isSelected = effectiveSelectedId === monitor.id
                        const color = monitor.color || '#6B7280'
                        const isFlashing = flashingMonitorId === monitor.id

                        return (
                            <button
                                key={monitor.id}
                                onClick={() => handleSelectScreen(monitor.id)}
                                className={`
                                    w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left
                                    ${isSelected
                                        ? 'shadow-sm'
                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                    }
                                `}
                                style={isSelected ? {
                                    borderColor: color,
                                    backgroundColor: color + '10',
                                } : undefined}
                            >
                                <div
                                    className="p-2 rounded-lg"
                                    style={isSelected ? {
                                        backgroundColor: color + '20',
                                    } : undefined}
                                >
                                    <Icon
                                        className="w-5 h-5"
                                        style={isSelected ? { color } : undefined}
                                    />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-900"
                                            style={{ backgroundColor: color }}
                                        />
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

                                {monitors.length > 1 && (
                                    <div
                                        className="flex-shrink-0"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            onClick={() => handleFlashMonitor(monitor)}
                                            disabled={isFlashing}
                                            className="px-2 py-1 text-xs font-medium rounded-md transition-colors"
                                            style={{
                                                color,
                                                backgroundColor: isFlashing ? color + '20' : 'transparent',
                                                border: `1px solid ${color}44`,
                                            }}
                                            title={`Identify ${monitor.name}`}
                                        >
                                            <Zap className={`w-3.5 h-3.5 ${isFlashing ? 'animate-pulse' : ''}`} />
                                        </button>
                                    </div>
                                )}

                                {isSelected && (
                                    <div className="flex-shrink-0">
                                        <Check className="w-5 h-5" style={{ color }} />
                                    </div>
                                )}
                            </button>
                        )
                    })
                )}
            </div>

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
                        <button
                            onClick={handleGoLive}
                            disabled={!localSelectedId && !selectedMonitorId}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Monitor className="w-4 h-4" />
                            Go Live
                        </button>

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

            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 text-center">
                {monitors.length === 1
                    ? 'Connect an external display for projection'
                    : `Select a screen for live output`
                }
            </p>
        </div>
    )
}