import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useUserRole } from './useUserRole'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'

export function useCollaborationToasts(churchId?: string, liveSessionId?: Id<"liveSessions">) {
    const { currentUser } = useUserRole()
    const { isOffline } = useConvexConnection()
    const previousSessionRef = useRef<any | null>(null)
    const previousUsersRef = useRef<any[] | null>(null)

    const sharedSession = useQuery(
        api.liveSessions.getSession,
        liveSessionId && !isOffline ? { sessionId: liveSessionId } : 'skip'
    )

    const sessionUsers = useQuery(
        api.presence.getPresenceBySession,
        liveSessionId && !isOffline ? { sessionId: liveSessionId } : 'skip'
    )

    useEffect(() => {
        if (!sharedSession || !liveSessionId) return

        const prev = previousSessionRef.current
        previousSessionRef.current = sharedSession

        if (!prev) return // First load, skip
        if (prev._id !== sharedSession._id) return

        const selfId = currentUser?._id

        // Someone changed the live slide
        if (
            sharedSession.liveSlideId !== prev.liveSlideId &&
            sharedSession.liveSlideId &&
            sharedSession.operatorId !== selfId
        ) {
            toast.info('Live slide updated', {
                description: 'The operator changed the current slide.',
                duration: 3000,
            })
        }

        // Queue was reordered
        if (
            JSON.stringify(sharedSession.queuedSlideIds) !==
            JSON.stringify(prev.queuedSlideIds)
        ) {
            // Notify operator if a contributor added something
            if (sharedSession.operatorId === selfId) {
                const addedIds =
                    (sharedSession.queuedSlideIds || []).filter(
                        (id: string) => !(prev.queuedSlideIds || []).includes(id)
                    )
                if (addedIds.length > 0) {
                    toast.info('Queue updated', {
                        description: `A contributor added ${addedIds.length} slide${
                            addedIds.length > 1 ? 's' : ''
                        } to the queue.`,
                        duration: 4000,
                    })
                }
            }
        }

        // Blank screen toggled
        if (sharedSession.isBlank && sharedSession.isBlank !== prev.isBlank) {
            toast('Screen went blank', {
                description: 'The operator blanked the screen.',
                duration: 3000,
            })
        }

        // Session ended
        if (sharedSession.status === 'ended' && prev.status === 'active') {
            toast.warning('Live session ended')
        }
    }, [sharedSession, currentUser?._id, liveSessionId])

    useEffect(() => {
        if (!sessionUsers || !liveSessionId) return

        const prev = previousUsersRef.current
        previousUsersRef.current = sessionUsers

        if (!prev) return // First load, skip
        if (prev.length === sessionUsers.length) return

        const selfId = currentUser?._id

        const joined = sessionUsers.filter(
            (u: any) => !prev.find((p: any) => p.userId === u.userId)
        )
        const left = prev.filter(
            (p: any) => !sessionUsers.find((u: any) => u.userId === p.userId)
        )

        joined.forEach((entry: any) => {
            if (entry.userId !== selfId) {
                toast.success(
                    `${entry.user?.fullname || 'Someone'} joined the session`,
                    { duration: 3000 }
                )
            }
        })

        left.forEach((entry: any) => {
            if (entry.userId !== selfId) {
                toast.info(
                    `${entry.user?.fullname || 'Someone'} left the session`,
                    { duration: 3000 }
                )
            }
        })
    }, [sessionUsers, currentUser?._id, liveSessionId])
}
