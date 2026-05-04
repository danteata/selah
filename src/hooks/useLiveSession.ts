import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppStore } from '../store/appStore'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { useUserRole } from './useUserRole'

type SessionRole = 'operator' | 'contributor' | 'viewer'

interface UseLiveSessionReturn {
    sessionId: Id<"liveSessions"> | null
    sessionRole: SessionRole
    isOperator: boolean
    isContributor: boolean
    isViewer: boolean
    isConnected: boolean
    isStarting: boolean
    startSession: (scheduleId: string, churchId: string) => Promise<Id<"liveSessions"> | null>
    joinSession: (sessionId: Id<"liveSessions">, role?: 'contributor' | 'viewer') => Promise<boolean>
    leaveSession: () => Promise<void>
    endSession: () => Promise<void>
    setLiveSlide: (slideId: string | null) => Promise<void>
    addToQueue: (slideIds: string[], position?: number) => Promise<void>
    removeFromQueue: (slideIds: string[]) => Promise<void>
    reorderQueue: (orderedSlideIds: string[]) => Promise<void>
    toggleBlank: (isBlank: boolean) => Promise<void>
    setOverlay: (overlay?: string, alertId?: string) => Promise<void>
    transferOperator: (newOperatorId: string) => Promise<void>
}

export function useLiveSession(scheduleId?: string): UseLiveSessionReturn {
    const { isConvexConnected, isOffline } = useConvexConnection()
    const { currentUser } = useUserRole()

    const [sessionId, setSessionId] = useState<Id<"liveSessions"> | null>(null)
    const [sessionRole, setSessionRole] = useState<SessionRole>('contributor')
    const [isStarting, setIsStarting] = useState(false)

    const activeScheduleId = useAppStore((s) => s.activeSchedule?._id)
    const effectiveScheduleId = scheduleId || (activeScheduleId as string | undefined)

    const setLiveSlideStore = useAppStore((s) => s.setLiveSlide)
    const setLiveOutputSlidesId = useAppStore((s) => s.setLiveOutputSlidesId)
    const setActiveOverlay = useAppStore((s) => s.setActiveOverlay)

    const liveSession = useQuery(
        api.liveSessions.getSession,
        sessionId ? { sessionId } : 'skip'
    )

    const activeSession = useQuery(
        api.liveSessions.getActiveSession,
        effectiveScheduleId ? { scheduleId: effectiveScheduleId } : 'skip'
    )

    const startSessionMutation = useMutation(api.liveSessions.startSession)
    const endSessionMutation = useMutation(api.liveSessions.endSession)
    const joinSessionMutation = useMutation(api.liveSessions.joinSession)
    const leaveSessionMutation = useMutation(api.liveSessions.leaveSession)
    const setLiveSlideMutation = useMutation(api.liveSessions.setLiveSlide)
    const addToQueueMutation = useMutation(api.liveSessions.addToQueue)
    const removeFromQueueMutation = useMutation(api.liveSessions.removeFromQueue)
    const reorderQueueMutation = useMutation(api.liveSessions.reorderQueue)
    const toggleBlankMutation = useMutation(api.liveSessions.toggleBlank)
    const setOverlayMutation = useMutation(api.liveSessions.setOverlay)
    const transferOperatorMutation = useMutation(api.liveSessions.transferOperator)

    const activeSessionRef = useRef(activeSession)
    const previousLiveSlideRef = useRef<string | null>(null)

    useEffect(() => {
        activeSessionRef.current = activeSession
    }, [activeSession])

    useEffect(() => {
        if (activeSession && activeSession.status === 'active') {
            setSessionId(activeSession._id)

            const isOp = activeSession.operatorId === currentUser?._id
            const currentRole = isOp ? 'operator' : sessionRole
            if (currentRole !== sessionRole) {
                setSessionRole(currentRole)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSession, currentUser?._id])

    useEffect(() => {
        if (!liveSession || liveSession.status !== 'active') return

        // Only apply server slide state if it has been explicitly set (not undefined)
        if (liveSession.liveSlideId !== undefined) {
            const serverSlideId = liveSession.liveSlideId
            if (serverSlideId !== previousLiveSlideRef.current) {
                previousLiveSlideRef.current = serverSlideId
                // Null/'' means intentional blank; undefined was already filtered out
                setLiveSlideStore(serverSlideId ?? '')
            }
        }

        if (liveSession.queuedSlideIds) {
            setLiveOutputSlidesId(liveSession.queuedSlideIds)
        }

        // Explicit blank command overrides liveSlideId
        if (liveSession.isBlank) {
            setLiveSlideStore('')
        }

        if (liveSession.activeOverlay !== undefined) {
            setActiveOverlay(liveSession.activeOverlay || 'none')
        }

        const isOp = liveSession.operatorId === currentUser?._id
        if (isOp !== (sessionRole === 'operator')) {
            setSessionRole(isOp ? 'operator' : 'contributor')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveSession, currentUser?._id])

    const startSession = useCallback(async (schedId: string, churchId: string) => {
        if (!isConvexConnected || isOffline) return null

        setIsStarting(true)
        try {
            const newSessionId = await startSessionMutation({
                scheduleId: schedId,
                churchId,
            })
            setSessionId(newSessionId)
            setSessionRole('operator')
            return newSessionId
        } catch (err) {
            console.error('[useLiveSession] Failed to start session:', err)
            return null
        } finally {
            setIsStarting(false)
        }
    }, [isConvexConnected, isOffline, startSessionMutation])

    const endSession = useCallback(async () => {
        if (!sessionId) return

        try {
            await endSessionMutation({ sessionId })
            setSessionId(null)
            setSessionRole('contributor')
        } catch (err) {
            console.error('[useLiveSession] Failed to end session:', err)
        }
    }, [sessionId, endSessionMutation])

    const joinSession = useCallback(async (sessId: Id<"liveSessions">, role: 'contributor' | 'viewer' = 'contributor') => {
        if (!isConvexConnected || isOffline) return false

        try {
            await joinSessionMutation({ sessionId: sessId, role })
            setSessionId(sessId)
            setSessionRole(role)
            return true
        } catch (err) {
            console.error('[useLiveSession] Failed to join session:', err)
            return false
        }
    }, [isConvexConnected, isOffline, joinSessionMutation])

    const leaveSession = useCallback(async () => {
        if (!sessionId) return

        try {
            await leaveSessionMutation({ sessionId })
            setSessionId(null)
            setSessionRole('contributor')
        } catch (err) {
            console.error('[useLiveSession] Failed to leave session:', err)
        }
    }, [sessionId, leaveSessionMutation])

    const handleSetLiveSlide = useCallback(async (slideId: string | null) => {
        setLiveSlideStore(slideId || '')
        previousLiveSlideRef.current = slideId

        if (sessionId && isConvexConnected && !isOffline && sessionRole === 'operator') {
            try {
                await setLiveSlideMutation({ sessionId, slideId: slideId || undefined })
            } catch (err) {
                console.error('[useLiveSession] Failed to set live slide:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, sessionRole, setLiveSlideMutation, setLiveSlideStore])

    const handleAddToQueue = useCallback(async (slideIds: string[], position?: number) => {
        if (sessionId && isConvexConnected && !isOffline) {
            try {
                await addToQueueMutation({ sessionId, slideIds, position })
            } catch (err) {
                console.error('[useLiveSession] Failed to add to queue:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, addToQueueMutation])

    const handleRemoveFromQueue = useCallback(async (slideIds: string[]) => {
        if (sessionId && isConvexConnected && !isOffline) {
            try {
                await removeFromQueueMutation({ sessionId, slideIds })
            } catch (err) {
                console.error('[useLiveSession] Failed to remove from queue:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, removeFromQueueMutation])

    const handleReorderQueue = useCallback(async (orderedSlideIds: string[]) => {
        if (sessionId && isConvexConnected && !isOffline && sessionRole === 'operator') {
            try {
                await reorderQueueMutation({ sessionId, orderedSlideIds })
            } catch (err) {
                console.error('[useLiveSession] Failed to reorder queue:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, sessionRole, reorderQueueMutation])

    const handleToggleBlank = useCallback(async (isBlank: boolean) => {
        if (sessionId && isConvexConnected && !isOffline && sessionRole === 'operator') {
            try {
                await toggleBlankMutation({ sessionId, isBlank })
            } catch (err) {
                console.error('[useLiveSession] Failed to toggle blank:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, sessionRole, toggleBlankMutation])

    const handleSetOverlay = useCallback(async (overlay?: string, alertId?: string) => {
        setActiveOverlay(overlay || 'none')
        if (sessionId && isConvexConnected && !isOffline) {
            try {
                await setOverlayMutation({ sessionId, overlay, alertId })
            } catch (err) {
                console.error('[useLiveSession] Failed to set overlay:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, setOverlayMutation, setActiveOverlay])

    const handleTransferOperator = useCallback(async (newOperatorId: string) => {
        if (sessionId && isConvexConnected && !isOffline) {
            try {
                await transferOperatorMutation({ sessionId, newOperatorId: newOperatorId as Id<"users"> })
            } catch (err) {
                console.error('[useLiveSession] Failed to transfer operator:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, transferOperatorMutation])

    useEffect(() => {
        return () => {
            if (sessionId && isConvexConnected && !isOffline) {
                leaveSessionMutation({ sessionId }).catch(console.error)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return {
        sessionId,
        sessionRole,
        isOperator: sessionRole === 'operator',
        isContributor: sessionRole === 'contributor',
        isViewer: sessionRole === 'viewer',
        isConnected: !!sessionId && isConvexConnected && !isOffline,
        isStarting,
        startSession,
        joinSession,
        leaveSession,
        endSession,
        setLiveSlide: handleSetLiveSlide,
        addToQueue: handleAddToQueue,
        removeFromQueue: handleRemoveFromQueue,
        reorderQueue: handleReorderQueue,
        toggleBlank: handleToggleBlank,
        setOverlay: handleSetOverlay,
        transferOperator: handleTransferOperator,
    }
}