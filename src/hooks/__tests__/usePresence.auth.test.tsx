import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const heartbeatMutation = vi.fn().mockResolvedValue('presence-1')
const leaveMutation = vi.fn().mockResolvedValue(null)

let authState = { isLoading: false, isAuthenticated: true }
let offline = false
let currentUser: unknown = { _id: 'user-1', churchId: 'church-1' }

vi.mock('convex/react', () => ({
    useQuery: () => undefined,
    useMutation: (ref: unknown) => (String(ref).includes('leave') ? leaveMutation : heartbeatMutation),
    useConvexAuth: () => authState,
}))

vi.mock('../../../convex/_generated/api', () => ({
    api: { presence: { heartbeat: 'presence:heartbeat', leavePresence: 'presence:leavePresence', getPresenceByChurch: 'q1', getPresenceBySession: 'q2' } },
}))

vi.mock('../useUserRole', () => ({ useUserRole: () => ({ currentUser }) }))
vi.mock('../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: () => ({ isOffline: offline }),
}))

import { usePresence } from '../usePresence'

describe('usePresence auth gating', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        authState = { isLoading: false, isAuthenticated: true }
        offline = false
        currentUser = { _id: 'user-1', churchId: 'church-1' }
    })

    it('heartbeats once auth is established', () => {
        renderHook(() => usePresence('church-1'))
        expect(heartbeatMutation).toHaveBeenCalled()
    })

    it('does not heartbeat before Convex auth is established', () => {
        // The regression: `currentUser` survives a reconnect via the cached
        // session, so this used to fire and come back as a logged
        // "Not authenticated" server error every 15 seconds.
        authState = { isLoading: false, isAuthenticated: false }

        renderHook(() => usePresence('church-1'))

        expect(heartbeatMutation).not.toHaveBeenCalled()
    })

    it('does not heartbeat while offline', () => {
        offline = true
        renderHook(() => usePresence('church-1'))
        expect(heartbeatMutation).not.toHaveBeenCalled()
    })

    it('does not heartbeat before the user is known', () => {
        currentUser = null
        renderHook(() => usePresence('church-1'))
        expect(heartbeatMutation).not.toHaveBeenCalled()
    })

    it('skips the manual heartbeat call too, not just the interval', async () => {
        authState = { isLoading: false, isAuthenticated: false }
        const { result } = renderHook(() => usePresence('church-1'))

        await act(async () => { result.current.heartbeat('dashboard') })

        expect(heartbeatMutation).not.toHaveBeenCalled()
    })

    it('does not try to leave presence unauthenticated', async () => {
        authState = { isLoading: false, isAuthenticated: false }
        const { result } = renderHook(() => usePresence('church-1'))

        await act(async () => { await result.current.cleanup() })

        expect(leaveMutation).not.toHaveBeenCalled()
    })

    it('swallows a heartbeat rejection — a missed ping is not an error', async () => {
        heartbeatMutation.mockRejectedValueOnce(new Error('Not authenticated'))
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { result } = renderHook(() => usePresence('church-1'))

        await act(async () => { await result.current.heartbeat('dashboard') })

        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
})
