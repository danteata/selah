import { useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useUserRole } from './useUserRole'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'

const HEARTBEAT_INTERVAL = 15_000

interface PresenceUser {
    _id: string
    userId: string
    churchId: string
    location: string
    activeScheduleId?: string
    liveSessionId?: Id<"liveSessions">
    sessionRole?: 'operator' | 'contributor' | 'viewer'
    selectedSlideId?: string
    lastSeen: number
    createdAt: string
    user: {
        _id: string
        fullname: string
        email: string
        avatar: string
        role: string
    } | null
}

interface UsePresenceReturn {
    onlineUsers: PresenceUser[]
    sessionUsers: PresenceUser[]
    heartbeat: (location?: string, activeScheduleId?: string, liveSessionId?: Id<"liveSessions">, sessionRole?: 'operator' | 'contributor' | 'viewer', selectedSlideId?: string) => void
    cleanup: () => void
}

export function usePresence(churchId?: string, liveSessionId?: Id<"liveSessions">): UsePresenceReturn {
    const { isOffline } = useConvexConnection()
    const { currentUser } = useUserRole()

    const heartbeatMutation = useMutation(api.presence.heartbeat)
    const leavePresenceMutation = useMutation(api.presence.leavePresence)

    const onlineUsers = useQuery(
        api.presence.getPresenceByChurch,
        churchId && !isOffline ? { churchId } : 'skip'
    )

    const sessionUsers = useQuery(
        api.presence.getPresenceBySession,
        liveSessionId && !isOffline ? { sessionId: liveSessionId } : 'skip'
    )

    const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const heartbeat = useCallback(async (
        location?: string,
        activeScheduleId?: string,
        sessionLiveId?: Id<"liveSessions">,
        sessionRole?: 'operator' | 'contributor' | 'viewer',
        selectedSlideId?: string,
    ) => {
        if (isOffline || !currentUser) return

        try {
            await heartbeatMutation({
                location,
                activeScheduleId,
                liveSessionId: sessionLiveId,
                sessionRole,
                selectedSlideId,
            })
        } catch (err) {
            console.warn('[usePresence] Heartbeat failed:', err)
        }
    }, [isOffline, currentUser, heartbeatMutation])

    const cleanup = useCallback(async () => {
        if (isOffline) return

        try {
            await leavePresenceMutation()
        } catch (err) {
            console.warn('[usePresence] Leave presence failed:', err)
        }
    }, [isOffline, leavePresenceMutation])

    useEffect(() => {
        if (isOffline || !currentUser || !churchId) return

        heartbeat('dashboard')

        heartbeatTimerRef.current = setInterval(() => {
            heartbeat('dashboard')
        }, HEARTBEAT_INTERVAL)

        return () => {
            if (heartbeatTimerRef.current) {
                clearInterval(heartbeatTimerRef.current)
                heartbeatTimerRef.current = null
            }
        }
    }, [isOffline, currentUser, churchId, heartbeat])

    useEffect(() => {
        const handleBeforeUnload = () => {
            if (!isOffline) {
                leavePresenceMutation()
            }
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && churchId && !isOffline) {
                heartbeat('away')
            } else if (document.visibilityState === 'visible' && churchId && !isOffline) {
                heartbeat('dashboard')
            }
        }

        window.addEventListener('beforeunload', handleBeforeUnload)
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [churchId, isOffline, heartbeat, leavePresenceMutation])

    return {
        onlineUsers: (onlineUsers as PresenceUser[] | undefined) || [],
        sessionUsers: (sessionUsers as PresenceUser[] | undefined) || [],
        heartbeat,
        cleanup,
    }
}