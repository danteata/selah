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
    const previousSessionIdRef = useRef<string | null>(null)

    const sharedSession = useQuery(
        api.liveSessions.getSession,
        liveSessionId && !isOffline ? { sessionId: liveSessionId } : 'skip'
    )

    const sessionUsers = useQuery(
        api.presence.getPresenceBySession,
        liveSessionId && !isOffline ? { sessionId: liveSessionId } : 'skip'
    )

    useEffect(() => {
        if (previousSessionIdRef.current !== (liveSessionId || null)) {
            previousSessionRef.current = null
            previousUsersRef.current = null
            previousSessionIdRef.current = liveSessionId || null
        }
    }, [liveSessionId])

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
                description: 'The current slide changed in the live session.',
                duration: 3000,
            })
        }

        // Queue changed (handles both new `queue` and legacy `queuedSlideIds`)
        const currentQueue = sharedSession.queue || (sharedSession as any).queuedSlideIds || []
        const prevQueue = prev.queue || (prev as any).queuedSlideIds || []
        const currentQueueIds: string[] = Array.isArray(currentQueue) && currentQueue.length > 0 && typeof currentQueue[0] === 'object'
            ? (currentQueue as { slideId: string }[]).map((e) => e.slideId)
            : currentQueue as string[]
        const prevQueueIds: string[] = Array.isArray(prevQueue) && prevQueue.length > 0 && typeof prevQueue[0] === 'object'
            ? (prevQueue as { slideId: string }[]).map((e) => e.slideId)
            : prevQueue as string[]

        if (JSON.stringify(currentQueueIds) !== JSON.stringify(prevQueueIds)) {
            // Notify operator if a contributor suggested something
            if (sharedSession.operatorId === selfId) {
                const addedIds = currentQueueIds.filter(
                    (id: string) => !prevQueueIds.includes(id)
                )
                if (addedIds.length > 0) {
                    toast.info('New suggestion', {
                        description: `A contributor suggested ${addedIds.length} slide${
                            addedIds.length > 1 ? 's' : ''
                        }.`,
                        duration: 4000,
                    })
                }
            }

            // Notify contributors when their suggestion is accepted (removed from queue)
            if (sharedSession.operatorId !== selfId) {
                const removedIds = prevQueueIds.filter(
                    (id: string) => !currentQueueIds.includes(id)
                )
                if (removedIds.length > 0) {
                    toast.success('Suggestion accepted', {
                        description: `The operator accepted ${removedIds.length} slide${
                            removedIds.length > 1 ? 's' : ''
                        } from the queue.`,
                        duration: 3000,
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
