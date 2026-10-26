/**
 * A phone linked to the desk on its Wi-Fi runs the live session through the
 * desk: Convex isn't asked anything, the sync owner's pushes stay off (the
 * desk shares the service order, not the phone), and the session's actions
 * become requests to the desk.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { getFunctionName } from 'convex/server'

const subscribed = vi.hoisted(() => new Set<string>())
const mutations = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>())
const sent = vi.hoisted(() => [] as Array<{ k: string }>)

vi.mock('convex/react', () => ({
    useQuery: (ref: unknown, args: unknown) => {
        if (args !== 'skip') subscribed.add(getFunctionName(ref as never))
        return undefined
    },
    useMutation: (ref: unknown) => {
        const name = getFunctionName(ref as never)
        if (!mutations.has(name)) mutations.set(name, vi.fn(async () => null))
        return mutations.get(name)
    },
}))
vi.mock('../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: () => ({ isConvexConnected: true, isOffline: false }),
}))
vi.mock('../useUserRole', () => ({ useUserRole: () => ({ currentUser: { _id: 'u2', churchId: 'c1' } }) }))
vi.mock('../useAnalytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }))
vi.mock('../../services/lan/link', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/lan/link')>()),
    sendCommand: vi.fn(async (cmd: { k: string }) => { sent.push(cmd) }),
}))

import { useLiveSession } from '../useLiveSession'
import { useAppStore } from '../../store/appStore'
import { useLanLink } from '../../services/lan/link'

const slide = (id: string) => ({
    id, index: 0, name: id, type: 'text', layout: 'full-text', userId: '', churchId: 'c1', scheduleId: 'sched1', contents: [id],
})

describe('useLiveSession on a phone linked to the desk', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        subscribed.clear()
        mutations.clear()
        sent.length = 0
        useAppStore.getState().signOut()
        useAppStore.setState({
            activeSchedule: { _id: 'sched1', name: 'Sunday', authorId: '', editorIds: [], churchId: 'c1' },
            activeSlides: [slide('a'), slide('b')],
            liveOutputSlidesId: ['a', 'b'],
        })
        useLanLink.setState({
            status: 'connected',
            role: 'contributor',
            desk: { id: 'd1', name: 'Main desk', addresses: [], port: 17494 },
            session: {
                scheduleId: 'sched1', scheduleName: 'Sunday', churchId: 'c1', mode: 'moderated', liveSlideId: 'a',
                blank: false, overlay: 'none', deck: ['a', 'b'], queue: [], defaultTemplates: null, heardVerses: [], convexSessionId: null,
            },
        })
    })

    afterEach(() => {
        useLanLink.setState({ status: 'idle', session: null, desk: null })
        vi.useRealTimers()
    })

    it("subscribes to nothing in Convex and doesn't push the phone's service order", async () => {
        const { result } = renderHook(() => useLiveSession(undefined, { sync: true }))
        useAppStore.getState().appendActiveSlides([slide('c')])
        await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

        expect([...subscribed]).toEqual([])
        expect([...mutations.values()].every((fn) => fn.mock.calls.length === 0)).toBe(true)
        expect(result.current).toMatchObject({ isConnected: true, isResolving: false, sessionRole: 'contributor', sessionScheduleId: 'sched1' })
    })

    it("suggests a contributor's slide to the desk, showing it at once", async () => {
        const { result } = renderHook(() => useLiveSession())
        await act(async () => { await result.current.addToQueue(['b']) })
        expect(useAppStore.getState().sharedQueueSlideIds).toEqual(['b'])
        expect(sent).toEqual([expect.objectContaining({ k: 'add', slides: [expect.objectContaining({ id: 'b' })] })])
    })

    it('goes back to Convex when the link drops', () => {
        const { result, rerender } = renderHook(() => useLiveSession(undefined, { sync: true }))
        expect(result.current.isConnected).toBe(true)
        act(() => useLanLink.setState({ status: 'idle', session: null }))
        rerender()
        expect(subscribed.has('liveSessions:getActiveSession')).toBe(true)
    })
})
