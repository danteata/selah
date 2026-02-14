/**
 * Screen Picker Component
 * 
 * UI for selecting which screen to use for live output
 */
import { useState, useEffect } from 'react'
import { Monitor, Tv, Airplay, RefreshCw, X, Check } from 'lucide-react'
import { useMultiMonitor } from '../../hooks/useMultiMonitor'
import type { ScreenInfo } from '../../services/multi-monitor'

interface ScreenPickerProps {
    onSelect?: (screenId: string) => void
    onClose?: () => void
    showCloseButton?: boolean
}

export function ScreenPicker({ onSelect, onClose, showCloseButton = true }: ScreenPickerProps) {
    const {
        screens,
        selectedScreenId,
        isPresenting,
        isLoading,
        detectScreens,
        openLiveViewOnScreen,
        startPresentation,
        terminatePresentation,
        isPresentationApiAvailable,
        isScreenEnumerationAvailable,
    } = useMultiMonitor()

    const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)

    // Detect screens on mount
    useEffect(() => {
        detectScreens()
    }, [detectScreens])

    // Handle screen selection
    const handleSelectScreen = async (screenId: string) => {
        setLocalSelectedId(screenId)
        onSelect?.(screenId)
    }

    // Handle going live
    const handleGoLive = async () => {
        const screenId = localSelectedId || selectedScreenId
        if (screenId) {
            await openLiveViewOnScreen(screenId)
        }
    }

    // Handle presentation mode
    const handlePresent = async () => {
        await startPresentation()
    }

    // Handle stop presenting
    const handleStop = async () => {
        await terminatePresentation()
    }

    // Get icon for screen
    const getScreenIcon = (screen: ScreenInfo) => {
        if (screen.isPrimary) return Monitor
        if (screen.isExternal) return Tv
        return Airplay
    }

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Select Display
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={detectScreens}
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

            {/* Feature availability notice */}
            {!isScreenEnumerationAvailable() && (
                <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-700 dark:text-yellow-300">
                    <p>
                        Screen enumeration requires Chrome 100+ or a browser that supports the Screen Enumeration API.
                        Currently showing basic screen info.
                    </p>
                </div>
            )}

            {/* Screen list */}
            <div className="space-y-2 mb-4">
                {screens.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Monitor className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No screens detected</p>
                        <button
                            onClick={detectScreens}
                            className="mt-2 text-sm text-blue-600 hover:text-blue-700"
                        >
                            Click to detect screens
                        </button>
                    </div>
                ) : (
                    screens.map((screen) => {
                        const Icon = getScreenIcon(screen)
                        const isSelected = localSelectedId === screen.id || selectedScreenId === screen.id

                        return (
                            <button
                                key={screen.id}
                                onClick={() => handleSelectScreen(screen.id)}
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
                                            {screen.name}
                                        </span>
                                        {screen.isPrimary && (
                                            <span className="px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded">
                                                Primary
                                            </span>
                                        )}
                                        {screen.isExternal && (
                                            <span className="px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
                                                External
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        {screen.width} × {screen.height}
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
                            disabled={!localSelectedId && !selectedScreenId}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Monitor className="w-4 h-4" />
                            Go Live
                        </button>

                        {/* Present button (Presentation API) */}
                        {isPresentationApiAvailable() && (
                            <button
                                onClick={handlePresent}
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
                {screens.length === 1
                    ? 'Connect an external display for projection'
                    : `Select a screen for live output`
                }
            </p>
        </div>
    )
}