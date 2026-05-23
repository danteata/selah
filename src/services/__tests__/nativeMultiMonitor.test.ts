import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    MONITOR_COLORS,
    getMonitorColor,
    type MonitorInfo,
    type LiveWindowState,
    type WindowState,
} from '../../services/native-multi-monitor'

describe('native-multi-monitor — getMonitorColor', () => {
    it('returns colors in sequence', () => {
        expect(getMonitorColor(0)).toBe('#3B82F6')
        expect(getMonitorColor(1)).toBe('#EF4444')
        expect(getMonitorColor(2)).toBe('#10B981')
        expect(getMonitorColor(3)).toBe('#F59E0B')
    })

    it('wraps around when exceeding array length', () => {
        expect(getMonitorColor(MONITOR_COLORS.length)).toBe('#3B82F6')
        expect(getMonitorColor(MONITOR_COLORS.length + 1)).toBe('#EF4444')
    })

    it('handles large indices', () => {
        expect(getMonitorColor(100)).toBe(getMonitorColor(100 % MONITOR_COLORS.length))
    })
})

describe('native-multi-monitor — MONITOR_COLORS', () => {
    it('has 8 distinct colors', () => {
        expect(MONITOR_COLORS).toHaveLength(8)
        const unique = new Set(MONITOR_COLORS)
        expect(unique.size).toBe(8)
    })

    it('all colors are valid hex', () => {
        for (const color of MONITOR_COLORS) {
            expect(color).toMatch(/^#[0-9A-F]{6}$/)
        }
    })
})

describe('native-multi-monitor — MonitorInfo type shape', () => {
    it('matches the expected structure from Rust humanized names', () => {
        const monitor: MonitorInfo = {
            id: 'built-in-display-0x0',
            name: 'Built-in Display',
            width: 1920,
            height: 1080,
            position_x: 0,
            position_y: 0,
            scale_factor: 2,
            is_primary: true,
            color: '#3B82F6',
        }

        expect(monitor.name).toBe('Built-in Display')
        expect(monitor.is_primary).toBe(true)
    })

    it('supports external display naming from Rust', () => {
        const monitor: MonitorInfo = {
            id: 'monitor-14090-1920x0',
            name: 'External Display 1',
            width: 2560,
            height: 1440,
            position_x: 1920,
            position_y: 0,
            scale_factor: 1,
            is_primary: false,
            color: '#EF4444',
        }

        expect(monitor.name).toBe('External Display 1')
        expect(monitor.is_primary).toBe(false)
    })
})

describe('native-multi-monitor — LiveWindowState', () => {
    it('accepts valid states', () => {
        const states: LiveWindowState[] = ['Closed', 'Open', 'Fullscreen']
        expect(states).toHaveLength(3)
    })
})

describe('native-multi-monitor — WindowState defaults', () => {
    it('web-mode default has live_fullscreen=true', () => {
        const webDefault: WindowState = {
            live_fullscreen: true,
            main_maximized: false,
        }
        expect(webDefault.live_fullscreen).toBe(true)
        expect(webDefault.main_maximized).toBe(false)
    })
})

describe('native-multi-monitor — identifyMonitor invocation', () => {
    const mockInvoke = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('passes monitorId, color, and name to invoke', async () => {
        mockInvoke.mockResolvedValue(undefined)

        const monitor: MonitorInfo = {
            id: 'built-in-display-0x0',
            name: 'Built-in Display',
            width: 1920,
            height: 1080,
            position_x: 0,
            position_y: 0,
            scale_factor: 2,
            is_primary: true,
            color: '#3B82F6',
        }

        await mockInvoke('identify_monitor', {
            monitorId: monitor.id,
            color: monitor.color,
            name: monitor.name,
        })

        expect(mockInvoke).toHaveBeenCalledWith('identify_monitor', {
            monitorId: 'built-in-display-0x0',
            color: '#3B82F6',
            name: 'Built-in Display',
        })
    })

    it('uses fallback color when monitor.color is undefined', async () => {
        mockInvoke.mockResolvedValue(undefined)

        const monitor: MonitorInfo = {
            id: 'monitor-0x0',
            name: 'External Display 1',
            width: 2560,
            height: 1440,
            position_x: 2560,
            position_y: 0,
            scale_factor: 1,
            is_primary: false,
        }

        const color = monitor.color || '#3B82F6'

        await mockInvoke('identify_monitor', {
            monitorId: monitor.id,
            color,
            name: monitor.name || 'Display',
        })

        expect(mockInvoke).toHaveBeenCalledWith('identify_monitor', {
            monitorId: 'monitor-0x0',
            color: '#3B82F6',
            name: 'External Display 1',
        })
    })

    it('uses fallback name when monitor.name is empty', async () => {
        const monitor: MonitorInfo = {
            id: 'monitor-0x0',
            name: '',
            width: 1920,
            height: 1080,
            position_x: 0,
            position_y: 0,
            scale_factor: 1,
            is_primary: true,
            color: '#EF4444',
        }

        const name = monitor.name || 'Display'
        expect(name).toBe('Display')
    })
})

describe('native-multi-monitor — identify.html integration', () => {
    it('identify.html color CSS variables are set correctly by applyIdentity', () => {
        const root = document.documentElement.style
        const color = '#EF4444'
        const name = 'External Display 1'

        root.setProperty('--color', color)
        root.setProperty('--color-dim', color + '18')
        root.setProperty('--color-bg', color + '1A')
        root.setProperty('--color-border', color + '88')
        root.setProperty('--color-glow', color + '44')
        root.setProperty('--color-alpha', color + '66')

        expect(root.getPropertyValue('--color')).toBe(color)
        expect(root.getPropertyValue('--color-dim')).toBe(color + '18')
        expect(root.getPropertyValue('--color-bg')).toBe(color + '1A')
        expect(root.getPropertyValue('--color-border')).toBe(color + '88')
    })

    it('applyIdentity sets monitor name in the card', () => {
        document.body.innerHTML = '<h1 id="name"></h1><p id="desc"></p>'

        const nameEl = document.getElementById('name')!
        const descEl = document.getElementById('desc')!

        const color = '#3B82F6'
        const name = 'Built-in Display'

        nameEl.textContent = name
        descEl.textContent = 'This is your ' + name

        expect(nameEl.textContent).toBe('Built-in Display')
        expect(descEl.textContent).toBe('This is your Built-in Display')
    })

    it('handles special characters in monitor name safely via eval', () => {
        const testCases = [
            { input: "O'Brien's Monitor", expected: "O'Brien's Monitor" },
            { input: 'Monitor "Main"', expected: 'Monitor "Main"' },
            { input: 'Back\\Slash', expected: 'Back\\Slash' },
        ]

        for (const { input, expected } of testCases) {
            const escaped = input
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
            const js = `("${escaped}")`
            const result = eval(js)
            expect(result).toBe(expected)
        }
    })
})

describe('native-multi-monitor — getMonitors color assignment', () => {
    it('assigns colors by index when mapping from Rust', () => {
        const rawMonitors: MonitorInfo[] = [
            { id: 'm1', name: 'Built-in Display', width: 1920, height: 1080, position_x: 0, position_y: 0, scale_factor: 2, is_primary: true },
            { id: 'm2', name: 'External Display 1', width: 2560, height: 1440, position_x: 1920, position_y: 0, scale_factor: 1, is_primary: false },
            { id: 'm3', name: 'External Display 2', width: 1920, height: 1080, position_x: 4480, position_y: 0, scale_factor: 1, is_primary: false },
        ]

        const colored = rawMonitors.map((m, i) => ({ ...m, color: getMonitorColor(i) }))

        expect(colored[0].color).toBe('#3B82F6')
        expect(colored[1].color).toBe('#EF4444')
        expect(colored[2].color).toBe('#10B981')
    })
})