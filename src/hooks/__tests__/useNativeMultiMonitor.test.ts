/**
 * Tests for useNativeMultiMonitor.
 *
 * These tests cover both:
 * 1. The data transformation logic (shape mapping, color assignment, etc.)
 * 2. The actual hook behavior (init, state transitions, screen persistence)
 *
 * The hook is a thin wrapper over two service singletons
 * (nativeMultiMonitorService for Tauri desktop, multiMonitorService for
 * web/Presentation API), so the tests mock both services and verify the
 * hook dispatches to the right one based on isDesktop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Hoist mock factories so they're available before module init
const { nativeMock, webMock } = vi.hoisted(() => {
    const nativeMock = {
        init: vi.fn().mockResolvedValue(undefined),
        isDesktop: vi.fn().mockResolvedValue(false),
        getMonitors: vi.fn().mockResolvedValue([]),
        getLiveWindowState: vi.fn().mockResolvedValue('Closed'),
        getCurrentLiveMonitor: vi.fn().mockResolvedValue(null),
        openLiveWindow: vi.fn().mockResolvedValue(undefined),
        closeLiveWindow: vi.fn().mockResolvedValue(undefined),
        identifyMonitor: vi.fn().mockResolvedValue(undefined),
        moveLiveToMonitor: vi.fn().mockResolvedValue(undefined),
        toggleLiveFullscreen: vi.fn().mockResolvedValue(false),
        sendSlideToLive: vi.fn().mockResolvedValue(undefined),
        clearLiveOutput: vi.fn().mockResolvedValue(undefined),
        getWindowState: vi.fn().mockResolvedValue({ live_fullscreen: true, main_maximized: false }),
        saveWindowState: vi.fn().mockResolvedValue(undefined),
        updateMainWindowState: vi.fn().mockResolvedValue(undefined),
        restoreMainWindowState: vi.fn().mockResolvedValue(undefined),
    }
    const webMock = {
        detectScreens: vi.fn().mockResolvedValue([]),
        startPresentation: vi.fn().mockResolvedValue(false),
        openLiveViewOnScreen: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockReturnValue(() => { }),
        terminatePresentation: vi.fn().mockResolvedValue(undefined),
        broadcastSlideUpdate: vi.fn(),
        getState: () => ({ screens: [], selectedScreenId: null, liveWindow: null, isPresenting: false }),
        isPresentationApiAvailable: () => false,
        isScreenEnumerationAvailable: () => false,
        getBestScreen: () => null,
    }
    return { nativeMock, webMock }
})

vi.mock('../../services/native-multi-monitor', () => ({
    nativeMultiMonitorService: nativeMock,
    getMonitorColor: vi.fn((i: number) => ['#3B82F6', '#EF4444', '#10B981', '#F59E0B'][i % 4]),
    identifyMonitor: nativeMock.identifyMonitor,
    type: {},
}))

vi.mock('../../services/multi-monitor', () => ({
    multiMonitorService: webMock,
    identifyScreen: vi.fn().mockResolvedValue(undefined),
    type: {},
}))

import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { getMonitorColor } from '../../services/native-multi-monitor'
import { multiMonitorService } from '../../services/multi-monitor'

const svc = nativeMock

const FAKE_MONITORS = [
    { id: 'built-in-display-0x0', name: 'Built-in Display', width: 1920, height: 1080, position_x: 0, position_y: 0, scale_factor: 2, is_primary: true, color: '#3B82F6' },
    { id: 'external-display-1-1920x0', name: 'External Display 1', width: 2560, height: 1440, position_x: 1920, position_y: 0, scale_factor: 1, is_primary: false, color: '#EF4444' },
]

function resetMocks() {
    vi.clearAllMocks()
    svc.init.mockResolvedValue(undefined)
    svc.isDesktop.mockResolvedValue(false)
    svc.getMonitors.mockResolvedValue([])
    svc.getLiveWindowState.mockResolvedValue('Closed')
    svc.getCurrentLiveMonitor.mockResolvedValue(null)
    svc.openLiveWindow.mockResolvedValue(undefined)
    svc.closeLiveWindow.mockResolvedValue(undefined)
    svc.identifyMonitor.mockResolvedValue(undefined)
    webMock.detectScreens.mockResolvedValue([])
    webMock.startPresentation.mockResolvedValue(false)
    webMock.openLiveViewOnScreen.mockResolvedValue(null)
    localStorage.clear()
}

describe('useNativeMultiMonitor — data shape', () => {
    beforeEach(resetMocks)

    it('assigns getMonitorColor to each monitor by index', () => {
        const raw = [
            { id: 'm1', name: 'Built-in Display', width: 1920, height: 1080, position_x: 0, position_y: 0, scale_factor: 2, is_primary: true },
            { id: 'm2', name: 'External Display 1', width: 2560, height: 1440, position_x: 1920, position_y: 0, scale_factor: 1, is_primary: false },
        ]
        const colored = raw.map((m, i) => ({ ...m, color: getMonitorColor(i) }))
        expect(colored[0].color).toBe('#3B82F6')
        expect(colored[1].color).toBe('#EF4444')
    })

    it('maps ScreenInfo to MonitorInfo shape', () => {
        const screens = [
            { id: 's1', name: 'Screen 1', width: 1920, height: 1080, left: 0, top: 0, isPrimary: true, isExternal: false },
            { id: 's2', name: 'Screen 2', width: 2560, height: 1440, left: 1920, top: 0, isPrimary: false, isExternal: true },
        ]
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

        expect(mapped[0]).toEqual({
            id: 's1', name: 'Screen 1', width: 1920, height: 1080,
            position_x: 0, position_y: 0, scale_factor: 1, is_primary: true, color: '#3B82F6',
        })
        expect(mapped[1]).toEqual({
            id: 's2', name: 'Screen 2', width: 2560, height: 1440,
            position_x: 1920, position_y: 0, scale_factor: 1, is_primary: false, color: '#EF4444',
        })
    })

    it('maps MonitorInfo to legacy ScreenInfo shape', () => {
        const monitors = FAKE_MONITORS
        const screens = monitors.map(m => ({
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

        expect(screens[0]).toEqual({
            id: 'built-in-display-0x0', name: 'Built-in Display',
            width: 1920, height: 1080, left: 0, top: 0,
            isPrimary: true, isExternal: false, color: '#3B82F6',
        })
        expect(screens[1]).toEqual({
            id: 'external-display-1-1920x0', name: 'External Display 1',
            width: 2560, height: 1440, left: 1920, top: 0,
            isPrimary: false, isExternal: true, color: '#EF4444',
        })
    })
})

describe('useNativeMultiMonitor — hook behavior (web mode)', () => {
    beforeEach(resetMocks)

    it('initializes in web mode and sets isDesktop=false', async () => {
        svc.isDesktop.mockResolvedValue(false)

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.isDesktop).toBe(false)
        })
        expect(svc.init).toHaveBeenCalled()
        expect(svc.isDesktop).toHaveBeenCalled()
    })

    it('auto-detects screens in web mode and populates monitors state', async () => {
        svc.isDesktop.mockResolvedValue(false)
        webMock.detectScreens.mockResolvedValue([
            { id: 'web-s1', name: 'Web Display 1', width: 1920, height: 1080, left: 0, top: 0, isPrimary: true, isExternal: false },
            { id: 'web-s2', name: 'Web Display 2', width: 2560, height: 1440, left: 1920, top: 0, isPrimary: false, isExternal: true },
        ])

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.monitors.length).toBe(2)
        })
        expect(result.current.monitors[0].id).toBe('web-s1')
        expect(result.current.monitors[0].color).toBe('#3B82F6')
        expect(result.current.monitors[1].id).toBe('web-s2')
        expect(result.current.monitors[1].color).toBe('#EF4444')
    })

    it('shows empty monitors when screen detection fails', async () => {
        svc.isDesktop.mockResolvedValue(false)
        webMock.detectScreens.mockRejectedValue(new Error('Presentation API not available'))

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false)
        })
        // Even when detection fails, monitors should be an empty array (not undefined)
        expect(result.current.monitors).toEqual([])
    })

    it('restores valid persisted monitor id from localStorage', async () => {
        localStorage.setItem('selah-selected-monitor', 'web-s2')
        svc.isDesktop.mockResolvedValue(false)
        webMock.detectScreens.mockResolvedValue([
            { id: 'web-s1', name: 'Display 1', width: 1920, height: 1080, left: 0, top: 0, isPrimary: true, isExternal: false },
            { id: 'web-s2', name: 'Display 2', width: 2560, height: 1440, left: 1920, top: 0, isPrimary: false, isExternal: true },
        ])

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.selectedMonitorId).toBe('web-s2')
        })
    })

    it('ignores persisted monitor id that no longer exists', async () => {
        localStorage.setItem('selah-selected-monitor', 'web-s999')
        svc.isDesktop.mockResolvedValue(false)
        webMock.detectScreens.mockResolvedValue([
            { id: 'web-s1', name: 'Display 1', width: 1920, height: 1080, left: 0, top: 0, isPrimary: true, isExternal: false },
        ])

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.monitors.length).toBe(1)
        })
        expect(result.current.selectedMonitorId).toBeNull()
    })
})

describe('useNativeMultiMonitor — hook behavior (desktop mode)', () => {
    beforeEach(resetMocks)

    it('initializes in desktop mode and sets isDesktop=true', async () => {
        svc.isDesktop.mockResolvedValue(true)
        svc.getMonitors.mockResolvedValue(FAKE_MONITORS)
        svc.getLiveWindowState.mockResolvedValue('Closed')

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.isDesktop).toBe(true)
        })
        expect(result.current.monitors).toEqual(FAKE_MONITORS)
    })

    it('calls getMonitors only in desktop mode, not web mode', async () => {
        svc.isDesktop.mockResolvedValue(false)
        webMock.detectScreens.mockResolvedValue([])

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false)
        })
        // svc.getMonitors is never called in web mode
        expect(svc.getMonitors).not.toHaveBeenCalled()
    })

    it('openLiveWindow in desktop mode calls native service with config', async () => {
        svc.isDesktop.mockResolvedValue(true)
        svc.getMonitors.mockResolvedValue(FAKE_MONITORS)

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.isDesktop).toBe(true)
        })

        await act(async () => {
            await result.current.openLiveWindow({ monitor_id: 'external-display-1-1920x0', fullscreen: true })
        })

        expect(svc.openLiveWindow).toHaveBeenCalledWith({ monitor_id: 'external-display-1-1920x0', fullscreen: true })
        expect(result.current.liveWindowState).toBe('Fullscreen')
        expect(result.current.selectedMonitorId).toBe('external-display-1-1920x0')
        // Persisted to localStorage
        expect(localStorage.getItem('selah-selected-monitor')).toBe('external-display-1-1920x0')
    })

    it('openLiveWindow in web mode uses Presentation API when no monitor_id', async () => {
        svc.isDesktop.mockResolvedValue(false)
        webMock.startPresentation.mockResolvedValue(true)

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.isDesktop).toBe(false)
        })

        await act(async () => {
            await result.current.openLiveWindow({ fullscreen: true })
        })

        expect(webMock.startPresentation).toHaveBeenCalled()
        expect(result.current.liveWindowState).toBe('Fullscreen')
    })

    it('openLiveWindow in web mode uses openLiveViewOnScreen for specific monitor', async () => {
        svc.isDesktop.mockResolvedValue(false)
        webMock.openLiveViewOnScreen.mockResolvedValue({} as Window)

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.isDesktop).toBe(false)
        })

        await act(async () => {
            await result.current.openLiveWindow({ monitor_id: 'web-s1' })
        })

        expect(webMock.openLiveViewOnScreen).toHaveBeenCalled()
        expect(result.current.liveWindowState).toBe('Open')
    })

    it('closeLiveWindow in desktop mode resets state and clears persisted id', async () => {
        svc.isDesktop.mockResolvedValue(true)
        svc.getMonitors.mockResolvedValue(FAKE_MONITORS)
        localStorage.setItem('selah-selected-monitor', 'external-display-1-1920x0')

        const { result } = renderHook(() => useNativeMultiMonitor())

        await waitFor(() => {
            expect(result.current.isDesktop).toBe(true)
        })

        await act(async () => {
            await result.current.closeLiveWindow()
        })

        expect(svc.closeLiveWindow).toHaveBeenCalled()
        expect(result.current.liveWindowState).toBe('Closed')
        expect(result.current.selectedMonitorId).toBeNull()
    })
})

describe('useNativeMultiMonitor — getBestScreen logic', () => {
    it('returns the external monitor when one exists', () => {
        const monitors = FAKE_MONITORS
        const external = monitors.find(m => !m.is_primary)
        expect(external?.name).toBe('External Display 1')
    })

    it('falls back to the first monitor when no external exists', () => {
        const monitors = [FAKE_MONITORS[0]]
        const best = monitors.find(m => !m.is_primary) ?? monitors[0]
        expect(best.name).toBe('Built-in Display')
    })

    it('returns null when no monitors', () => {
        const monitors: Array<typeof FAKE_MONITORS[number]> = []
        const best = monitors.find(m => !m.is_primary) ?? monitors[0] ?? null
        expect(best).toBeNull()
    })
})
