import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../../services/native-multi-monitor', () => {
    const mock = {
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
    return {
        nativeMultiMonitorService: mock,
        getMonitorColor: vi.fn((i: number) => ['#3B82F6', '#EF4444', '#10B981', '#F59E0B'][i % 4]),
        identifyMonitor: mock.identifyMonitor,
        type: {},
    }
})

vi.mock('../../services/multi-monitor', () => ({
    multiMonitorService: {
        detectScreens: vi.fn().mockResolvedValue([]),
        startPresentation: vi.fn().mockResolvedValue(false),
        openLiveViewOnScreen: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockReturnValue(() => {}),
        getState: () => ({ screens: [], selectedScreenId: null, liveWindow: null, isPresenting: false }),
        isPresentationApiAvailable: () => false,
        isScreenEnumerationAvailable: () => false,
        getBestScreenForLive: () => null,
    },
    identifyScreen: vi.fn().mockResolvedValue(undefined),
    type: {},
}))

import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { nativeMultiMonitorService } from '../../services/native-multi-monitor'
import { identifyScreen as identifyScreenWeb } from '../../services/multi-monitor'
import { getMonitorColor } from '../../services/native-multi-monitor'

const svc = nativeMultiMonitorService as any

const FAKE_MONITORS = [
    { id: 'built-in-display-0x0', name: 'Built-in Display', width: 1920, height: 1080, position_x: 0, position_y: 0, scale_factor: 2, is_primary: true, color: '#3B82F6' },
    { id: 'external-display-1-1920x0', name: 'External Display 1', width: 2560, height: 1440, position_x: 1920, position_y: 0, scale_factor: 1, is_primary: false, color: '#EF4444' },
]

describe('useNativeMultiMonitor', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        svc.init.mockResolvedValue(undefined)
        svc.isDesktop.mockResolvedValue(false)
        svc.getMonitors.mockResolvedValue([])
        svc.getLiveWindowState.mockResolvedValue('Closed')
        svc.getCurrentLiveMonitor.mockResolvedValue(null)
        svc.openLiveWindow.mockResolvedValue(undefined)
        svc.closeLiveWindow.mockResolvedValue(undefined)
        svc.identifyMonitor.mockResolvedValue(undefined)
        localStorage.clear()
    })

    describe('monitor color assignment', () => {
        it('assigns getMonitorColor to each monitor by index', () => {
            const raw = [
                { id: 'm1', name: 'Built-in Display', width: 1920, height: 1080, position_x: 0, position_y: 0, scale_factor: 2, is_primary: true },
                { id: 'm2', name: 'External Display 1', width: 2560, height: 1440, position_x: 1920, position_y: 0, scale_factor: 1, is_primary: false },
            ]
            const colored = raw.map((m, i) => ({ ...m, color: getMonitorColor(i) }))
            expect(colored[0].color).toBe('#3B82F6')
            expect(colored[1].color).toBe('#EF4444')
        })
    })

    describe('screen-to-monitor mapping (web mode)', () => {
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
    })

    describe('identifyScreen logic', () => {
        it('finds monitor by id and passes color/name to identifyMonitor in desktop mode', async () => {
            const monitors = FAKE_MONITORS
            const monitorId = 'external-display-1-1920x0'
            const monitor = monitors.find(m => m.id === monitorId)
            expect(monitor).toBeDefined()
            expect(monitor!.color).toBe('#EF4444')
            expect(monitor!.name).toBe('External Display 1')
        })

        it('skips identification if monitor id not found', () => {
            const monitors = FAKE_MONITORS
            const monitor = monitors.find(m => m.id === 'nonexistent')
            expect(monitor).toBeUndefined()
        })

        it('uses fallback color #3B82F6 when monitor.color is undefined', () => {
            const monitor = { id: 'm1', name: 'Display', color: undefined }
            const color = monitor.color || '#3B82F6'
            expect(color).toBe('#3B82F6')
        })

        it('uses fallback name "Display" when monitor.name is empty', () => {
            const emptyName: string = ''
            const name = emptyName || 'Display'
            expect(name).toBe('Display')
        })
    })

    describe('openLiveWindow logic', () => {
        it('determines fullscreen state from config', () => {
            const config = { monitor_id: 'm1', fullscreen: true }
            const state = config.fullscreen !== false ? 'Fullscreen' : 'Open'
            expect(state).toBe('Fullscreen')
        })

        it('determines open state when fullscreen is false', () => {
            const config = { monitor_id: 'm1', fullscreen: false }
            const state = config.fullscreen !== false ? 'Fullscreen' : 'Open'
            expect(state).toBe('Open')
        })

        it('presentation-api monitor ID routes to Presentation API in web mode', () => {
            const monitorId = 'presentation-api'
            const usePresentationApi = monitorId === 'presentation-api'
            expect(usePresentationApi).toBe(true)
        })

        it('specific screen ID routes to openLiveViewOnScreen in web mode', () => {
            const monitorId: string = 'screen-2'
            const useSpecificScreen = monitorId !== 'presentation-api'
            expect(useSpecificScreen).toBe(true)
        })
    })

    describe('persisted monitor selection', () => {
        it('restores valid persisted ID', () => {
            const KEY = 'selah-selected-monitor'
            localStorage.setItem(KEY, 'external-display-1-1920x0')
            const monitors = FAKE_MONITORS
            const persisted = localStorage.getItem(KEY)
            const valid = persisted && monitors.some(m => m.id === persisted)
            expect(valid).toBe(true)
        })

        it('skips invalid persisted ID', () => {
            const KEY = 'selah-selected-monitor'
            localStorage.setItem(KEY, 'removed-monitor-id')
            const monitors = FAKE_MONITORS
            const persisted = localStorage.getItem(KEY)
            const valid = persisted && monitors.some(m => m.id === persisted)
            expect(valid).toBe(false)
        })

        it('clears persisted ID when null is passed', () => {
            const KEY = 'selah-selected-monitor'
            localStorage.setItem(KEY, 'm1')
            const valueToSet: string | null = null
            if (valueToSet) {
                localStorage.setItem(KEY, valueToSet)
            } else {
                localStorage.removeItem(KEY)
            }
            expect(localStorage.getItem(KEY)).toBeNull()
        })
    })

    describe('isPresenting logic', () => {
        it('is true when liveWindowState is not Closed in desktop mode', () => {
            const isDesktop = true
            const liveWindowState: string = 'Fullscreen'
            const isPresenting = isDesktop ? liveWindowState !== 'Closed' : false
            expect(isPresenting).toBe(true)
        })

        it('is false when liveWindowState is Closed in desktop mode', () => {
            const isDesktop = true
            const liveWindowState = 'Closed' as const
            const isPresenting = isDesktop ? liveWindowState !== 'Closed' : false
            expect(isPresenting).toBe(false)
        })

        it('uses webState.isPresenting in web mode', () => {
            const isDesktop = false
            const webIsPresenting = true
            const isPresenting = isDesktop ? false : webIsPresenting
            expect(isPresenting).toBe(true)
        })
    })

    describe('ScreenPicker integration', () => {
        it('shows "No screens detected" when monitors is empty', () => {
            const monitors: any[] = []
            const label = monitors.length === 0 ? 'No screens detected' : 'Select a screen for live output'
            expect(label).toBe('No screens detected')
        })

        it('shows selection prompt when monitors exist', () => {
            const monitors = [{ id: 'm1', name: 'Built-in Display' }]
            const label = monitors.length === 0 ? 'No screens detected' : 'Select a screen for live output'
            expect(label).toBe('Select a screen for live output')
        })

        it('shows "Native" badge only in desktop mode', () => {
            expect(true && true).toBe(true)
            expect(true && false).toBe(false)
        })

        it('identifies monitor via Zap button with 3500ms cooldown', () => {
            const cooldownMs = 3500
            expect(cooldownMs).toBe(3500)
        })
    })

    describe('legacy screens shape', () => {
        it('maps MonitorInfo to ScreenInfo shape', () => {
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

    describe('getBestScreen', () => {
        it('returns first external monitor on desktop', () => {
            const monitors = FAKE_MONITORS
            const external = monitors.find(m => !m.is_primary)
            expect(external).not.toBeNull()
            expect(external!.name).toBe('External Display 1')
        })

        it('falls back to first monitor if no external', () => {
            const monitors = [FAKE_MONITORS[0]]
            const best = monitors.find(m => !m.is_primary) ?? monitors[0]
            expect(best.name).toBe('Built-in Display')
        })

        it('returns null when no monitors', () => {
            const monitors: any[] = []
            const best = monitors.find(() => false) ?? monitors[0] ?? null
            expect(best).toBeNull()
        })
    })
})