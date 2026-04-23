/**
 * Multi-Monitor Support Service
 * 
 * Uses the Presentation API and Screen Capture API to detect
 * and manage multiple displays for live output.
 */

import {
    getMonitorColor,
} from '../native-multi-monitor'

export interface ScreenInfo {
    id: string
    name: string
    width: number
    height: number
    left: number
    top: number
    isPrimary: boolean
    isExternal: boolean
    color?: string
}

export interface MultiMonitorState {
    screens: ScreenInfo[]
    selectedScreenId: string | null
    liveWindow: Window | null
    isPresenting: boolean
}

type Listener = (state: MultiMonitorState) => void

class MultiMonitorService {
    private state: MultiMonitorState = {
        screens: [],
        selectedScreenId: null,
        liveWindow: null,
        isPresenting: false,
    }
    private listeners: Set<Listener> = new Set()
    private presentationConnection: PresentationConnection | null = null

    /**
     * Check if the Presentation API is available
     */
    isPresentationApiAvailable(): boolean {
        return typeof PresentationRequest !== 'undefined'
    }

    /**
     * Check if the Screen Enumeration API is available
     * Note: This requires secure context and user gesture
     */
    isScreenEnumerationAvailable(): boolean {
        return 'getScreenDetails' in window ||
            'getScreenDisplays' in window
    }

    /**
     * Get available screens using the Screen Placement API
     * Falls back to window management if available
     */
    async detectScreens(): Promise<ScreenInfo[]> {
        const screens: ScreenInfo[] = []

        if ('getScreenDetails' in window) {
            try {
                const screenDetails = await (window as any).getScreenDetails()

                for (const [idx, screen] of screenDetails.screens.entries()) {
                    const name = screen.label || `Screen ${screens.length + 1}`
                    screens.push({
                        id: `${name.toLowerCase().replace(/ /g, '-')}-${screen.left}x${screen.top}`,
                        name,
                        width: screen.width,
                        height: screen.height,
                        left: screen.left,
                        top: screen.top,
                        isPrimary: screen.isPrimary,
                        isExternal: !screen.isPrimary,
                        color: getMonitorColor(idx),
                    })
                }
            } catch (e) {
                console.log('Screen Details API not available or permission denied')
            }
        }

        if (screens.length === 0) {
            screens.push({
                id: 'primary',
                name: 'Primary Screen',
                width: window.screen.width,
                height: window.screen.height,
                left: window.screen.left || 0,
                top: window.screen.top || 0,
                isPrimary: true,
                isExternal: false,
                color: getMonitorColor(0),
            })

            if (window.screen.availWidth > window.screen.width) {
                screens.push({
                    id: 'external-right',
                    name: 'External Screen (Right)',
                    width: window.screen.availWidth - window.screen.width,
                    height: window.screen.height,
                    left: window.screen.width,
                    top: 0,
                    isPrimary: false,
                    isExternal: true,
                    color: getMonitorColor(1),
                })
            }
        }

        this.state.screens = screens
        this.notifyListeners()
        return screens
    }

    /**
     * Open live view on a specific screen
     */
    async openLiveViewOnScreen(screenId: string, liveViewUrl: string, currentSlideId?: string): Promise<Window | null> {
        const screen = this.state.screens.find(s => s.id === screenId)
        if (!screen) {
            console.error('Screen not found:', screenId)
            return null
        }

        const params = new URLSearchParams()
        if (currentSlideId) params.set('slide', currentSlideId)
        if (screen.color) params.set('monitorColor', screen.color)
        if (screen.name) params.set('monitorName', screen.name)
        const url = params.toString() ? `${liveViewUrl}?${params.toString()}` : liveViewUrl

        // Calculate window position for the target screen
        const windowFeatures = [
            `width=${screen.width}`,
            `height=${screen.height}`,
            `left=${screen.left}`,
            `top=${screen.top}`,
            'fullscreen=yes',
            'menubar=no',
            'toolbar=no',
            'location=no',
            'status=no',
            'resizable=yes',
        ].join(',')

        // Open the live view window
        const liveWindow = window.open(
            url,
            'selah-live-view',
            windowFeatures
        )

        if (liveWindow) {
            this.state.liveWindow = liveWindow
            this.state.selectedScreenId = screenId
            this.state.isPresenting = true
            this.notifyListeners()

            // Listen for window close
            const checkClosed = setInterval(() => {
                if (liveWindow.closed) {
                    clearInterval(checkClosed)
                    this.state.liveWindow = null
                    this.state.isPresenting = false
                    this.notifyListeners()
                }
            }, 1000)
        }

        return liveWindow
    }

    /**
     * Start presentation using the Presentation API
     * This is the preferred method for external displays
     */
    async startPresentation(liveViewUrl: string): Promise<boolean> {
        if (!this.isPresentationApiAvailable()) {
            console.log('Presentation API not available, falling back to window.open')
            return false
        }

        try {
            const presentationRequest = new PresentationRequest([liveViewUrl])
                ; (navigator as any).presentation.defaultRequest = presentationRequest

            const connection = await presentationRequest.start()

            this.presentationConnection = connection
            this.state.isPresenting = true
            this.notifyListeners()

            // Handle connection close
            connection.onclose = () => {
                this.presentationConnection = null
                this.state.isPresenting = false
                this.notifyListeners()
            }

            return true
        } catch (e: any) {
            console.log('Presentation start failed:', e.message)
            return false
        }
    }

    /**
     * Terminate the current presentation
     */
    async terminatePresentation(): Promise<void> {
        if (this.presentationConnection) {
            this.presentationConnection.terminate()
            this.presentationConnection = null
        }

        if (this.state.liveWindow && !this.state.liveWindow.closed) {
            this.state.liveWindow.close()
        }

        this.state.liveWindow = null
        this.state.isPresenting = false
        this.state.selectedScreenId = null
        this.notifyListeners()
    }

    /**
     * Get current state
     */
    getState(): MultiMonitorState {
        return { ...this.state }
    }

    /**
     * Subscribe to state changes
     */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    /**
     * Notify all listeners of state change
     */
    private notifyListeners(): void {
        for (const listener of this.listeners) {
            listener(this.getState())
        }
    }

    /**
     * Get the best screen for live output
     * Returns the first external screen, or primary if none
     */
    getBestScreenForLive(): ScreenInfo | null {
        const external = this.state.screens.find(s => s.isExternal)
        return external || this.state.screens[0] || null
    }

    /**
     * Check if currently presenting
     */
    isPresenting(): boolean {
        return this.state.isPresenting
    }

    /**
     * Send slide update to live window
     */
    broadcastSlideUpdate(slideId: string): void {
        if (this.state.liveWindow && !this.state.liveWindow.closed) {
            this.state.liveWindow.postMessage(
                { type: 'slide-update', slideId },
                '*'
            )
        }

        if (this.presentationConnection) {
            this.presentationConnection.send(JSON.stringify({
                type: 'slide-update',
                slideId,
            }))
        }
    }
}

// Export singleton instance
export const multiMonitorService = new MultiMonitorService()

// Export convenience functions
export const detectScreens = () => multiMonitorService.detectScreens()
export const openLiveViewOnScreen = (screenId: string, url: string) =>
    multiMonitorService.openLiveViewOnScreen(screenId, url)
export const startPresentation = (url: string) =>
    multiMonitorService.startPresentation(url)
export const terminatePresentation = () =>
    multiMonitorService.terminatePresentation()
export const getMultiMonitorState = () =>
    multiMonitorService.getState()
export const subscribeToMultiMonitor = (listener: Listener) =>
    multiMonitorService.subscribe(listener)
export const broadcastSlideUpdate = (slideId: string) =>
    multiMonitorService.broadcastSlideUpdate(slideId)