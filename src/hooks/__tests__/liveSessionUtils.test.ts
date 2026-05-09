import { describe, it, expect } from 'vitest'
import { canClientPushLiveSlide, selectDiscoveredSession } from '../liveSessionUtils'

describe('canClientPushLiveSlide', () => {
    it('allows operator when connected and online', () => {
        expect(canClientPushLiveSlide({
            isConnected: true,
            isOffline: false,
            isOperator: true,
            isOpenMode: false,
        })).toBe(true)
    })

    it('allows contributor in open mode when connected and online', () => {
        expect(canClientPushLiveSlide({
            isConnected: true,
            isOffline: false,
            isOperator: false,
            isOpenMode: true,
        })).toBe(true)
    })

    it('rejects updates while offline or disconnected', () => {
        expect(canClientPushLiveSlide({
            isConnected: false,
            isOffline: false,
            isOperator: true,
            isOpenMode: true,
        })).toBe(false)
        expect(canClientPushLiveSlide({
            isConnected: true,
            isOffline: true,
            isOperator: true,
            isOpenMode: true,
        })).toBe(false)
    })
})

describe('selectDiscoveredSession', () => {
    it('returns null when active session already exists', () => {
        const result = selectDiscoveredSession({
            activeSessionId: 'session-live',
            activeScheduleId: 'sched-a',
            sessionsByChurch: [{ _id: 'session-a', scheduleId: 'sched-a' }],
        })
        expect(result).toBeNull()
    })

    it('prefers session matching active schedule', () => {
        const result = selectDiscoveredSession({
            activeSessionId: null,
            activeScheduleId: 'sched-b',
            sessionsByChurch: [
                { _id: 'session-a', scheduleId: 'sched-a' },
                { _id: 'session-b', scheduleId: 'sched-b' },
            ],
        })
        expect(result?._id).toBe('session-b')
    })

    it('returns null when multiple sessions exist and no schedule match', () => {
        const result = selectDiscoveredSession({
            activeSessionId: null,
            activeScheduleId: 'sched-c',
            sessionsByChurch: [
                { _id: 'session-a', scheduleId: 'sched-a' },
                { _id: 'session-b', scheduleId: 'sched-b' },
            ],
        })
        expect(result).toBeNull()
    })

    it('returns the only session when exactly one exists', () => {
        const result = selectDiscoveredSession({
            activeSessionId: null,
            activeScheduleId: null,
            sessionsByChurch: [{ _id: 'session-only', scheduleId: 'sched-a' }],
        })
        expect(result?._id).toBe('session-only')
    })
})
