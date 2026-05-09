import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppStore } from '../store/appStore'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { useUserRole } from './useUserRole'
import { canClientPushLiveSlide } from './liveSessionUtils'

type SessionRole = 'operator' | 'contributor' | 'viewer'
type CollaborationMode = 'strict' | 'open' | 'moderated'

interface QueueEntry {
    slideId: string
    suggestedBy: string
    suggestedAt: number
}

interface UseLiveSessionReturn {
    sessionId: Id<"liveSessions"> | null
    sessionRole: SessionRole
    collaborationMode: CollaborationMode | null
    isOperator: boolean
    isContributor: boolean
    isViewer: boolean
    isOpen: boolean
    isStrict: boolean
    isModerated: boolean
    isConnected: boolean
    isStarting: boolean
    startSession: (scheduleId: string, churchId: string, collaborationMode?: CollaborationMode) => Promise<Id<"liveSessions"> | null>
    joinSession: (sessionId: Id<"liveSessions">, role?: 'contributor' | 'viewer') => Promise<boolean>
    leaveSession: () => Promise<void>
    endSession: () => Promise<void>
    setLiveSlide: (slideId: string | null) => Promise<void>
    addToQueue: (slideIds: string[], position?: number) => Promise<void>
    removeFromQueue: (slideIds: string[]) => Promise<void>
    acceptFromQueue: (slideIds: string[]) => Promise<void>
    reorderQueue: (orderedSlideIds: string[]) => Promise<void>
    syncOperatorSlides: (slideIds: string[]) => Promise<void>
    toggleBlank: (isBlank: boolean) => Promise<void>
    setOverlay: (overlay?: string, alertId?: string) => Promise<void>
    transferOperator: (newOperatorId: string) => Promise<void>
}

export function useLiveSession(scheduleId?: string): UseLiveSessionReturn {
    const { isConvexConnected, isOffline } = useConvexConnection()
    const { currentUser } = useUserRole()

    const [sessionId, setSessionId] = useState<Id<"liveSessions"> | null>(null)
    const [sessionRole, setSessionRole] = useState<SessionRole>('contributor')
    const [collaborationMode, setCollaborationMode] = useState<CollaborationMode | null>(null)
    const [isStarting, setIsStarting] = useState(false)

    const activeScheduleId = useAppStore((s) => s.activeSchedule?._id)
    const effectiveScheduleId = scheduleId || (activeScheduleId as string | undefined)

    const setLiveSlideStore = useAppStore((s) => s.setLiveSlide)
    const setLiveOutputSlidesId = useAppStore((s) => s.setLiveOutputSlidesId)
    const setSharedQueueSlideIds = useAppStore((s) => s.setSharedQueueSlideIds)
    const setActiveOverlay = useAppStore((s) => s.setActiveOverlay)

    const liveOutputSlidesId = useAppStore((s) => s.liveOutputSlidesId)

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
    const setOperatorSlidesMutation = useMutation(api.liveSessions.setOperatorSlides)
    const addToQueueMutation = useMutation(api.liveSessions.addToQueue)
    const removeFromQueueMutation = useMutation(api.liveSessions.removeFromQueue)
    const acceptFromQueueMutation = useMutation(api.liveSessions.acceptFromQueue)
    const reorderQueueMutation = useMutation(api.liveSessions.reorderQueue)
    const toggleBlankMutation = useMutation(api.liveSessions.toggleBlank)
    const setOverlayMutation = useMutation(api.liveSessions.setOverlay)
    const transferOperatorMutation = useMutation(api.liveSessions.transferOperator)

    const activeSessionRef = useRef(activeSession)
    const previousLiveSlideRef = useRef<string | null>(null)
    const lastSyncedSlidesRef = useRef<string | null>(null)

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
            if (activeSession.collaborationMode) {
                setCollaborationMode(activeSession.collaborationMode as CollaborationMode)
            }

            // Also sync queue and operatorSlideIds from activeSession
            // so they're available immediately even before getSession resolves
            const queue = (activeSession as any).queue
            if (queue && Array.isArray(queue)) {
                const queueSlideIds = queue.map((entry: QueueEntry) => entry.slideId)
                const currentQueue = useAppStore.getState().sharedQueueSlideIds
                if (JSON.stringify(currentQueue) !== JSON.stringify(queueSlideIds)) {
                    setSharedQueueSlideIds(queueSlideIds)
                }
            } else if ((activeSession as any).queuedSlideIds) {
                // Backward compat with old schema
                const queuedIds = (activeSession as any).queuedSlideIds as string[]
                const currentQueue = useAppStore.getState().sharedQueueSlideIds
                if (JSON.stringify(currentQueue) !== JSON.stringify(queuedIds)) {
                    setSharedQueueSlideIds(queuedIds)
                }
            }

            const operatorSlides = (activeSession as any).operatorSlideIds as string[] | undefined
            if (operatorSlides && operatorSlides.length > 0) {
                const currentIds = useAppStore.getState().liveOutputSlidesId
                if (JSON.stringify(currentIds) !== JSON.stringify(operatorSlides)) {
                    const isOp = activeSession.operatorId === currentUser?._id
                    if (!isOp) {
                        setLiveOutputSlidesId(operatorSlides)
                        lastSyncedSlidesRef.current = JSON.stringify(operatorSlides)
                    }
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSession, currentUser?._id])

    useEffect(() => {
        if (liveSession?.status === 'ended') {
            useAppStore.getState().setSharedQueueSlideIds([])
            return
        }

        if (!liveSession || liveSession.status !== 'active') return

        // Only apply server slide state if it has been explicitly set (not undefined)
        if (liveSession.liveSlideId !== undefined) {
            const serverSlideId = liveSession.liveSlideId
            if (serverSlideId !== previousLiveSlideRef.current) {
                previousLiveSlideRef.current = serverSlideId
                setLiveSlideStore(serverSlideId ?? '')
            }
        }

        // Sync structured queue — handle both new `queue` field and legacy `queuedSlideIds`
        const queue = (liveSession as any).queue
        const queuedSlideIds = (liveSession as any).queuedSlideIds
        if (queue && Array.isArray(queue)) {
            const queueSlideIds = queue.map((entry: QueueEntry) => entry.slideId)
            const currentQueue = useAppStore.getState().sharedQueueSlideIds
            if (JSON.stringify(currentQueue) !== JSON.stringify(queueSlideIds)) {
                setSharedQueueSlideIds(queueSlideIds)
            }
        } else if (queuedSlideIds && Array.isArray(queuedSlideIds)) {
            // Backward compat with sessions that still use queuedSlideIds
            const currentQueue = useAppStore.getState().sharedQueueSlideIds
            if (JSON.stringify(currentQueue) !== JSON.stringify(queuedSlideIds)) {
                setSharedQueueSlideIds(queuedSlideIds)
            }
        } else if (queue !== undefined || queuedSlideIds !== undefined) {
            // queue/queuedSlideIds is explicitly empty (null/[]), clear local
            const currentQueue = useAppStore.getState().sharedQueueSlideIds
            if (currentQueue.length > 0) {
                setSharedQueueSlideIds([])
            }
        }

        // Sync operator's slide order — only for non-operators to prevent
        // overwriting the operator's local deck changes. The operator pushes
        // their deck to Convex via syncOperatorSlides, so contributors stay in sync.
        const isOperatorRemote = liveSession.operatorId === currentUser?._id
        const operatorSlides = (liveSession as any).operatorSlideIds as string[] | undefined
        if (operatorSlides && operatorSlides.length > 0 && !isOperatorRemote) {
            const currentIds = useAppStore.getState().liveOutputSlidesId
            if (JSON.stringify(currentIds) !== JSON.stringify(operatorSlides)) {
                setLiveOutputSlidesId(operatorSlides)
                lastSyncedSlidesRef.current = JSON.stringify(operatorSlides)
            }
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

        if (liveSession.collaborationMode) {
            setCollaborationMode(liveSession.collaborationMode as CollaborationMode)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveSession, currentUser?._id])

    const startSession = useCallback(async (schedId: string, churchId: string, collabMode: CollaborationMode = 'moderated') => {
        if (!isConvexConnected || isOffline) return null

        setIsStarting(true)
        try {
            const newSessionId = await startSessionMutation({
                scheduleId: schedId,
                churchId,
                collaborationMode: collabMode,
            })
            setSessionId(newSessionId)
            setSessionRole('operator')
            setCollaborationMode(collabMode)
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

        const isOpenMode = collaborationMode === 'open'
        if (sessionId && canClientPushLiveSlide({
            isConnected: isConvexConnected,
            isOffline,
            isOperator: sessionRole === 'operator',
            isOpenMode,
        })) {
            try {
                await setLiveSlideMutation({ sessionId, slideId: slideId || undefined })
            } catch (err) {
                console.error('[useLiveSession] Failed to set live slide:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, sessionRole, collaborationMode, setLiveSlideMutation, setLiveSlideStore])

    const handleAddToQueue = useCallback(async (slideIds: string[], position?: number) => {
        const isSharedSessionConnected = !!sessionId && isConvexConnected && !isOffline

        // Solo/local mode support (no shared session): keep local queue behavior.
        if (!sessionId) {
            useAppStore.getState().addSharedQueueSlideIds(slideIds)
            return
        }

        // Shared session exists but connection is unavailable: avoid fake local-only sync.
        if (!isSharedSessionConnected) {
            console.warn('[useLiveSession] Shared session queue update skipped: not connected')
            return
        }

        const addLocally = useAppStore.getState().addSharedQueueSlideIds
        addLocally(slideIds)

        try {
            await addToQueueMutation({ sessionId, slideIds, position })
        } catch (err) {
            useAppStore.getState().removeSharedQueueSlideIds(slideIds)
            console.error('[useLiveSession] Failed to add to queue:', err)
        }
    }, [sessionId, isConvexConnected, isOffline, addToQueueMutation])

    const handleRemoveFromQueue = useCallback(async (slideIds: string[]) => {
        const prevQueue = useAppStore.getState().sharedQueueSlideIds
        const removeLocally = useAppStore.getState().removeSharedQueueSlideIds
        removeLocally(slideIds)

        if (sessionId && isConvexConnected && !isOffline) {
            try {
                await removeFromQueueMutation({ sessionId, slideIds })
            } catch (err) {
                useAppStore.getState().setSharedQueueSlideIds(prevQueue)
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

    const handleSyncOperatorSlides = useCallback(async (slideIds: string[]) => {
        if (sessionId && isConvexConnected && !isOffline && sessionRole === 'operator') {
            try {
                await setOperatorSlidesMutation({ sessionId, slideIds })
            } catch (err) {
                console.error('[useLiveSession] Failed to sync operator slides:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, sessionRole, setOperatorSlidesMutation])

    const handleAcceptFromQueue = useCallback(async (slideIds: string[]) => {
        const removeLocally = useAppStore.getState().removeSharedQueueSlideIds
        removeLocally(slideIds)

        if (sessionId && isConvexConnected && !isOffline) {
            try {
                await acceptFromQueueMutation({ sessionId, slideIds })
            } catch (err) {
                const addLocally = useAppStore.getState().addSharedQueueSlideIds
                addLocally(slideIds)
                console.error('[useLiveSession] Failed to accept from queue:', err)
            }
        }
    }, [sessionId, isConvexConnected, isOffline, acceptFromQueueMutation])

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

    // Auto-sync operator's slide order to Convex when it changes locally
    useEffect(() => {
        if (!sessionId || !isConvexConnected || isOffline || sessionRole !== 'operator') return
        if (!liveOutputSlidesId || liveOutputSlidesId.length === 0) return

        const slidesKey = JSON.stringify(liveOutputSlidesId)
        if (slidesKey === lastSyncedSlidesRef.current) return

        const timeoutId = setTimeout(() => {
            if (sessionId && isConvexConnected && !isOffline) {
                setOperatorSlidesMutation({ sessionId, slideIds: liveOutputSlidesId })
                    .then(() => {
                        lastSyncedSlidesRef.current = slidesKey
                    })
                    .catch((err: unknown) => {
                        console.error('[useLiveSession] Failed to sync operator slides:', err)
                    })
            }
        }, 500)

        return () => clearTimeout(timeoutId)
    }, [liveOutputSlidesId, sessionId, isConvexConnected, isOffline, sessionRole])

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
        collaborationMode,
        isOperator: sessionRole === 'operator',
        isContributor: sessionRole === 'contributor',
        isViewer: sessionRole === 'viewer',
        isOpen: collaborationMode === 'open',
        isStrict: collaborationMode === 'strict',
        isModerated: collaborationMode === 'moderated',
        isConnected: !!sessionId && isConvexConnected && !isOffline,
        isStarting,
        startSession,
        joinSession,
        leaveSession,
        endSession,
        setLiveSlide: handleSetLiveSlide,
        addToQueue: handleAddToQueue,
        removeFromQueue: handleRemoveFromQueue,
        acceptFromQueue: handleAcceptFromQueue,
        reorderQueue: handleReorderQueue,
        syncOperatorSlides: handleSyncOperatorSlides,
        toggleBlank: handleToggleBlank,
        setOverlay: handleSetOverlay,
        transferOperator: handleTransferOperator,
    }
}
