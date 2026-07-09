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
    identifyMonitor as identifyMonitorService,
} from '../services/native-multi-monitor'
import {
    multiMonitorService,
    type ScreenInfo,
    type MultiMonitorState,
    identifyScreen as identifyScreenWeb,
} from '../services/multi-monitor'
import { useAnalytics } from './useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'
import { isDesktop as checkIsDesktop } from '../platform'

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
    sendSettingsToLive: (settings: Record<string, unknown>) => Promise<void>
    clearLiveOutput: (mode?: 'clear' | 'black' | 'logo') => Promise<void>
    identifyScreen: (monitorId: string) => Promise<void>

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

const SELECTED_MONITOR_KEY = 'selah-selected-monitor'

// `useNativeMultiMonitor()` is called from several independent components
// (LiveOutput, useLiveSync, SettingsModal, ScreenPicker). Each call site gets
// its own hook state, so without this, each one ran its own `setInterval`
// polling the exact same backend state — N components meant N redundant
// polling loops (confirmed in production: ~2x-4x the intended IPC traffic).
// This module-level singleton runs the poll at most once, however many
// components are mounted, and fans the result out to every subscriber.
type PollListener = (state: LiveWindowState, monitorId: string | null) => void
const pollSubscribers = new Set<PollListener>()
let pollIntervalId: ReturnType<typeof setInterval> | null = null

function subscribeToLiveWindowPoll(listener: PollListener): () => void {
    pollSubscribers.add(listener)
    if (pollIntervalId === null) {
        pollIntervalId = setInterval(async () => {
            const state = await nativeMultiMonitorService.getLiveWindowState()
            const currentMonitor = await nativeMultiMonitorService.getCurrentLiveMonitor()
            pollSubscribers.forEach((fn) => fn(state, currentMonitor))
        }, 1000)
    }
    return () => {
        pollSubscribers.delete(listener)
        if (pollSubscribers.size === 0 && pollIntervalId !== null) {
            clearInterval(pollIntervalId)
            pollIntervalId = null
        }
    }
}

function loadPersistedMonitorId(): string | null {
    try {
        return localStorage.getItem(SELECTED_MONITOR_KEY)
    } catch {
        return null
    }
}

function persistMonitorId(id: string | null): void {
    try {
        if (id) {
            localStorage.setItem(SELECTED_MONITOR_KEY, id)
        } else {
            localStorage.removeItem(SELECTED_MONITOR_KEY)
        }
    } catch {
        // localStorage unavailable
    }
}

export function useNativeMultiMonitor(): UseNativeMultiMonitorReturn {
    const [isDesktop, setIsDesktop] = useState(false)
    const [monitors, setMonitors] = useState<MonitorInfo[]>([])
    const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null)
    const [liveWindowState, setLiveWindowState] = useState<LiveWindowState>('Closed')
    const [isLoading, setIsLoading] = useState(false)
    const { trackEvent } = useAnalytics()

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

                    // Get current monitor, or restore persisted selection
                    const currentMonitor = await nativeMultiMonitorService.getCurrentLiveMonitor()
                    const restored = currentMonitor || loadPersistedMonitorId()
                    setSelectedMonitorId(restored)
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

                        // Restore persisted monitor selection in web mode
                        const persisted = loadPersistedMonitorId()
                        if (persisted && mappedMonitors.some(m => m.id === persisted)) {
                            setSelectedMonitorId(persisted)
                        }
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

    // Poll for live window state changes in desktop mode. Shares a single
    // underlying interval across every mounted instance of this hook (see
    // subscribeToLiveWindowPoll above) instead of each one polling separately.
    useEffect(() => {
        if (!isDesktop) return

        const unsubscribe = subscribeToLiveWindowPoll((state, currentMonitor) => {
            setLiveWindowState(state)
            setSelectedMonitorId(currentMonitor)
        })

        return unsubscribe
    }, [isDesktop])

    // Detect monitors
    const detectMonitors = useCallback(async () => {
        setIsLoading(true)
        try {
            if (isDesktop) {
                const monitorList = await nativeMultiMonitorService.getMonitors()
                setMonitors(monitorList)
                // Restore persisted selection if still valid
                const persisted = loadPersistedMonitorId()
                if (persisted && monitorList.some(m => m.id === persisted)) {
                    setSelectedMonitorId(persisted)
                }
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
                // Restore persisted selection if still valid
                const persisted = loadPersistedMonitorId()
                if (persisted && mapped.some(m => m.id === persisted)) {
                    setSelectedMonitorId(persisted)
                }
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
                persistMonitorId(config.monitor_id)
            }
            trackEvent(AnalyticsEventType.MULTI_MONITOR_OPENED, {
                is_desktop: true,
                monitor_count: monitors.length,
                method: 'tauri_window',
                fullscreen: config?.fullscreen !== false,
            })
        } else {
            // Web fallback: start Presentation API or open popup window
            const liveViewUrl = `${window.location.origin}/#/live`
            let method = 'popup'
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
                    persistMonitorId(config.monitor_id)
                    method = 'screen_picker'
                }
            } else {
                // Use Presentation API or best available screen
                const started = await multiMonitorService.startPresentation(liveViewUrl)
                if (started) {
                    setLiveWindowState('Fullscreen')
                    method = 'presentation_api'
                } else {
                    // Fallback: open a popup window
                    const win = window.open(liveViewUrl, 'selah-live', 'width=1280,height=720')
                    if (win) {
                        setLiveWindowState('Open')
                    }
                }
            }
            trackEvent(AnalyticsEventType.MULTI_MONITOR_OPENED, {
                is_desktop: false,
                monitor_count: monitors.length,
                method,
                fullscreen: config?.fullscreen !== false,
            })
        }
    }, [isDesktop, monitors.length, trackEvent])

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
            persistMonitorId(monitorId)
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

    // Send display-settings update to live window (desktop only — web mode
    // relies on useLiveSync's BroadcastChannel/localStorage broadcast, which
    // reaches other tabs/windows of the same origin directly).
    const sendSettingsToLive = useCallback(async (settings: Record<string, unknown>) => {
        if (isDesktop) {
            await nativeMultiMonitorService.sendSettingsToLive(settings)
        }
    }, [isDesktop])

    // Clear live output
    const clearLiveOutput = useCallback(async (mode?: 'clear' | 'black' | 'logo') => {
        if (isDesktop) {
            await nativeMultiMonitorService.clearLiveOutput(mode)
        }
    }, [isDesktop])

    // Identify a specific monitor by opening an identification window
    // on the target monitor (desktop) or popup (web).
    const identifyScreen = useCallback(async (monitorId: string) => {
        const monitor = monitors.find(m => m.id === monitorId)
        if (!monitor) {
            console.error('[useNativeMultiMonitor] Monitor not found for identification:', monitorId, 'Available monitors:', monitors.map(m => m.id))
            return
        }

        if (isDesktop) {
            try {
                await identifyMonitorService(monitor)
            } catch (err) {
                console.error('[useNativeMultiMonitor] identify_monitor command failed:', err)
            }
            return
        }

        // Web: open a popup window on the target screen + broadcast
        // to any existing live windows
        try {
            const channel = new BroadcastChannel('selah-monitor-flash')
            channel.postMessage({ monitorId, color: monitor.color || '#3B82F6' })
            channel.close()
        } catch { /* ignore */ }

        const screenInfo: ScreenInfo = {
            id: monitor.id,
            name: monitor.name,
            width: monitor.width,
            height: monitor.height,
            left: monitor.position_x,
            top: monitor.position_y,
            isPrimary: monitor.is_primary,
            isExternal: !monitor.is_primary,
            color: monitor.color,
        }
        await identifyScreenWeb(screenInfo)
    }, [isDesktop, monitors])

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
            const liveViewUrl = `${window.location.origin}/#/live`
            return multiMonitorService.openLiveViewOnScreen(screenId, liveViewUrl, currentSlideId)
        }
    }, [isDesktop, openLiveWindow])

    const startPresentation = useCallback(async (): Promise<boolean> => {
        if (isDesktop) {
            await openLiveWindow({ fullscreen: true })
            return true
        } else {
            const liveViewUrl = `${window.location.origin}/#/live`
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
        sendSettingsToLive,
        clearLiveOutput,
        identifyScreen,

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
