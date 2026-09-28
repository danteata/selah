/**
 * The live session's background sync runs in exactly one mounted copy of the
 * hook. Every component used to run it, so one slide edit sent a whole-deck
 * sync per copy (~10), each able to delete what it didn't know about.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { getFunctionName } from 'convex/server'

const session = {
    _id: 'sess1',
    status: 'active',
    operatorId: 'u1',
    scheduleId: 'sched1',
    collaborationMode: 'moderated',
    operatorSlideIds: [],
    queue: [],
}

const queryResults: Record<string, unknown> = {}
const mutations = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>())

vi.mock('convex/react', () => ({
    useQuery: (ref: unknown, args: unknown) => (args === 'skip' ? undefined : queryResults[getFunctionName(ref as never)]),
    useMutation: (ref: unknown) => {
        const name = getFunctionName(ref as never)
        if (!mutations.has(name)) mutations.set(name, vi.fn(async () => null))
        return mutations.get(name)
    },
}))
vi.mock('../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: () => ({ isConvexConnected: true, isOffline: false }),
}))
vi.mock('../useUserRole', () => ({ useUserRole: () => ({ currentUser: { _id: 'u1', churchId: 'c1' } }) }))
vi.mock('../useAnalytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }))

import { useLiveSession } from '../useLiveSession'
import { useAppStore } from '../../store/appStore'

const slide = (id: string, text = id) => ({
    id, index: 0, name: id, type: 'text', layout: 'full-text',
    userId: '', churchId: 'c1', scheduleId: 'sched1', contents: [text],
})

function calls(name: string) {
    return mutations.get(name)?.mock.calls ?? []
}

describe('useLiveSession background sync', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        mutations.clear()
        Object.assign(queryResults, {
            'liveSessions:getActiveSession': session,
            'liveSessions:getActiveSessionByChurch': [session],
            'liveSessions:getSession': session,
            'slides:getSlides': [],
        })
        useAppStore.getState().signOut()
        useAppStore.setState({
            activeSchedule: { _id: 'sched1', name: 'S', authorId: 'u1', editorIds: [], churchId: 'c1', createdAt: '', updatedAt: '' },
            activeSlides: [slide('a')],
            liveOutputSlidesId: ['a'],
        })
    })

    afterEach(() => vi.useRealTimers())

    it('pushes an operator edit once, however many copies are mounted', async () => {
        renderHook(() => {
            useLiveSession(undefined, { sync: true })
            useLiveSession()
            useLiveSession()
        })
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

        expect(calls('slides:applyScheduleSlideChanges')).toHaveLength(1)
        // The destructive whole-deck sync is no longer used at all.
        expect(calls('slides:syncScheduleSlides')).toHaveLength(0)
    })

    it('sends only what changed, and deletes only what the operator removed', async () => {
        renderHook(() => useLiveSession(undefined, { sync: true }))
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

        act(() => useAppStore.setState({ activeSlides: [slide('a', 'edited'), slide('b')] }))
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
        const [, second] = calls('slides:applyScheduleSlideChanges')
        expect(second[0].upserts.map((s: { id: string }) => s.id)).toEqual(['a', 'b'])
        expect(second[0].deletes).toEqual([])

        act(() => useAppStore.setState({ activeSlides: [slide('b')] }))
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
        const third = calls('slides:applyScheduleSlideChanges')[2]
        expect(third[0].upserts).toEqual([])
        expect(third[0].deletes).toEqual(['a'])
    })

    it('saves the service order when no live session is running', async () => {
        Object.assign(queryResults, {
            'liveSessions:getActiveSession': null,
            'liveSessions:getActiveSessionByChurch': [],
            'liveSessions:getSession': null,
        })
        renderHook(() => useLiveSession(undefined, { sync: true }))
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

        const [first] = calls('slides:applyScheduleSlideChanges')
        expect(first[0].scheduleId).toBe('sched1')
        expect(first[0].upserts.map((s: { id: string }) => s.id)).toEqual(['a'])
    })

    it('tries a failed save again on its own', async () => {
        Object.assign(queryResults, {
            'liveSessions:getActiveSession': null,
            'liveSessions:getActiveSessionByChurch': [],
            'liveSessions:getSession': null,
        })
        renderHook(() => useLiveSession(undefined, { sync: true }))
        const apply = mutations.get('slides:applyScheduleSlideChanges')!
        apply.mockRejectedValueOnce(new Error('network blip'))
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
        expect(apply).toHaveBeenCalledTimes(1)

        // No edit in between: the retry alone sends the same change again.
        await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
        // The retry's re-render lands as the act above ends; its send then waits
        // out the usual short debounce.
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
        expect(apply).toHaveBeenCalledTimes(2)
        expect(apply.mock.calls[1][0].upserts.map((s: { id: string }) => s.id)).toEqual(['a'])
    })

    it("doesn't write for a contributor in someone else's session", async () => {
        const theirs = { ...session, operatorId: 'someone-else' }
        Object.assign(queryResults, {
            'liveSessions:getActiveSession': theirs,
            'liveSessions:getActiveSessionByChurch': [theirs],
            'liveSessions:getSession': theirs,
        })
        renderHook(() => useLiveSession(undefined, { sync: true }))
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

        expect(calls('slides:applyScheduleSlideChanges')).toHaveLength(0)
    })

    it('copies that do not own the sync never write to the server', async () => {
        renderHook(() => useLiveSession())
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

        expect(calls('slides:applyScheduleSlideChanges')).toHaveLength(0)
        expect(calls('liveSessions:setOperatorSlides')).toHaveLength(0)
    })

    it('drops a slide someone else deleted on the server', async () => {
        queryResults['slides:getSlides'] = [slide('a'), slide('b')]
        useAppStore.setState({ activeSlides: [slide('a'), slide('b')], liveOutputSlidesId: ['a', 'b'] })
        const { rerender } = renderHook(() => useLiveSession(undefined, { sync: true }))
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

        // Another operator deleted b.
        queryResults['slides:getSlides'] = [slide('a')]
        rerender()
        await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

        const state = useAppStore.getState()
        expect(state.activeSlides.map((s) => s.id)).toEqual(['a'])
        expect(state.liveOutputSlidesId).toEqual(['a'])
    })
})
