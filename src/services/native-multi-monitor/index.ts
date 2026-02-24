/**
 * Native Multi-Monitor Support Service for Tauri Desktop
 * 
 * This service provides a TypeScript interface to the native Tauri multi-monitor
 * window management commands, with automatic fallback to web-based Presentation API
 * when running in a browser.
 */

import type { Event, UnlistenFn } from '@tauri-apps/api/event'

// Types that mirror the Rust types
export interface MonitorInfo {
    id: string
    name: string
    width: number
    height: number
    position_x: number
    position_y: number
    scale_factor: number
    is_primary: boolean
    refresh_rate?: number
}

export type LiveWindowState = 'Closed' | 'Open' | 'Fullscreen'

export interface LiveWindowConfig {
    monitor_id?: string
    fullscreen?: boolean
    decorations?: boolean
    always_on_top?: boolean
    initial_slide_id?: string
}

export interface WindowState {
    live_monitor_id?: string
    live_fullscreen: boolean
    main_position_x?: number
    main_position_y?: number
    main_width?: number
    main_height?: number
    main_maximized: boolean
}

export interface MultiMonitorError {
    code: string
    message: string
}

// Check if running in Tauri
function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

// Lazy load Tauri APIs
async function getTauriApis() {
    if (!isTauri()) return null

    try {
        const { invoke } = await import('@tauri-apps/api/core')
        const eventApi = await import('@tauri-apps/api/event')
        return { invoke, ...eventApi }
    } catch (e) {
        console.warn('Failed to load Tauri APIs:', e)
        return null
    }
}

/**
 * Native Multi-Monitor Service
 * 
 * Provides a unified interface for multi-monitor support that works
 * seamlessly in both Tauri desktop and web browser environments.
 */
class NativeMultiMonitorService {
    private _isDesktop: boolean | null = null
    private tauriApis: Awaited<ReturnType<typeof getTauriApis>> | null = null
    private listeners: Map<string, Set<UnlistenFn>> = new Map()

    /**
     * Initialize the service (call this early in app startup)
     */
    async init(): Promise<void> {
        this.tauriApis = await getTauriApis()
        this._isDesktop = isTauri() && this.tauriApis !== null
    }

    /**
     * Check if running in desktop mode
     */
    async isDesktop(): Promise<boolean> {
        if (this._isDesktop !== null) return this._isDesktop

        await this.init()
        return this._isDesktop ?? false
    }

    /**
     * Get all available monitors
     */
    async getMonitors(): Promise<MonitorInfo[]> {
        if (!await this.isDesktop()) {
            // Fallback to web API
            return this.getMonitorsWeb()
        }

        try {
            return await this.tauriApis!.invoke<MonitorInfo[]>('get_monitors')
        } catch (e) {
            console.error('Failed to get monitors:', e)
            return this.getMonitorsWeb()
        }
    }

    /**
     * Get monitors using web APIs (fallback)
     */
    private async getMonitorsWeb(): Promise<MonitorInfo[]> {
        const monitors: MonitorInfo[] = []

        // Try Screen Details API (Chrome 100+)
        if ('getScreenDetails' in window) {
            try {
                const screenDetails = await (window as any).getScreenDetails()
                for (const [idx, screen] of screenDetails.screens.entries()) {
                    monitors.push({
                        id: `monitor-${idx}`,
                        name: screen.label || `Screen ${idx + 1}`,
                        width: screen.width,
                        height: screen.height,
                        position_x: screen.left,
                        position_y: screen.top,
                        scale_factor: 1,
                        is_primary: screen.isPrimary,
                    })
                }
            } catch (e) {
                console.log('Screen Details API not available')
            }
        }

        // Fallback to primary screen
        if (monitors.length === 0) {
            monitors.push({
                id: 'primary',
                name: 'Primary Screen',
                width: window.screen.width,
                height: window.screen.height,
                position_x: 0,
                position_y: 0,
                scale_factor: 1,
                is_primary: true,
            })
        }

        return monitors
    }

    /**
     * Get the primary monitor
     */
    async getPrimaryMonitor(): Promise<MonitorInfo | null> {
        if (!await this.isDesktop()) {
            const monitors = await this.getMonitors()
            return monitors.find(m => m.is_primary) ?? monitors[0] ?? null
        }

        try {
            return await this.tauriApis!.invoke<MonitorInfo | null>('get_primary_monitor')
        } catch (e) {
            console.error('Failed to get primary monitor:', e)
            return null
        }
    }

    /**
     * Get the best monitor for live output
     */
    async getBestLiveMonitor(): Promise<MonitorInfo | null> {
        if (!await this.isDesktop()) {
            const monitors = await this.getMonitors()
            return monitors.find(m => !m.is_primary) ?? monitors[0] ?? null
        }

        try {
            return await this.tauriApis!.invoke<MonitorInfo | null>('get_best_live_monitor')
        } catch (e) {
            console.error('Failed to get best live monitor:', e)
            return null
        }
    }

    /**
     * Open the live output window
     */
    async openLiveWindow(config?: LiveWindowConfig): Promise<void> {
        if (!await this.isDesktop()) {
            throw new Error('Native live window requires desktop app')
        }

        try {
            await this.tauriApis!.invoke('open_live_window', { config })
        } catch (e) {
            const error = e as MultiMonitorError
            throw new Error(`Failed to open live window: ${error.message}`)
        }
    }

    /**
     * Close the live output window
     */
    async closeLiveWindow(): Promise<void> {
        if (!await this.isDesktop()) return

        try {
            await this.tauriApis!.invoke('close_live_window')
        } catch (e) {
            console.error('Failed to close live window:', e)
        }
    }

    /**
     * Toggle fullscreen on the live window
     */
    async toggleLiveFullscreen(): Promise<boolean> {
        if (!await this.isDesktop()) {
            throw new Error('Native fullscreen requires desktop app')
        }

        try {
            return await this.tauriApis!.invoke<boolean>('toggle_live_fullscreen')
        } catch (e) {
            console.error('Failed to toggle fullscreen:', e)
            return false
        }
    }

    /**
     * Move live window to a specific monitor
     */
    async moveLiveToMonitor(monitorId: string): Promise<void> {
        if (!await this.isDesktop()) return

        try {
            await this.tauriApis!.invoke('move_live_to_monitor', { monitorId })
        } catch (e) {
            console.error('Failed to move live window:', e)
        }
    }

    /**
     * Get current live window state
     */
    async getLiveWindowState(): Promise<LiveWindowState> {
        if (!await this.isDesktop()) return 'Closed'

        try {
            return await this.tauriApis!.invoke<LiveWindowState>('get_live_window_state')
        } catch (e) {
            return 'Closed'
        }
    }

    /**
     * Check if live window is open
     */
    async isLiveWindowOpen(): Promise<boolean> {
        if (!await this.isDesktop()) return false

        try {
            return await this.tauriApis!.invoke<boolean>('is_live_window_open')
        } catch (e) {
            return false
        }
    }

    /**
     * Get current live monitor ID
     */
    async getCurrentLiveMonitor(): Promise<string | null> {
        if (!await this.isDesktop()) return null

        try {
            return await this.tauriApis!.invoke<string | null>('get_current_live_monitor')
        } catch (e) {
            return null
        }
    }

    /**
     * Send slide update to live window
     */
    async sendSlideToLive(slideId: string, slideData?: Record<string, unknown>): Promise<void> {
        if (!await this.isDesktop()) return

        try {
            await this.tauriApis!.invoke('send_slide_to_live', {
                slideId,
                slideData: slideData ?? null
            })
        } catch (e) {
            console.error('Failed to send slide to live:', e)
        }
    }

    /**
     * Clear/blank the live output
     */
    async clearLiveOutput(mode?: 'clear' | 'black' | 'logo'): Promise<void> {
        if (!await this.isDesktop()) return

        try {
            await this.tauriApis!.invoke('clear_live_output', { mode })
        } catch (e) {
            console.error('Failed to clear live output:', e)
        }
    }

    /**
     * Get persisted window state
     */
    async getWindowState(): Promise<WindowState> {
        if (!await this.isDesktop()) {
            return {
                live_fullscreen: true,
                main_maximized: false,
            }
        }

        try {
            return await this.tauriApis!.invoke<WindowState>('get_window_state')
        } catch (e) {
            return {
                live_fullscreen: true,
                main_maximized: false,
            }
        }
    }

    /**
     * Save window state
     */
    async saveWindowState(state: WindowState): Promise<void> {
        if (!await this.isDesktop()) return

        try {
            await this.tauriApis!.invoke('save_window_state', { windowState: state })
        } catch (e) {
            console.error('Failed to save window state:', e)
        }
    }

    /**
     * Update main window state (call before closing)
     */
    async updateMainWindowState(): Promise<void> {
        if (!await this.isDesktop()) return

        try {
            await this.tauriApis!.invoke('update_main_window_state')
        } catch (e) {
            console.error('Failed to update main window state:', e)
        }
    }

    /**
     * Restore main window position from state
     */
    async restoreMainWindowState(): Promise<void> {
        if (!await this.isDesktop()) return

        try {
            await this.tauriApis!.invoke('restore_main_window_state')
        } catch (e) {
            console.error('Failed to restore main window state:', e)
        }
    }

    /**
     * Listen for events from the live window
     */
    async onLiveWindowEvent<T = unknown>(
        event: string,
        callback: (payload: T) => void
    ): Promise<() => void> {
        if (!await this.isDesktop()) {
            return () => { }
        }

        try {
            const unlisten = await this.tauriApis!.listen<T>(event, (e) => {
                callback(e.payload)
            })

            // Track listener for cleanup
            if (!this.listeners.has(event)) {
                this.listeners.set(event, new Set())
            }
            this.listeners.get(event)!.add(unlisten)

            return () => {
                unlisten()
                this.listeners.get(event)?.delete(unlisten)
            }
        } catch (e) {
            console.error('Failed to listen for event:', e)
            return () => { }
        }
    }

    /**
     * Cleanup all listeners
     */
    cleanup(): void {
        for (const unlisteners of this.listeners.values()) {
            for (const unlisten of unlisteners) {
                unlisten()
            }
        }
        this.listeners.clear()
    }
}

// Export singleton instance
export const nativeMultiMonitorService = new NativeMultiMonitorService()

// Export convenience functions
export const getMonitors = () => nativeMultiMonitorService.getMonitors()
export const getPrimaryMonitor = () => nativeMultiMonitorService.getPrimaryMonitor()
export const getBestLiveMonitor = () => nativeMultiMonitorService.getBestLiveMonitor()
export const openLiveWindow = (config?: LiveWindowConfig) =>
    nativeMultiMonitorService.openLiveWindow(config)
export const closeLiveWindow = () => nativeMultiMonitorService.closeLiveWindow()
export const toggleLiveFullscreen = () => nativeMultiMonitorService.toggleLiveFullscreen()
export const moveLiveToMonitor = (monitorId: string) =>
    nativeMultiMonitorService.moveLiveToMonitor(monitorId)
export const getLiveWindowState = () => nativeMultiMonitorService.getLiveWindowState()
export const isLiveWindowOpen = () => nativeMultiMonitorService.isLiveWindowOpen()
export const getCurrentLiveMonitor = () => nativeMultiMonitorService.getCurrentLiveMonitor()
export const sendSlideToLive = (slideId: string, slideData?: Record<string, unknown>) =>
    nativeMultiMonitorService.sendSlideToLive(slideId, slideData)
export const clearLiveOutput = (mode?: 'clear' | 'black' | 'logo') =>
    nativeMultiMonitorService.clearLiveOutput(mode)
export const getWindowState = () => nativeMultiMonitorService.getWindowState()
export const saveWindowState = (state: WindowState) =>
    nativeMultiMonitorService.saveWindowState(state)
export const updateMainWindowState = () => nativeMultiMonitorService.updateMainWindowState()
export const restoreMainWindowState = () => nativeMultiMonitorService.restoreMainWindowState()
export const isDesktop = () => nativeMultiMonitorService.isDesktop()
