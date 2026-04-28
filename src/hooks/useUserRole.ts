import { useQuery } from 'convex/react'
import { useAuth } from '@clerk/clerk-react'
import { api } from '../../convex/_generated/api'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { getCachedAuthSession, cacheAuthSession, type CachedAuthSession } from './useIndexedDB'
import { useState, useEffect } from 'react'

export type UserRole = 'superadmin' | 'admin' | 'member'

export interface UseUserRoleReturn {
    role: UserRole | null
    isLoading: boolean
    isSuperadmin: boolean
    isAdmin: boolean
    isMember: boolean
    canAccessAdmin: boolean
    currentUser: any | null
    isOfflineMode: boolean
    isCachedSession: boolean
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function useUserRole(): UseUserRoleReturn {
    const { userId: clerkId } = useAuth()
    const { isOffline } = useConvexConnection()

    const [cachedSession, setCachedSession] = useState<CachedAuthSession | null>(null)
    const [sessionLoaded, setSessionLoaded] = useState(false)

    const currentUser = useQuery(
        api.users.getCurrentUser,
        clerkId ? { clerkId } : 'skip'
    )

    useEffect(() => {
        let cancelled = false
        const loadCache = async () => {
            try {
                const cached = await getCachedAuthSession()
                if (!cancelled && cached) {
                    const age = Date.now() - new Date(cached.cachedAt).getTime()
                    if (age < SESSION_MAX_AGE_MS) {
                        setCachedSession(cached)
                    }
                }
            } catch (err) {
                console.warn('[useUserRole] Failed to load cached session:', err)
            } finally {
                setSessionLoaded(true)
            }
        }
        loadCache()
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        if (!currentUser || !clerkId) return

        const user = currentUser as any
        cacheAuthSession({
            id: `session_${clerkId}`,
            clerkId,
            email: user.email || '',
            fullname: user.fullname || '',
            role: user.role || 'member',
            avatar: user.avatar || '',
            churchId: user.churchId || '',
            churchName: '',
        }).catch((err) => {
            console.warn('[useUserRole] Failed to cache session:', err)
        })
    }, [currentUser, clerkId])

    const isOfflineMode = isOffline && currentUser === undefined && cachedSession !== null
    const isCachedSession = isOfflineMode

    const effectiveUser = currentUser ?? (cachedSession ? {
        ...cachedSession,
        _id: cachedSession.id,
        role: cachedSession.role,
    } : null)

    const role = (effectiveUser?.role as UserRole) || null
    const isLoading = !sessionLoaded && currentUser === undefined && !cachedSession

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