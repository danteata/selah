import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const createSchedule = vi.hoisted(() => vi.fn(async () => 'sched_new'))
vi.mock('convex/react', () => ({
    useQuery: () => undefined,
    useMutation: () => createSchedule,
}))
vi.mock('../useUserRole', () => ({ useUserRole: () => ({ currentUser: { _id: 'u1', churchId: 'c1' } }) }))
vi.mock('../../providers/ConvexConnectionProvider', () => ({ useConvexConnection: () => ({ isOffline: false }) }))

import { useAppStore } from '../../store/appStore'
import { useSchedules } from '../useSchedules'

describe('useSchedules.createSchedule', () => {
    beforeEach(() => {
        useAppStore.setState({ activeSchedule: null })
    })

    it('opens the schedule it creates online, as it does offline', async () => {
        // Online it stayed "No Schedule" until picked from the list.
        const { result } = renderHook(() => useSchedules())
        await act(async () => { await result.current.createSchedule('Sunday Service') })
        expect(useAppStore.getState().activeSchedule).toMatchObject({ _id: 'sched_new', name: 'Sunday Service' })
    })
})
