import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

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
    getCachedAuthSession: vi.fn(),
    cacheAuthSession: vi.fn(),
}))

import { useUserRole, hasRequiredRole } from '../useUserRole'
import { useAuth } from '@clerk/clerk-react'
import { useQuery } from 'convex/react'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { getCachedAuthSession, cacheAuthSession } from '../useIndexedDB'

const mockUseAuth = vi.mocked(useAuth) as any
const mockUseQuery = vi.mocked(useQuery) as any
const mockUseConvexConnection = vi.mocked(useConvexConnection) as any
const mockGetCachedAuthSession = vi.mocked(getCachedAuthSession) as any
const mockCacheAuthSession = vi.mocked(cacheAuthSession) as any

function createCachedSession(overrides?: Partial<{
    id: string
    clerkId: string
    role: string
    cachedAt: string
}>): any {
    return {
        id: 'session_user_123',
        clerkId: 'user_123',
        email: 'test@example.com',
        fullname: 'Test User',
        role: 'member',
        avatar: '',
        churchId: 'church_1',
        churchName: '',
        cachedAt: new Date().toISOString(),
        ...overrides,
    }
}

describe('useUserRole', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockUseAuth.mockReturnValue({ userId: 'user_123', isLoaded: true, isSignedIn: true })
        mockUseConvexConnection.mockReturnValue({ isOffline: false })
        mockUseQuery.mockReturnValue(undefined)
        mockGetCachedAuthSession.mockResolvedValue(null)
    })

    // -----------------------------------------------------------------------
    // Loading states
    // -----------------------------------------------------------------------
    it('returns isLoading=true when session has not loaded and no cached session', async () => {
        mockUseQuery.mockReturnValue(undefined)
        mockGetCachedAuthSession.mockResolvedValue(null)

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => {
            expect(result.current.isLoading).toBe(true)
        })
    })

    it('returns isLoading=false once session is loaded', async () => {
        mockUseQuery.mockReturnValue({ _id: 'u1', role: 'member', churchId: 'c1' })
        mockGetCachedAuthSession.mockResolvedValue(null)

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false)
        })
    })

    // -----------------------------------------------------------------------
    // Role derivation from Convex user
    // -----------------------------------------------------------------------
    it('derives member role from Convex user', async () => {
        mockUseQuery.mockReturnValue({ _id: 'u1', role: 'member', churchId: 'c1' })
        mockGetCachedAuthSession.mockResolvedValue(null)

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.role).toBe('member')
        expect(result.current.isMember).toBe(true)
        expect(result.current.isAdmin).toBe(false)
        expect(result.current.isSuperadmin).toBe(false)
        expect(result.current.canAccessAdmin).toBe(false)
    })

    it('derives admin role from Convex user', async () => {
        mockUseQuery.mockReturnValue({ _id: 'u1', role: 'admin', churchId: 'c1' })
        mockGetCachedAuthSession.mockResolvedValue(null)

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.role).toBe('admin')
        expect(result.current.isAdmin).toBe(true)
        expect(result.current.canAccessAdmin).toBe(true)
    })

    it('derives superadmin role from Convex user', async () => {
        mockUseQuery.mockReturnValue({ _id: 'u1', role: 'superadmin', churchId: 'c1' })
        mockGetCachedAuthSession.mockResolvedValue(null)

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.role).toBe('superadmin')
        expect(result.current.isSuperadmin).toBe(true)
        expect(result.current.isAdmin).toBe(true)
        expect(result.current.canAccessAdmin).toBe(true)
    })

    // -----------------------------------------------------------------------
    // Cached session fallback
    // -----------------------------------------------------------------------
    it('falls back to cached session when Convex user is undefined but cache exists', async () => {
        mockUseQuery.mockReturnValue(undefined)
        mockGetCachedAuthSession.mockResolvedValue(createCachedSession({ role: 'admin' }))

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => expect(result.current.role).toBe('admin'))

        expect(result.current.role).toBe('admin')
        expect(result.current.isCachedSession).toBe(false) // not offline
    })

    it('ignores expired cached session', async () => {
        mockUseQuery.mockReturnValue(undefined)
        const expired = createCachedSession({
            cachedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        })
        mockGetCachedAuthSession.mockResolvedValue(expired)

        const { result } = renderHook(() => useUserRole())

        // Wait for cache check to complete
        await waitFor(() => expect(result.current.isLoading).toBe(true))

        expect(result.current.role).toBeNull()
        expect(result.current.currentUser).toBeNull()
    })

    // -----------------------------------------------------------------------
    // Offline mode
    // -----------------------------------------------------------------------
    it('enters offline mode when isOffline, no Convex user, and cache exists', async () => {
        mockUseAuth.mockReturnValue({ userId: 'user_123' })
        mockUseConvexConnection.mockReturnValue({ isOffline: true })
        mockUseQuery.mockReturnValue(undefined)
        mockGetCachedAuthSession.mockResolvedValue(createCachedSession({ role: 'member' }))

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => expect(result.current.isOfflineMode).toBe(true))

        expect(result.current.isOfflineMode).toBe(true)
        expect(result.current.isCachedSession).toBe(true)
        expect(result.current.role).toBe('member')
    })

    it('does NOT enter offline mode when Convex user is defined', async () => {
        mockUseConvexConnection.mockReturnValue({ isOffline: true })
        mockUseQuery.mockReturnValue({ _id: 'u1', role: 'member', churchId: 'c1' })
        mockGetCachedAuthSession.mockResolvedValue(createCachedSession({ role: 'admin' }))

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.isOfflineMode).toBe(false)
        expect(result.current.role).toBe('member') // Convex takes precedence
    })

    // -----------------------------------------------------------------------
    // Caching behavior
    // -----------------------------------------------------------------------
    it('caches session when Convex user and clerkId are available', async () => {
        mockUseAuth.mockReturnValue({ userId: 'user_123' })
        mockUseQuery.mockReturnValue({
            _id: 'u1',
            role: 'admin',
            churchId: 'c1',
            email: 'a@b.com',
            fullname: 'A B',
            avatar: 'url',
        })
        mockGetCachedAuthSession.mockResolvedValue(null)

        const { rerender } = renderHook(() => useUserRole())
        rerender() // trigger effect re-evaluation

        await waitFor(() => expect(mockCacheAuthSession).toHaveBeenCalled(), { timeout: 500 })

        expect(mockCacheAuthSession).toHaveBeenCalledWith(
            expect.objectContaining({
                clerkId: 'user_123',
                role: 'admin',
                churchId: 'c1',
            })
        )
    })

    it('does not cache when clerkId is missing', async () => {
        mockUseAuth.mockReturnValue({ userId: null })
        mockUseQuery.mockReturnValue({ _id: 'u1', role: 'member' })
        mockGetCachedAuthSession.mockResolvedValue(null)

        renderHook(() => useUserRole())

        // give effect time to not fire
        await new Promise(r => setTimeout(r, 100))
        expect(mockCacheAuthSession).not.toHaveBeenCalled()
    })

    // -----------------------------------------------------------------------
    // No auth
    // -----------------------------------------------------------------------
    it('returns null role when user is not signed in', async () => {
        mockUseAuth.mockReturnValue({ userId: null, isSignedIn: false })
        mockUseQuery.mockReturnValue(undefined)
        mockGetCachedAuthSession.mockResolvedValue(null)

        const { result } = renderHook(() => useUserRole())

        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.role).toBeNull()
        expect(result.current.currentUser).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// hasRequiredRole helper (pure function, no React needed)
// ---------------------------------------------------------------------------
describe('hasRequiredRole', () => {
    it('superadmin satisfies admin requirement', () => {
        expect(hasRequiredRole('superadmin', 'admin')).toBe(true)
    })

    it('superadmin satisfies member requirement', () => {
        expect(hasRequiredRole('superadmin', 'member')).toBe(true)
    })

    it('admin satisfies admin requirement', () => {
        expect(hasRequiredRole('admin', 'admin')).toBe(true)
    })

    it('admin does NOT satisfy superadmin requirement', () => {
        expect(hasRequiredRole('admin', 'superadmin')).toBe(false)
    })

    it('member only satisfies member requirement', () => {
        expect(hasRequiredRole('member', 'member')).toBe(true)
        expect(hasRequiredRole('member', 'admin')).toBe(false)
        expect(hasRequiredRole('member', 'superadmin')).toBe(false)
    })
})
