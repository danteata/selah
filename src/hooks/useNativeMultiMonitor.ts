/**
 * React hook for native multi-monitor support
 * 
 * This hook provides a unified interface for multi-monitor support that
 * automatically uses native Tauri window management in desktop mode
 * and falls back to web Presentation API in browser mode.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
    nativeMultiMonitorService,
    type MonitorInfo,
    type LiveWindowState,
    type LiveWindowConfig,
    type WindowState,
    getMonitorColor,
    flashMonitor as flashMonitorService,
} from '../services/native-multi-monitor'
import {
    multiMonitorService,
    type ScreenInfo,
    type MultiMonitorState,
} from '../services/multi-monitor'

export interface UseNativeMultiMonitorReturn {
    // State
    monitors: MonitorInfo[]
    selectedMonitorId: string | null
    liveWindowState: LiveWindowState
    isPresenting: boolean
    isLoading: boolean
    isDesktop: boolean

    // Actions
    detectMonitors: () => Promise<MonitorInfo[]>
    openLiveWindow: (config?: LiveWindowConfig) => Promise<void>
    closeLiveWindow: () => Promise<void>
    toggleFullscreen: () => Promise<boolean>
    moveToMonitor: (monitorId: string) => Promise<void>
    sendSlideToLive: (slideId: string, slideData?: Record<string, unknown>) => Promise<void>
    clearLiveOutput: (mode?: 'clear' | 'black' | 'logo') => Promise<void>
    flashMonitor: (color: string) => Promise<void>

    // Window state persistence
    getWindowState: () => Promise<WindowState>
    saveWindowState: (state: WindowState) => Promise<void>
    updateMainWindowState: () => Promise<void>
    restoreMainWindowState: () => Promise<void>

    // Legacy compatibility
    screens: ScreenInfo[]
    openLiveViewOnScreen: (screenId: string, currentSlideId?: string) => Promise<Window | null>
    startPresentation: () => Promise<boolean>
    terminatePresentation: () => Promise<void>
    broadcastSlideUpdate: (slideId: string) => void
    getBestScreen: () => MonitorInfo | ScreenInfo | null
    isPresentationApiAvailable: () => boolean
    isScreenEnumerationAvailable: () => boolean
}

export function useNativeMultiMonitor(): UseNativeMultiMonitorReturn {
    const [isDesktop, setIsDesktop] = useState(false)
    const [monitors, setMonitors] = useState<MonitorInfo[]>([])
    const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null)
    const [liveWindowState, setLiveWindowState] = useState<LiveWindowState>('Closed')
    const [isLoading, setIsLoading] = useState(false)

    // Legacy web state
    const [webState, setWebState] = useState<MultiMonitorState>(multiMonitorService.getState())

    // Track if initialized
    const initialized = useRef(false)

    // Initialize and detect desktop mode
    useEffect(() => {
        if (initialized.current) return
        initialized.current = true

        const init = async () => {
            setIsLoading(true)
            try {
                await nativeMultiMonitorService.init()
                const desktop = await nativeMultiMonitorService.isDesktop()
                setIsDesktop(desktop)

                if (desktop) {
                    const monitorList = await nativeMultiMonitorService.getMonitors()
                    setMonitors(monitorList)

                    // Get current live window state
                    const state = await nativeMultiMonitorService.getLiveWindowState()
                    setLiveWindowState(state)

                    // Get current monitor
                    const currentMonitor = await nativeMultiMonitorService.getCurrentLiveMonitor()
                    setSelectedMonitorId(currentMonitor)
                } else {
                    // Subscribe to web state changes
                    const unsubscribe = multiMonitorService.subscribe(setWebState)

                    // Auto-detect screens in web mode so monitors is populated
                    try {
                        const detectedScreens = await multiMonitorService.detectScreens()
                        const mappedMonitors = detectedScreens.map((s, idx) => ({
                            id: s.id,
                            name: s.name,
                            width: s.width,
                            height: s.height,
                            position_x: s.left,
                            position_y: s.top,
                            scale_factor: 1,
                            is_primary: s.isPrimary,
                            color: getMonitorColor(idx),
                        }))
                        setMonitors(mappedMonitors)
                    } catch {
                        // Screen detection may not be available (e.g. no Presentation API)
                    }

                    return unsubscribe
                }
            } finally {
                setIsLoading(false)
            }
        }

        const cleanup = init()
        return () => {
            cleanup?.then(fn => fn?.())
        }
    }, [])

    // Poll for live window state changes in desktop mode
    useEffect(() => {
        if (!isDesktop) return

        const interval = setInterval(async () => {
            const state = await nativeMultiMonitorService.getLiveWindowState()
            setLiveWindowState(state)

            const currentMonitor = await nativeMultiMonitorService.getCurrentLiveMonitor()
            setSelectedMonitorId(currentMonitor)
        }, 1000)

        return () => clearInterval(interval)
    }, [isDesktop])

    // Detect monitors
    const detectMonitors = useCallback(async () => {
        setIsLoading(true)
        try {
            if (isDesktop) {
                const monitorList = await nativeMultiMonitorService.getMonitors()
                setMonitors(monitorList)
                return monitorList
            } else {
                const screens = await multiMonitorService.detectScreens()
                const mapped = screens.map((s, idx) => ({
                    id: s.id,
                    name: s.name,
                    width: s.width,
                    height: s.height,
                    position_x: s.left,
                    position_y: s.top,
                    scale_factor: 1,
                    is_primary: s.isPrimary,
                    color: getMonitorColor(idx),
                }))
                setMonitors(mapped)
                return mapped
            }
        } finally {
            setIsLoading(false)
        }
    }, [isDesktop])

    // Open live window
    const openLiveWindow = useCallback(async (config?: LiveWindowConfig) => {
        if (isDesktop) {
            await nativeMultiMonitorService.openLiveWindow(config)
            setLiveWindowState(config?.fullscreen !== false ? 'Fullscreen' : 'Open')
            if (config?.monitor_id) {
                setSelectedMonitorId(config.monitor_id)
            }
        } else {
            // Web fallback: start Presentation API or open popup window
            const liveViewUrl = `${window.location.origin}/live`
            if (config?.monitor_id && config.monitor_id !== 'presentation-api') {
                // Open on a specific screen
                const win = await multiMonitorService.openLiveViewOnScreen(
                    config.monitor_id,
                    liveViewUrl,
                    config.initial_slide_id
                )
                if (win) {
                    setLiveWindowState('Open')
                    setSelectedMonitorId(config.monitor_id)
                }
            } else {
                // Use Presentation API or best available screen
                const started = await multiMonitorService.startPresentation(liveViewUrl)
                if (started) {
                    setLiveWindowState('Fullscreen')
                } else {
                    // Fallback: open a popup window
                    const win = window.open(liveViewUrl, 'selah-live', 'width=1280,height=720')
                    if (win) {
                        setLiveWindowState('Open')
                    }
                }
            }
        }
    }, [isDesktop])

    // Close live window
    const closeLiveWindow = useCallback(async () => {
        if (isDesktop) {
            await nativeMultiMonitorService.closeLiveWindow()
            setLiveWindowState('Closed')
            setSelectedMonitorId(null)
        } else {
            await multiMonitorService.terminatePresentation()
        }
    }, [isDesktop])

    // Toggle fullscreen
    const toggleFullscreen = useCallback(async () => {
        if (isDesktop) {
            const isFullscreen = await nativeMultiMonitorService.toggleLiveFullscreen()
            setLiveWindowState(isFullscreen ? 'Fullscreen' : 'Open')
            return isFullscreen
        }
        return false
    }, [isDesktop])

    // Move to monitor
    const moveToMonitor = useCallback(async (monitorId: string) => {
        if (isDesktop) {
            await nativeMultiMonitorService.moveLiveToMonitor(monitorId)
            setSelectedMonitorId(monitorId)
        }
    }, [isDesktop])

    // Send slide to live
    const sendSlideToLive = useCallback(async (slideId: string, slideData?: Record<string, unknown>) => {
        if (isDesktop) {
            await nativeMultiMonitorService.sendSlideToLive(slideId, slideData)
        } else {
            multiMonitorService.broadcastSlideUpdate(slideId)
        }
    }, [isDesktop])

    // Clear live output
    const clearLiveOutput = useCallback(async (mode?: 'clear' | 'black' | 'logo') => {
        if (isDesktop) {
            await nativeMultiMonitorService.clearLiveOutput(mode)
        }
    }, [isDesktop])

    // Flash monitor identification
    const flashMonitor = useCallback(async (color: string) => {
        if (isDesktop) {
            await flashMonitorService(color)
        }
    }, [isDesktop])

    // Window state persistence
    const getWindowState = useCallback(() => nativeMultiMonitorService.getWindowState(), [])
    const saveWindowState = useCallback((state: WindowState) => nativeMultiMonitorService.saveWindowState(state), [])
    const updateMainWindowState = useCallback(() => nativeMultiMonitorService.updateMainWindowState(), [])
    const restoreMainWindowState = useCallback(() => nativeMultiMonitorService.restoreMainWindowState(), [])

    const screens = isDesktop
        ? monitors.map(m => ({
            id: m.id,
            name: m.name,
            width: m.width,
            height: m.height,
            left: m.position_x,
            top: m.position_y,
            isPrimary: m.is_primary,
            isExternal: !m.is_primary,
            color: m.color,
        }))
        : webState.screens

    const openLiveViewOnScreen = useCallback(async (screenId: string, currentSlideId?: string): Promise<Window | null> => {
        if (isDesktop) {
            await openLiveWindow({
                monitor_id: screenId,
                fullscreen: true,
                initial_slide_id: currentSlideId,
            })
            return null // Native window, not a JS Window object
        } else {
            const liveViewUrl = `${window.location.origin}/live`
            return multiMonitorService.openLiveViewOnScreen(screenId, liveViewUrl, currentSlideId)
        }
    }, [isDesktop, openLiveWindow])

    const startPresentation = useCallback(async (): Promise<boolean> => {
        if (isDesktop) {
            await openLiveWindow({ fullscreen: true })
            return true
        } else {
            const liveViewUrl = `${window.location.origin}/live`
            return multiMonitorService.startPresentation(liveViewUrl)
        }
    }, [isDesktop, openLiveWindow])

    const terminatePresentation = useCallback(async () => {
        await closeLiveWindow()
    }, [closeLiveWindow])

    const broadcastSlideUpdate = useCallback((slideId: string) => {
        if (isDesktop) {
            // Use native event emission
            nativeMultiMonitorService.sendSlideToLive(slideId)
        } else {
            multiMonitorService.broadcastSlideUpdate(slideId)
        }
    }, [isDesktop])

    const getBestScreen = useCallback((): MonitorInfo | ScreenInfo | null => {
        if (isDesktop) {
            const external = monitors.find(m => !m.is_primary)
            return external ?? monitors[0] ?? null
        } else {
            return multiMonitorService.getBestScreenForLive()
        }
    }, [isDesktop, monitors])

    const isPresentationApiAvailable = useCallback(() => {
        return !isDesktop && multiMonitorService.isPresentationApiAvailable()
    }, [isDesktop])

    const isScreenEnumerationAvailable = useCallback(() => {
        return !isDesktop && multiMonitorService.isScreenEnumerationAvailable()
    }, [isDesktop])

    return {
        // State
        monitors,
        selectedMonitorId,
        liveWindowState,
        isPresenting: isDesktop ? liveWindowState !== 'Closed' : webState.isPresenting,
        isLoading,
        isDesktop,

        // Actions
        detectMonitors,
        openLiveWindow,
        closeLiveWindow,
        toggleFullscreen,
        moveToMonitor,
        sendSlideToLive,
        clearLiveOutput,
        flashMonitor,

        // Window state persistence
        getWindowState,
        saveWindowState,
        updateMainWindowState,
        restoreMainWindowState,

        // Legacy compatibility
        screens,
        openLiveViewOnScreen,
        startPresentation,
        terminatePresentation,
        broadcastSlideUpdate,
        getBestScreen,
        isPresentationApiAvailable,
        isScreenEnumerationAvailable,
    }
}

export type { MonitorInfo, LiveWindowState, LiveWindowConfig, WindowState }
