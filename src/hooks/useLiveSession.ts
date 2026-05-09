import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppStore } from '../store/appStore'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { useUserRole } from './useUserRole'
import { canClientPushLiveSlide, selectDiscoveredSession } from './liveSessionUtils'
import type { Slide } from '../types'

type SessionRole = 'operator' | 'contributor' | 'viewer'
type CollaborationMode = 'strict' | 'open' | 'moderated'

interface QueueEntry {
    slideId: string
    suggestedBy: string
    suggestedAt: number
}

function removeByOccurrence(source: string[], removals: string[]) {
    const counts = new Map<string, number>()
    for (const id of removals) {
        counts.set(id, (counts.get(id) || 0) + 1)
    }

    return source.filter((id) => {
        const count = counts.get(id) || 0
        if (count > 0) {
            counts.set(id, count - 1)
            return false
        }
        return true
    })
}

function mergePendingQueue(serverQueue: string[], pendingQueue: string[]) {
    const stillPending = removeByOccurrence(pendingQueue, serverQueue)
    return {
        stillPending,
        displayQueue: [...serverQueue, ...stillPending],
    }
}

interface UseLiveSessionReturn {
    sessionId: Id<"liveSessions"> | null
    sessionScheduleId: string | null
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
    syncSlideContent: (slide: Slide) => Promise<void>
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
    const replaceSlidesForSchedule = useAppStore((s) => s.replaceSlidesForSchedule)

    const liveOutputSlidesId = useAppStore((s) => s.liveOutputSlidesId)
    const activeSlides = useAppStore((s) => s.activeSlides)

    const activeSession = useQuery(
        api.liveSessions.getActiveSession,
        effectiveScheduleId ? { scheduleId: effectiveScheduleId } : 'skip'
    )

    const activeSessionsByChurch = useQuery(
        api.liveSessions.getActiveSessionByChurch,
        currentUser?.churchId && !isOffline ? { churchId: currentUser.churchId } : 'skip'
    )

    const discoveredSession = selectDiscoveredSession({
        activeSessionId: activeSession?._id || null,
        activeScheduleId: effectiveScheduleId || null,
        sessionsByChurch: activeSessionsByChurch || null,
    })
    const resolvedActiveSession = activeSession || discoveredSession

    const liveSession = useQuery(
        api.liveSessions.getSession,
        (sessionId || resolvedActiveSession?._id)
            ? { sessionId: (sessionId || resolvedActiveSession?._id) as Id<"liveSessions"> }
            : 'skip'
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
    const syncScheduleSlidesMutation = useMutation(api.slides.syncScheduleSlides)
    const upsertScheduleSlideMutation = useMutation(api.slides.upsertScheduleSlide)

    const previousLiveSlideRef = useRef<string | null>(null)
    const lastSyncedSlidesRef = useRef<string | null>(null)
    const lastSyncedScheduleSlidesRef = useRef<string | null>(null)
    const pendingQueueSlideIdsRef = useRef<string[]>([])

    const resolvedSessionId = (sessionId || (resolvedActiveSession?._id as Id<"liveSessions"> | undefined) || null) as Id<"liveSessions"> | null
    const sessionScheduleId = (liveSession?.scheduleId || resolvedActiveSession?.scheduleId || effectiveScheduleId || null) as string | null

    const scheduleSlides = useQuery(
        api.slides.getSlides,
        sessionScheduleId && isConvexConnected && !isOffline
            ? { scheduleId: sessionScheduleId }
            : 'skip'
    )

    useEffect(() => {
        if (resolvedActiveSession && resolvedActiveSession.status === 'active') {
            setSessionId(resolvedActiveSession._id as Id<"liveSessions">)

            const isOp = resolvedActiveSession.operatorId === currentUser?._id
            const currentRole = isOp ? 'operator' : sessionRole
            if (currentRole !== sessionRole) {
                setSessionRole(currentRole)
            }
            if (resolvedActiveSession.collaborationMode) {
                setCollaborationMode(resolvedActiveSession.collaborationMode as CollaborationMode)
            }

            // Also sync queue and operatorSlideIds from activeSession
            // so they're available immediately even before getSession resolves
            const queue = (resolvedActiveSession as any).queue
            if (queue && Array.isArray(queue)) {
                const queueSlideIds = queue.map((entry: QueueEntry) => entry.slideId)
                const { stillPending, displayQueue } = mergePendingQueue(queueSlideIds, pendingQueueSlideIdsRef.current)
                pendingQueueSlideIdsRef.current = stillPending
                const currentQueue = useAppStore.getState().sharedQueueSlideIds
                if (JSON.stringify(currentQueue) !== JSON.stringify(displayQueue)) {
                    setSharedQueueSlideIds(displayQueue)
                }
            } else if ((resolvedActiveSession as any).queuedSlideIds) {
                // Backward compat with old schema
                const queuedIds = (resolvedActiveSession as any).queuedSlideIds as string[]
                const { stillPending, displayQueue } = mergePendingQueue(queuedIds, pendingQueueSlideIdsRef.current)
                pendingQueueSlideIdsRef.current = stillPending
                const currentQueue = useAppStore.getState().sharedQueueSlideIds
                if (JSON.stringify(currentQueue) !== JSON.stringify(displayQueue)) {
                    setSharedQueueSlideIds(displayQueue)
                }
            }

            const operatorSlides = (resolvedActiveSession as any).operatorSlideIds as string[] | undefined
            if (operatorSlides && operatorSlides.length > 0) {
                const currentIds = useAppStore.getState().liveOutputSlidesId
                if (JSON.stringify(currentIds) !== JSON.stringify(operatorSlides)) {
                    const isOp = resolvedActiveSession.operatorId === currentUser?._id
                    if (!isOp) {
                        setLiveOutputSlidesId(operatorSlides)
                        lastSyncedSlidesRef.current = JSON.stringify(operatorSlides)
                    }
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedActiveSession, currentUser?._id])

    useEffect(() => {
        if (!scheduleSlides || !sessionScheduleId) return

        const mappedSlides: Slide[] = scheduleSlides.map((slide: any, index: number) => ({
            ...slide,
            _id: slide._id as string,
            id: slide.id || String(slide._id),
            index: typeof slide.index === 'number' ? slide.index : index,
        }))

        if (mappedSlides.length === 0) {
            return
        }

        replaceSlidesForSchedule(sessionScheduleId, mappedSlides, true)

        const idsFromSessionSlides = mappedSlides.map((s) => s.id)
        const currentIds = useAppStore.getState().liveOutputSlidesId || []
        const hasOperatorOrdering =
            Array.isArray((liveSession as any)?.operatorSlideIds) &&
            ((liveSession as any).operatorSlideIds as string[]).length > 0

        // Fallback deck order so collaborators can still render feed/next-up
        // before explicit operator ordering is synced.
        if (currentIds.length === 0 && !hasOperatorOrdering && JSON.stringify(currentIds) !== JSON.stringify(idsFromSessionSlides)) {
            setLiveOutputSlidesId(idsFromSessionSlides)
        }
    }, [scheduleSlides, sessionScheduleId, liveSession, replaceSlidesForSchedule, setLiveOutputSlidesId])

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
            const { stillPending, displayQueue } = mergePendingQueue(queueSlideIds, pendingQueueSlideIdsRef.current)
            pendingQueueSlideIdsRef.current = stillPending
            const currentQueue = useAppStore.getState().sharedQueueSlideIds
            if (JSON.stringify(currentQueue) !== JSON.stringify(displayQueue)) {
                setSharedQueueSlideIds(displayQueue)
            }
        } else if (queuedSlideIds && Array.isArray(queuedSlideIds)) {
            // Backward compat with sessions that still use queuedSlideIds
            const { stillPending, displayQueue } = mergePendingQueue(queuedSlideIds, pendingQueueSlideIdsRef.current)
            pendingQueueSlideIdsRef.current = stillPending
            const currentQueue = useAppStore.getState().sharedQueueSlideIds
            if (JSON.stringify(currentQueue) !== JSON.stringify(displayQueue)) {
                setSharedQueueSlideIds(displayQueue)
            }
        } else if (queue !== undefined || queuedSlideIds !== undefined) {
            // queue/queuedSlideIds is explicitly empty (null/[]), clear local
            const currentQueue = useAppStore.getState().sharedQueueSlideIds
            if (pendingQueueSlideIdsRef.current.length > 0) {
                setSharedQueueSlideIds(pendingQueueSlideIdsRef.current)
            } else if (currentQueue.length > 0) {
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
        if (!resolvedSessionId) return

        try {
            await endSessionMutation({ sessionId: resolvedSessionId })
            setSessionId(null)
            setSessionRole('contributor')
        } catch (err) {
            console.error('[useLiveSession] Failed to end session:', err)
        }
    }, [resolvedSessionId, endSessionMutation])

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
        if (!resolvedSessionId) return

        try {
            await leaveSessionMutation({ sessionId: resolvedSessionId })
            setSessionId(null)
            setSessionRole('contributor')
        } catch (err) {
            console.error('[useLiveSession] Failed to leave session:', err)
        }
    }, [resolvedSessionId, leaveSessionMutation])

    const handleSetLiveSlide = useCallback(async (slideId: string | null) => {
        const effectiveMode = (liveSession?.collaborationMode || resolvedActiveSession?.collaborationMode || collaborationMode) as CollaborationMode | null
        const canOptimisticallyPush = !!resolvedSessionId && canClientPushLiveSlide({
            isConnected: isConvexConnected,
            isOffline,
            isOperator: sessionRole === 'operator',
            isOpenMode: effectiveMode === 'open',
        })

        if (!resolvedSessionId || canOptimisticallyPush) {
            setLiveSlideStore(slideId || '')
            previousLiveSlideRef.current = slideId
        }

        if (resolvedSessionId && isConvexConnected && !isOffline) {
            try {
                const localSlide = slideId ? activeSlides.find((slide) => slide.id === slideId) : null
                if (localSlide && sessionScheduleId) {
                    await upsertScheduleSlideMutation({
                        scheduleId: sessionScheduleId,
                        slide: {
                            id: localSlide.id,
                            index: typeof localSlide.index === 'number' ? localSlide.index : 0,
                            name: localSlide.name || 'Untitled',
                            type: localSlide.type,
                            layout: localSlide.layout,
                            contents: localSlide.contents || [],
                            backgroundType: localSlide.backgroundType,
                            background: localSlide.background,
                            backgroundVideoKey: localSlide.backgroundVideoKey,
                            backgroundStorageId: localSlide.backgroundStorageId,
                            title: localSlide.title,
                            songId: localSlide.songId,
                            hasChorus: localSlide.hasChorus,
                            data: localSlide.data,
                            slideStyle: localSlide.slideStyle,
                            saved: localSlide.saved,
                            verseIndex: localSlide.verseIndex,
                            totalVerses: localSlide.totalVerses,
                            verseLabel: localSlide.verseLabel,
                        },
                    })
                }
                await setLiveSlideMutation({ sessionId: resolvedSessionId, slideId: slideId || undefined })
            } catch (err) {
                const serverSlideId = liveSession?.liveSlideId || ''
                setLiveSlideStore(serverSlideId)
                previousLiveSlideRef.current = serverSlideId || null
                console.error('[useLiveSession] Failed to set live slide:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, sessionRole, collaborationMode, liveSession?.collaborationMode, liveSession?.liveSlideId, resolvedActiveSession?.collaborationMode, activeSlides, sessionScheduleId, upsertScheduleSlideMutation, setLiveSlideMutation, setLiveSlideStore])

    const handleAddToQueue = useCallback(async (slideIds: string[], position?: number) => {
        const isSharedSessionConnected = !!resolvedSessionId && isConvexConnected && !isOffline

        // Solo/local mode support (no shared session): keep local queue behavior.
        if (!resolvedSessionId) {
            useAppStore.getState().addSharedQueueSlideIds(slideIds)
            return
        }

        // Shared session exists but connection is unavailable: avoid fake local-only sync.
        if (!isSharedSessionConnected) {
            console.warn('[useLiveSession] Shared session queue update skipped: not connected')
            return
        }

        const addLocally = useAppStore.getState().addSharedQueueSlideIds
        pendingQueueSlideIdsRef.current = [...pendingQueueSlideIdsRef.current, ...slideIds]
        addLocally(slideIds)

        try {
            await addToQueueMutation({ sessionId: resolvedSessionId, slideIds, position })
        } catch (err) {
            pendingQueueSlideIdsRef.current = removeByOccurrence(pendingQueueSlideIdsRef.current, slideIds)
            useAppStore.getState().removeSharedQueueSlideIds(slideIds)
            console.error('[useLiveSession] Failed to add to queue:', err)
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, addToQueueMutation])

    const handleRemoveFromQueue = useCallback(async (slideIds: string[]) => {
        const prevQueue = useAppStore.getState().sharedQueueSlideIds
        const removeLocally = useAppStore.getState().removeSharedQueueSlideIds
        removeLocally(slideIds)

        if (resolvedSessionId && isConvexConnected && !isOffline) {
            try {
                await removeFromQueueMutation({ sessionId: resolvedSessionId, slideIds })
            } catch (err) {
                useAppStore.getState().setSharedQueueSlideIds(prevQueue)
                console.error('[useLiveSession] Failed to remove from queue:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, removeFromQueueMutation])

    const handleReorderQueue = useCallback(async (orderedSlideIds: string[]) => {
        if (resolvedSessionId && isConvexConnected && !isOffline && sessionRole === 'operator') {
            try {
                await reorderQueueMutation({ sessionId: resolvedSessionId, orderedSlideIds })
            } catch (err) {
                console.error('[useLiveSession] Failed to reorder queue:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, sessionRole, reorderQueueMutation])

    const handleSyncOperatorSlides = useCallback(async (slideIds: string[]) => {
        if (resolvedSessionId && isConvexConnected && !isOffline && sessionRole === 'operator') {
            try {
                await setOperatorSlidesMutation({ sessionId: resolvedSessionId, slideIds })
            } catch (err) {
                console.error('[useLiveSession] Failed to sync operator slides:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, sessionRole, setOperatorSlidesMutation])

    const handleSyncSlideContent = useCallback(async (slide: Slide) => {
        if (!sessionScheduleId || !isConvexConnected || isOffline) return

        try {
            await upsertScheduleSlideMutation({
                scheduleId: sessionScheduleId,
                slide: {
                    id: slide.id,
                    index: typeof slide.index === 'number' ? slide.index : 0,
                    name: slide.name || 'Untitled',
                    type: slide.type,
                    layout: slide.layout,
                    contents: slide.contents || [],
                    backgroundType: slide.backgroundType,
                    background: slide.background,
                    backgroundVideoKey: slide.backgroundVideoKey,
                    backgroundStorageId: slide.backgroundStorageId,
                    title: slide.title,
                    songId: slide.songId,
                    hasChorus: slide.hasChorus,
                    data: slide.data,
                    slideStyle: slide.slideStyle,
                    saved: slide.saved,
                    verseIndex: slide.verseIndex,
                    totalVerses: slide.totalVerses,
                    verseLabel: slide.verseLabel,
                },
            })
        } catch (err) {
            console.error('[useLiveSession] Failed to sync slide content:', err)
        }
    }, [sessionScheduleId, isConvexConnected, isOffline, upsertScheduleSlideMutation])

    const handleAcceptFromQueue = useCallback(async (slideIds: string[]) => {
        const removeLocally = useAppStore.getState().removeSharedQueueSlideIds
        removeLocally(slideIds)

        if (resolvedSessionId && isConvexConnected && !isOffline) {
            try {
                await acceptFromQueueMutation({ sessionId: resolvedSessionId, slideIds })
            } catch (err) {
                const addLocally = useAppStore.getState().addSharedQueueSlideIds
                addLocally(slideIds)
                console.error('[useLiveSession] Failed to accept from queue:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, acceptFromQueueMutation])

    const handleToggleBlank = useCallback(async (isBlank: boolean) => {
        if (resolvedSessionId && isConvexConnected && !isOffline && sessionRole === 'operator') {
            try {
                await toggleBlankMutation({ sessionId: resolvedSessionId, isBlank })
            } catch (err) {
                console.error('[useLiveSession] Failed to toggle blank:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, sessionRole, toggleBlankMutation])

    const handleSetOverlay = useCallback(async (overlay?: string, alertId?: string) => {
        setActiveOverlay(overlay || 'none')
        if (resolvedSessionId && isConvexConnected && !isOffline) {
            try {
                await setOverlayMutation({ sessionId: resolvedSessionId, overlay, alertId })
            } catch (err) {
                console.error('[useLiveSession] Failed to set overlay:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, setOverlayMutation, setActiveOverlay])

    const handleTransferOperator = useCallback(async (newOperatorId: string) => {
        if (resolvedSessionId && isConvexConnected && !isOffline) {
            try {
                await transferOperatorMutation({ sessionId: resolvedSessionId, newOperatorId: newOperatorId as Id<"users"> })
            } catch (err) {
                console.error('[useLiveSession] Failed to transfer operator:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, transferOperatorMutation])

    // Auto-sync operator's slide order to Convex when it changes locally
    useEffect(() => {
        if (!resolvedSessionId || !isConvexConnected || isOffline || sessionRole !== 'operator') return
        if (!liveOutputSlidesId || liveOutputSlidesId.length === 0) return

        const slidesKey = JSON.stringify(liveOutputSlidesId)
        if (slidesKey === lastSyncedSlidesRef.current) return

        const timeoutId = setTimeout(() => {
            if (resolvedSessionId && isConvexConnected && !isOffline) {
                setOperatorSlidesMutation({ sessionId: resolvedSessionId, slideIds: liveOutputSlidesId })
                    .then(() => {
                        lastSyncedSlidesRef.current = slidesKey
                    })
                    .catch((err: unknown) => {
                        console.error('[useLiveSession] Failed to sync operator slides:', err)
                    })
            }
        }, 500)

        return () => clearTimeout(timeoutId)
    }, [liveOutputSlidesId, resolvedSessionId, isConvexConnected, isOffline, sessionRole, setOperatorSlidesMutation])

    useEffect(() => {
        if (!sessionScheduleId || !isConvexConnected || isOffline || sessionRole !== 'operator') return

        const scheduleActiveSlides = activeSlides
            .filter((slide) => slide.scheduleId === sessionScheduleId || !slide.scheduleId || slide.scheduleId === '')
            .map((slide, index) => ({
                id: slide.id,
                index: typeof slide.index === 'number' ? slide.index : index,
                name: slide.name || 'Untitled',
                type: slide.type,
                layout: slide.layout,
                contents: slide.contents || [],
                backgroundType: slide.backgroundType,
                background: slide.background,
                backgroundVideoKey: slide.backgroundVideoKey,
                backgroundStorageId: slide.backgroundStorageId,
                title: slide.title,
                songId: slide.songId,
                hasChorus: slide.hasChorus,
                data: slide.data,
                slideStyle: slide.slideStyle,
                saved: slide.saved,
                verseIndex: slide.verseIndex,
                totalVerses: slide.totalVerses,
                verseLabel: slide.verseLabel,
            }))

        if (scheduleActiveSlides.length === 0) return

        const slidesKey = JSON.stringify(scheduleActiveSlides)
        if (slidesKey === lastSyncedScheduleSlidesRef.current) return

        const timeoutId = setTimeout(() => {
            syncScheduleSlidesMutation({ scheduleId: sessionScheduleId, slides: scheduleActiveSlides })
                .then(() => {
                    lastSyncedScheduleSlidesRef.current = slidesKey
                })
                .catch((err: unknown) => {
                    console.error('[useLiveSession] Failed to sync schedule slides:', err)
                })
        }, 750)

        return () => clearTimeout(timeoutId)
    }, [activeSlides, sessionScheduleId, isConvexConnected, isOffline, sessionRole, syncScheduleSlidesMutation])

    return {
        sessionId: resolvedSessionId,
        sessionScheduleId,
        sessionRole,
        collaborationMode,
        isOperator: sessionRole === 'operator',
        isContributor: sessionRole === 'contributor',
        isViewer: sessionRole === 'viewer',
        isOpen: collaborationMode === 'open',
        isStrict: collaborationMode === 'strict',
        isModerated: collaborationMode === 'moderated',
        isConnected: !!resolvedSessionId && isConvexConnected && !isOffline,
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
        syncSlideContent: handleSyncSlideContent,
        toggleBlank: handleToggleBlank,
        setOverlay: handleSetOverlay,
        transferOperator: handleTransferOperator,
    }
}
