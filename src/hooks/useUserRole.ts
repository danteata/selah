import { useConvexAuth, useQuery } from 'convex/react'
import { useAuth } from '@clerk/clerk-react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { getCachedAuthSession, cacheAuthSession, type CachedAuthSession } from './useIndexedDB'
import { useState, useEffect } from 'react'

export type UserRole = 'superadmin' | 'admin' | 'member'

/** The signed-in user: the live Convex row, or the cached session standing in for it offline. */
export type CurrentUser = Doc<'users'> | (CachedAuthSession & { _id: string })

export interface UseUserRoleReturn {
    role: UserRole | null
    isLoading: boolean
    isSuperadmin: boolean
    isAdmin: boolean
    isMember: boolean
    canAccessAdmin: boolean
    currentUser: CurrentUser | null
    isOfflineMode: boolean
    isCachedSession: boolean
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function useUserRole(): UseUserRoleReturn {
    const { userId: clerkId } = useAuth()
    const { isAuthenticated } = useConvexAuth()
    const { isOffline } = useConvexConnection()

    // Keyed by the Clerk user it was loaded for, so a different person signing
    // in never sees the previous user's cached role while theirs loads.
    const [cache, setCache] = useState<{ clerkId: string | null; session: CachedAuthSession | null } | null>(null)
    const sessionLoaded = cache !== null && cache.clerkId === (clerkId ?? null)
    const cachedSession = sessionLoaded ? cache.session : null

    // Wait for Convex to hold the token, not just Clerk. The server resolves
    // the caller from that token, so asking a tick early answers `null` — which
    // reads as "no such user" rather than "still loading".
    const currentUser = useQuery(
        api.users.getCurrentUser,
        clerkId && isAuthenticated ? {} : 'skip'
    )

    useEffect(() => {
        let cancelled = false
        const loadCache = async () => {
            let session: CachedAuthSession | null = null
            try {
                const cached = clerkId ? await getCachedAuthSession(clerkId) : undefined
                if (cached) {
                    const age = Date.now() - new Date(cached.cachedAt).getTime()
                    if (age < SESSION_MAX_AGE_MS) session = cached
                }
            } catch (err) {
                console.warn('[useUserRole] Failed to load cached session:', err)
            } finally {
                if (!cancelled) setCache({ clerkId: clerkId ?? null, session })
            }
        }
        loadCache()
        return () => { cancelled = true }
    }, [clerkId])

    useEffect(() => {
        // Only a real user document. The offline stand-in client answers every
        // query with `[]`, and caching that overwrote a good admin session with
        // an empty member one.
        if (!clerkId || !currentUser || Array.isArray(currentUser) || !currentUser._id) return

        const user = currentUser
        Promise.resolve(cacheAuthSession({
            id: `session_${clerkId}`,
            clerkId,
            email: user.email || '',
            fullname: user.fullname || '',
            role: user.role || 'member',
            avatar: user.avatar || '',
            churchId: user.churchId || '',
            churchName: '',
        })).catch((err) => {
            console.warn('[useUserRole] Failed to cache session:', err)
        })
    }, [currentUser, clerkId])

    const isOfflineMode = isOffline && currentUser === undefined && cachedSession !== null
    const isCachedSession = isOfflineMode

    // Only fall back to cached session when Convex is still loading (undefined),
    // NOT when server explicitly returns null (user deleted/not found)
    const effectiveUser = currentUser === undefined
        ? (cachedSession ? {
            ...cachedSession,
            _id: cachedSession.id,
            role: cachedSession.role,
        } : null)
        : currentUser

    const role = (effectiveUser?.role as UserRole) || null
    // isLoading is true while cache hasn't been checked OR while Convex is still loading
    // and there's no valid cached session to fall back to
    const isLoading = !sessionLoaded || (!!clerkId && currentUser === undefined && !cachedSession)

    return {
        role,
        isLoading,
        isSuperadmin: role === 'superadmin',
        isAdmin: role === 'admin' || role === 'superadmin',
        isMember: role === 'member',
        canAccessAdmin: role === 'superadmin' || role === 'admin',
        currentUser: effectiveUser,
        isOfflineMode,
        isCachedSession,
    }
}

export function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean {
    const roleHierarchy: Record<UserRole, number> = {
        superadmin: 3,
        admin: 2,
        member: 1,
    }
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole]
}