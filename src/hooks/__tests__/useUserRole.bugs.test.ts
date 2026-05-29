/**
 * AGGRESSIVE BUG-FINDING TESTS for useUserRole
 *
 * These tests are designed to expose real implementation bugs,
 * not just confirm happy-path behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/clerk-react', () => ({
    useAuth: vi.fn(),
}))

vi.mock('convex/react', () => ({
    useQuery: vi.fn(),
}))

vi.mock('../../convex/_generated/api', () => ({
    api: { users: { getCurrentUser: {} } },
}))

vi.mock('../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: vi.fn(),
}))

vi.mock('../useIndexedDB', () => ({
    getCachedAuthSession: vi.fn().mockResolvedValue(null),
    cacheAuthSession: vi.fn().mockResolvedValue(undefined),
}))

import { useUserRole } from '../useUserRole'
import { useAuth } from '@clerk/clerk-react'
import { useQuery } from 'convex/react'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'

const mockUseAuth = vi.mocked(useAuth) as any
const mockUseQuery = vi.mocked(useQuery) as any
const mockUseConvexConnection = vi.mocked(useConvexConnection) as any

describe('useUserRole — BUG HUNTING', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockUseAuth.mockReturnValue({ userId: 'user_123' })
        mockUseConvexConnection.mockReturnValue({ isOffline: false })
        mockUseQuery.mockReturnValue(undefined)
    })

    // -----------------------------------------------------------------------
    // BUG 1: isLoading flips to false while Convex is still loading
    // -----------------------------------------------------------------------
    it('[BUG 1] isLoading should remain true while Convex user is undefined', async () => {
        // Session loads from IndexedDB quickly (no cache)
        // But Convex useQuery is still loading (undefined)
        const { result } = await import('@testing-library/react').then((rtl) =>
            rtl.renderHook(() => useUserRole())
        )

        // Wait for IndexedDB cache check to complete
        await new Promise((r) => setTimeout(r, 50))

        // At this point:
        // - sessionLoaded = true (cache check done)
        // - currentUser = undefined (Convex still loading)
        // - cachedSession = null
        //
        // EXPECTED: isLoading should be TRUE (still waiting for server)
        // ACTUAL: isLoading is FALSE because sessionLoaded is true
        expect(result.current.isLoading).toBe(true)
    })

    // -----------------------------------------------------------------------
    // BUG 2: Stale cached session shown when server returns null
    // -----------------------------------------------------------------------
    it('[BUG 2] should not fall back to cached session when server returns null', async () => {
        const { getCachedAuthSession } = await import('../useIndexedDB')
        const mockGetCached = vi.mocked(getCachedAuthSession) as any
        mockGetCached.mockResolvedValue({
            id: 'session_old',
            clerkId: 'user_123',
            email: 'old@example.com',
            fullname: 'Old User',
            role: 'admin',
            avatar: '',
            churchId: 'c1',
            churchName: '',
            cachedAt: new Date().toISOString(),
        })

        // Convex explicitly returns null (user not found / deleted)
        mockUseQuery.mockReturnValue(null)

        const { result } = await import('@testing-library/react').then((rtl) =>
            rtl.renderHook(() => useUserRole())
        )

        await new Promise((r) => setTimeout(r, 50))

        // EXPECTED: role should be null (user deleted on server)
        // ACTUAL: role is 'admin' from stale cache
        expect(result.current.role).toBeNull()
    })
})
