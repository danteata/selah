import { useQuery } from 'convex/react'
import { useAuth } from '@clerk/clerk-react'
import { api } from '../../convex/_generated/api'

export type UserRole = 'superadmin' | 'admin' | 'member'

export interface UseUserRoleReturn {
    role: UserRole | null
    isLoading: boolean
    isSuperadmin: boolean
    isAdmin: boolean
    isMember: boolean
    canAccessAdmin: boolean
    currentUser: any | null
}

export function useUserRole(): UseUserRoleReturn {
    const { userId: clerkId } = useAuth()

    // Get current user from Convex
    const currentUser = useQuery(
        api.users.getCurrentUser,
        clerkId ? { clerkId } : 'skip'
    )

    const role = (currentUser?.role as UserRole) || null
    const isLoading = currentUser === undefined

    return {
        role,
        isLoading,
        isSuperadmin: role === 'superadmin',
        isAdmin: role === 'admin' || role === 'superadmin',
        isMember: role === 'member',
        canAccessAdmin: role === 'superadmin' || role === 'admin',
        currentUser,
    }
}

// Role hierarchy helper
export function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean {
    const roleHierarchy: Record<UserRole, number> = {
        superadmin: 3,
        admin: 2,
        member: 1,
    }
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole]
}
