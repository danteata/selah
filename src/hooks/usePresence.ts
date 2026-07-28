import { useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useConvexAuth } from 'convex/react'
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

export function usePresence(
    churchId?: string,
    liveSessionId?: Id<"liveSessions">,
    sessionRole?: 'operator' | 'contributor' | 'viewer',
): UsePresenceReturn {
    const { isOffline } = useConvexConnection()
    const { currentUser } = useUserRole()
    // The authoritative "will a Convex function see an identity" signal.
    // `currentUser` is not that: it can come from the cached IndexedDB session,
    // so it stays truthy across a reconnect while the token is still being
    // re-minted — and every heartbeat in that window came back as a logged
    // "Not authenticated" server error.
    const { isAuthenticated } = useConvexAuth()

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
        if (isOffline || !currentUser || !isAuthenticated) return

        try {
            await heartbeatMutation({
                location,
                activeScheduleId,
                liveSessionId: sessionLiveId,
                sessionRole,
                selectedSlideId,
            })
        } catch (err) {
            // Presence is best-effort: a missed ping just means someone's dot
            // lingers for a few seconds. Never escalate it.
            console.warn('[usePresence] Heartbeat failed:', err)
        }
    }, [isOffline, currentUser, isAuthenticated, heartbeatMutation])

    const cleanup = useCallback(async () => {
        if (isOffline || !isAuthenticated) return

        try {
            await leavePresenceMutation()
        } catch (err) {
            console.warn('[usePresence] Leave presence failed:', err)
        }
    }, [isOffline, isAuthenticated, leavePresenceMutation])

    useEffect(() => {
        if (isOffline || !currentUser || !churchId || !isAuthenticated) return

        heartbeat(
            liveSessionId ? 'live' : 'dashboard',
            undefined,
            liveSessionId,
            sessionRole,
        )

        heartbeatTimerRef.current = setInterval(() => {
            heartbeat(
                liveSessionId ? 'live' : 'dashboard',
                undefined,
                liveSessionId,
                sessionRole,
            )
        }, HEARTBEAT_INTERVAL)

        return () => {
            if (heartbeatTimerRef.current) {
                clearInterval(heartbeatTimerRef.current)
                heartbeatTimerRef.current = null
            }
        }
    }, [isOffline, currentUser, churchId, liveSessionId, sessionRole, isAuthenticated, heartbeat])

    useEffect(() => {
        const handleBeforeUnload = () => {
            if (!isOffline) {
                leavePresenceMutation()
            }
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && churchId && !isOffline) {
                heartbeat('away', undefined, liveSessionId, sessionRole)
            } else if (document.visibilityState === 'visible' && churchId && !isOffline) {
                heartbeat(
                    liveSessionId ? 'live' : 'dashboard',
                    undefined,
                    liveSessionId,
                    sessionRole,
                )
            }
        }

        window.addEventListener('beforeunload', handleBeforeUnload)
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [churchId, isOffline, liveSessionId, sessionRole, heartbeat, leavePresenceMutation])

    return {
        onlineUsers: (onlineUsers as PresenceUser[] | undefined) || [],
        sessionUsers: (sessionUsers as PresenceUser[] | undefined) || [],
        heartbeat,
        cleanup,
    }
}
