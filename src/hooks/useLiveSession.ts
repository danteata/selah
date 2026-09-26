import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppStore } from '../store/appStore'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import { useUserRole } from './useUserRole'
import { useAnalytics } from './useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'
import { canClientPushLiveSlide, selectDiscoveredSession } from './liveSessionUtils'
import { diffScheduleSlides, removedOnServer, slideKey, type SlideKey } from './liveSlideSync'
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

/**
 * Builds the exact shape Convex's `syncScheduleSlides`/`upsertScheduleSlide`
 * mutations accept. Their `v.object({...})` argument validators are
 * exact/closed — any extra key (e.g. the client-only `localFilePath`/
 * `localMediaId`, never declared there or in the schema) throws an
 * `ArgumentValidationError` and fails the whole call. A `blob:`/`asset://`
 * `background` value is also meaningless on another device, so for
 * local-only media (no `backgroundStorageId`) it's omitted too —
 * `backgroundType` still travels so a placeholder can show the right icon.
 */
function toSyncableSlide(slide: Slide, index: number) {
    const isLocalOnlyMedia = !slide.backgroundStorageId && !!(slide.localFilePath || slide.localMediaId)
    return {
        id: slide.id,
        index: typeof slide.index === 'number' ? slide.index : index,
        name: slide.name || 'Untitled',
        type: slide.type,
        layout: slide.layout,
        contents: slide.contents || [],
        backgroundType: slide.backgroundType,
        background: isLocalOnlyMedia ? undefined : slide.background,
        backgroundVideoKey: slide.backgroundVideoKey ?? undefined,
        backgroundStorageId: slide.backgroundStorageId ?? undefined,
        title: slide.title,
        songId: slide.songId,
        hasChorus: slide.hasChorus,
        data: slide.data,
        slideStyle: slide.slideStyle,
        saved: slide.saved,
        verseIndex: slide.verseIndex,
        totalVerses: slide.totalVerses,
        verseLabel: slide.verseLabel,
    }
}

/**
 * Unified queue sync used by both the activeSession and liveSession
 * effects. Reads the server queue (either the new `queue` entries or
 * the legacy `queuedSlideIds` flat array), merges with the local
 * optimistic pending list, and writes the resulting display queue to
 * the store — but only when the value actually changes. The pending
 * ref is drained of any items that the server has now confirmed.
 *
 * Returns true if a write happened, so callers can chain extra
 * notifications if they want to.
 */
function syncQueueFromServer(params: {
    queue: unknown
    queuedSlideIds: unknown
    pendingRef: string[]
}): boolean {
    const { queue, queuedSlideIds, pendingRef } = params

    if (Array.isArray(queue)) {
        const serverIds = queue
            .map(entry => (entry && typeof entry === 'object' ? (entry as { slideId?: string }).slideId : undefined))
            .filter((id): id is string => typeof id === 'string')
        const { stillPending, displayQueue } = mergePendingQueue(serverIds, pendingRef)
        pendingRef.length = 0
        pendingRef.push(...stillPending)
        const currentQueue = useAppStore.getState().sharedQueueSlideIds
        if (JSON.stringify(currentQueue) !== JSON.stringify(displayQueue)) {
            useAppStore.getState().setSharedQueueSlideIds(displayQueue)
            return true
        }
        return false
    }

    if (Array.isArray(queuedSlideIds)) {
        const { stillPending, displayQueue } = mergePendingQueue(queuedSlideIds, pendingRef)
        pendingRef.length = 0
        pendingRef.push(...stillPending)
        const currentQueue = useAppStore.getState().sharedQueueSlideIds
        if (JSON.stringify(currentQueue) !== JSON.stringify(displayQueue)) {
            useAppStore.getState().setSharedQueueSlideIds(displayQueue)
            return true
        }
        return false
    }

    // queue/queuedSlideIds is explicitly null (not just an empty
    // array) and there are no optimistic pending items. Clear the
    // local store so the operator's view doesn't get stuck.
    if (queue === null || queuedSlideIds === null) {
        const currentQueue = useAppStore.getState().sharedQueueSlideIds
        if (pendingRef.length > 0) {
            useAppStore.getState().setSharedQueueSlideIds([...pendingRef])
            pendingRef.length = 0
            return true
        }
        if (currentQueue.length > 0) {
            useAppStore.getState().setSharedQueueSlideIds([])
            return true
        }
    }
    return false
}

/**
 * Suggestions this device sent that the server hasn't confirmed yet. Shared by
 * every mounted copy of the hook: one copy adds a suggestion, the sync owner
 * reconciles it against the server, and each copy used to hold its own list,
 * so the owner's empty one erased the optimistic entry.
 */
const pendingQueue = { ids: [] as string[] }

const EMPTY_SLIDES: Slide[] = []

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
    updateCollaborationMode: (mode: CollaborationMode) => Promise<void>
}

export interface UseLiveSessionOptions {
    /**
     * Run the session's background sync from this copy: mirror server state
     * into the store and push the operator's edits to the server. Exactly one
     * mounted copy should (Dashboard). The hook is used by ~10 components,
     * and when every copy did this, one slide edit sent ~10 whole-deck syncs
     * and every copy re-rendered on every slide change.
     */
    sync?: boolean
}

export function useLiveSession(scheduleId?: string, options: UseLiveSessionOptions = {}): UseLiveSessionReturn {
    const sync = options.sync === true
    const { isConvexConnected, isOffline } = useConvexConnection()
    const { currentUser } = useUserRole()
    const { trackEvent } = useAnalytics()

    const [sessionId, setSessionId] = useState<Id<"liveSessions"> | null>(null)
    const [sessionRole, setSessionRole] = useState<SessionRole>('contributor')
    const [collaborationMode, setCollaborationMode] = useState<CollaborationMode | null>(null)
    const [isStarting, setIsStarting] = useState(false)
    const sessionStartTimeRef = useRef<number | null>(null)

    const activeScheduleId = useAppStore((s) => s.activeSchedule?._id)
    const effectiveScheduleId = scheduleId || (activeScheduleId as string | undefined)

    const setLiveSlideStore = useAppStore((s) => s.setLiveSlide)
    const setLiveOutputSlidesId = useAppStore((s) => s.setLiveOutputSlidesId)
    const setSharedQueueSlideIds = useAppStore((s) => s.setSharedQueueSlideIds)
    const setActiveOverlay = useAppStore((s) => s.setActiveOverlay)
    const replaceSlidesForSchedule = useAppStore((s) => s.replaceSlidesForSchedule)

    // Only the sync owner needs these; elsewhere they'd just re-render the
    // component on every slide change.
    const liveOutputSlidesId = useAppStore((s) => (sync ? s.liveOutputSlidesId : null))
    const activeSlides = useAppStore((s) => (sync ? s.activeSlides : EMPTY_SLIDES))

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
    const addToOperatorDeckMutation = useMutation(api.liveSessions.addToOperatorDeck)
    const removeFromQueueMutation = useMutation(api.liveSessions.removeFromQueue)
    const acceptFromQueueMutation = useMutation(api.liveSessions.acceptFromQueue)
    const reorderQueueMutation = useMutation(api.liveSessions.reorderQueue)
    const toggleBlankMutation = useMutation(api.liveSessions.toggleBlank)
    const setOverlayMutation = useMutation(api.liveSessions.setOverlay)
    const transferOperatorMutation = useMutation(api.liveSessions.transferOperator)
    const updateCollaborationModeMutation = useMutation(api.liveSessions.updateCollaborationMode)
    const applyScheduleSlideChangesMutation = useMutation(api.slides.applyScheduleSlideChanges)
    const upsertScheduleSlideMutation = useMutation(api.slides.upsertScheduleSlide)

    const previousServerBlankRef = useRef<boolean | null>(null)
    const previousLiveSlideRef = useRef<string | null>(null)
    const lastSyncedSlidesRef = useRef<string | null>(null)
    // Content last synced or received per slide id: what the operator's
    // edits are diffed against (see liveSlideSync).
    const slideBaselineRef = useRef<Map<string, SlideKey>>(new Map())
    const knownServerSlideIdsRef = useRef<Set<string>>(new Set())
    const baselineScheduleRef = useRef<string | null>(null)
    // Both maps describe one schedule; switching schedules starts them over.
    const resetBaselineFor = (scheduleIdForBaseline: string) => {
        if (baselineScheduleRef.current === scheduleIdForBaseline) return
        baselineScheduleRef.current = scheduleIdForBaseline
        slideBaselineRef.current = new Map()
        knownServerSlideIdsRef.current = new Set()
    }

    const resolvedSessionId = (sessionId || (resolvedActiveSession?._id as Id<"liveSessions"> | undefined) || null) as Id<"liveSessions"> | null
    const sessionScheduleId = (liveSession?.scheduleId || resolvedActiveSession?.scheduleId || effectiveScheduleId || null) as string | null

    const scheduleSlides = useQuery(
        api.slides.getSlides,
        sync && sessionScheduleId && isConvexConnected && !isOffline
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

            // Store writes below are the sync owner's alone.
            if (!sync) return

            // Also sync queue and operatorSlideIds from activeSession
            // so they're available immediately even before getSession resolves
            syncQueueFromServer({
                queue: (resolvedActiveSession as any).queue,
                queuedSlideIds: (resolvedActiveSession as any).queuedSlideIds,
                pendingRef: pendingQueue.ids,
            })

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
        if (!sync || !scheduleSlides || !sessionScheduleId) return
        resetBaselineFor(sessionScheduleId)

        const mappedSlides: Slide[] = scheduleSlides.map((slide: any, index: number) => ({
            ...slide,
            _id: slide._id as string,
            id: slide.id || String(slide._id),
            index: typeof slide.index === 'number' ? slide.index : index,
        }))

        const serverIds = new Set(mappedSlides.map((slide) => slide.id))
        const removed = removedOnServer(knownServerSlideIdsRef.current, serverIds)
        knownServerSlideIdsRef.current = serverIds

        // Slides the operator removed here that the server still lists: the
        // delete is on its way, so don't merge them straight back in.
        const localIds = new Set(
            useAppStore.getState().activeSlides
                .filter((slide) => slide.scheduleId === sessionScheduleId)
                .map((slide) => slide.id)
        )
        const pendingDeletes = new Set(
            [...slideBaselineRef.current.keys()].filter((id) => !localIds.has(id))
        )
        const incoming = mappedSlides.filter((slide) => !pendingDeletes.has(slide.id))

        // An empty list used to return early here, so deleting every slide
        // never reached the other devices.
        if (incoming.length === 0 && removed.length === 0) return

        replaceSlidesForSchedule(sessionScheduleId, incoming, true, removed)

        // What just arrived is in sync by definition: record it as the
        // baseline so the operator's diff doesn't echo it straight back.
        const merged = useAppStore.getState().activeSlides
        const baseline = slideBaselineRef.current
        for (const id of removed) baseline.delete(id)
        merged.forEach((slide, index) => {
            if (serverIds.has(slide.id)) baseline.set(slide.id, slideKey(toSyncableSlide(slide, index)))
        })

        const idsFromSessionSlides = incoming.map((s) => s.id)
        const currentIds = useAppStore.getState().liveOutputSlidesId || []
        const hasOperatorOrdering =
            Array.isArray((liveSession as any)?.operatorSlideIds) &&
            ((liveSession as any).operatorSlideIds as string[]).length > 0

        // Fallback deck order so collaborators can still render feed/next-up
        // before explicit operator ordering is synced.
        if (currentIds.length === 0 && !hasOperatorOrdering && JSON.stringify(currentIds) !== JSON.stringify(idsFromSessionSlides)) {
            setLiveOutputSlidesId(idsFromSessionSlides)
        }
    }, [sync, scheduleSlides, sessionScheduleId, liveSession, replaceSlidesForSchedule, setLiveOutputSlidesId])

    useEffect(() => {
        if (liveSession?.status === 'ended') {
            if (sync) useAppStore.getState().setSharedQueueSlideIds([])
            return
        }

        if (!liveSession || liveSession.status !== 'active') return

        // This copy's own view of the session, kept by every copy.
        const isOp = liveSession.operatorId === currentUser?._id
        if (isOp !== (sessionRole === 'operator')) {
            setSessionRole(isOp ? 'operator' : 'contributor')
        }
        if (liveSession.collaborationMode) {
            setCollaborationMode(liveSession.collaborationMode as CollaborationMode)
        }

        // Mirroring the session into the shared store is the sync owner's job.
        if (!sync) return

        // Only apply server slide state if it has been explicitly set (not undefined)
        if (liveSession.liveSlideId !== undefined) {
            const serverSlideId = liveSession.liveSlideId
            if (serverSlideId !== previousLiveSlideRef.current) {
                previousLiveSlideRef.current = serverSlideId
                setLiveSlideStore(serverSlideId ?? '')
            }
        }

        // Sync structured queue — handle both new `queue` field and legacy `queuedSlideIds`
        syncQueueFromServer({
            queue: (liveSession as any).queue,
            queuedSlideIds: (liveSession as any).queuedSlideIds,
            pendingRef: pendingQueue.ids,
        })

        // Sync operator's slide order — only for non-operators to prevent
        // Sync the operator's deck from the server. For non-operators
        // the server is authoritative — they always pull. For the operator
        // we only merge NEW server-side additions (slides a contributor
        // added via addToOperatorDeck) so the operator's own reordering
        // or removal isn't clobbered. Existing local ids are preserved;
        // ids that appear on the server but not locally are appended.
        const isOperatorRemote = liveSession.operatorId === currentUser?._id
        const operatorSlides = (liveSession as any).operatorSlideIds as string[] | undefined
        if (operatorSlides && operatorSlides.length > 0) {
            const currentIds = useAppStore.getState().liveOutputSlidesId || []
            if (!isOperatorRemote) {
                if (JSON.stringify(currentIds) !== JSON.stringify(operatorSlides)) {
                    setLiveOutputSlidesId(operatorSlides)
                    lastSyncedSlidesRef.current = JSON.stringify(operatorSlides)
                }
            } else {
                const missingOnLocal = operatorSlides.filter((id: string) => !currentIds.includes(id))
                if (missingOnLocal.length > 0) {
                    setLiveOutputSlidesId([...currentIds, ...missingOnLocal])
                }
            }
        }

        // Mirror the shared blank flag into the local one the output reads.
        // Only on a change of the server value, so a local toggle isn't undone
        // by an unrelated session update landing before its mutation does.
        //
        // This used to clear the live slide instead. The server's toggleBlank
        // keeps liveSlideId, so un-blanking never re-applied it: the operator
        // was left with "nothing is live", and the next arrow key restarted
        // the service from slide 1.
        const serverBlank = !!liveSession.isBlank
        if (serverBlank !== previousServerBlankRef.current) {
            previousServerBlankRef.current = serverBlank
            useAppStore.getState().setLiveOutputBlanked(serverBlank)
        }

        if (liveSession.activeOverlay !== undefined) {
            setActiveOverlay(liveSession.activeOverlay || 'none')
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
            sessionStartTimeRef.current = Date.now()
            trackEvent(AnalyticsEventType.LIVE_SESSION_STARTED, {
                schedule_id: schedId,
                collaboration_mode: collabMode,
                church_id: churchId,
            })
            return newSessionId
        } catch (err) {
            console.error('[useLiveSession] Failed to start session:', err)
            return null
        } finally {
            setIsStarting(false)
        }
    }, [isConvexConnected, isOffline, startSessionMutation, trackEvent])

    const endSession = useCallback(async () => {
        if (!resolvedSessionId) return

        try {
            await endSessionMutation({ sessionId: resolvedSessionId })
            const durationSeconds = sessionStartTimeRef.current
                ? Math.round((Date.now() - sessionStartTimeRef.current) / 1000)
                : undefined
            trackEvent(AnalyticsEventType.LIVE_SESSION_ENDED, {
                session_id: resolvedSessionId,
                duration_seconds: durationSeconds,
                collaboration_mode: collaborationMode,
            })
            setSessionId(null)
            setSessionRole('contributor')
            sessionStartTimeRef.current = null
        } catch (err) {
            console.error('[useLiveSession] Failed to end session:', err)
        }
    }, [resolvedSessionId, endSessionMutation, trackEvent, collaborationMode])

    const joinSession = useCallback(async (sessId: Id<"liveSessions">, role: 'contributor' | 'viewer' = 'contributor') => {
        if (!isConvexConnected || isOffline) return false

        try {
            await joinSessionMutation({ sessionId: sessId, role })
            setSessionId(sessId)
            setSessionRole(role)
            trackEvent(AnalyticsEventType.LIVE_COLLABORATION_JOINED, {
                session_id: sessId,
                role,
            })
            return true
        } catch (err) {
            console.error('[useLiveSession] Failed to join session:', err)
            return false
        }
    }, [isConvexConnected, isOffline, joinSessionMutation, trackEvent])

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
                // Read activeSlides from the store at call-time, NOT from
                // the closure. Callers often run `appendActiveSlide(slide)`
                // then immediately `setLiveSlide(slide.id)` in the same
                // synchronous tick. The Zustand store is updated instantly,
                // but the React-subscribed `activeSlides` captured in this
                // callback's closure is still the pre-append value. Using
                // `getState()` ensures we always find the freshly-added slide.
                const currentActiveSlides = useAppStore.getState().activeSlides
                const localSlide = slideId ? currentActiveSlides.find((slide) => slide.id === slideId) : null
                if (localSlide && sessionScheduleId) {
                    await upsertScheduleSlideMutation({
                        scheduleId: sessionScheduleId,
                        slide: toSyncableSlide(localSlide, 0),
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
    }, [resolvedSessionId, isConvexConnected, isOffline, sessionRole, collaborationMode, liveSession?.collaborationMode, liveSession?.liveSlideId, resolvedActiveSession?.collaborationMode, sessionScheduleId, upsertScheduleSlideMutation, setLiveSlideMutation, setLiveSlideStore])

    const effectiveMode = (liveSession?.collaborationMode || resolvedActiveSession?.collaborationMode || collaborationMode) as CollaborationMode | null
    const isOpenMode = effectiveMode === 'open'

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

        const currentLiveOutputIds = useAppStore.getState().liveOutputSlidesId || []
        // Filter for LOCAL optimistic update only — slides already in the
        // contributor's local liveOutputSlidesId don't need re-adding there.
        // Note: `appendActiveSlide` is typically called BEFORE `addToQueue`,
        // so the new slide will already be in `currentLiveOutputIds`. This
        // is expected — the local deck is already up-to-date. The important
        // work (upserting content + patching operatorSlideIds on the server)
        // must happen for ALL incoming slideIds regardless.
        const locallyNewSlideIds = slideIds.filter(id => !currentLiveOutputIds.includes(id))
        console.log('[useLiveSession] handleAddToQueue', { isOpenMode, mode: effectiveMode, slideIds, isSharedSessionConnected, locallyNewSlideIds, currentLiveOutputIds })

        if (isOpenMode) {
            // In open mode, contributors add directly to the operator's deck.
            // We upsert each slide's content to the schedule so other devices
            // can render it (one slide at a time — the destructive
            // syncScheduleSlides variant would delete slides the contributor
            // doesn't have locally, e.g. slides the operator has loaded but
            // the contributor hasn't). We upsert ALL incoming slideIds, not
            // just locally-new ones, because `appendActiveSlide` may have
            // already added the id to liveOutputSlidesId before this runs
            // — the server still needs the slide data.
            if (sessionScheduleId && isConvexConnected && !isOffline) {
                const stateActiveSlides = useAppStore.getState().activeSlides
                for (const id of slideIds) {
                    const slide = stateActiveSlides.find(s => s.id === id)
                    if (!slide) continue
                    try {
                        await upsertScheduleSlideMutation({
                            scheduleId: sessionScheduleId,
                            slide: toSyncableSlide(slide, 0),
                        })
                    } catch (err) {
                        console.error('[useLiveSession] Failed to upsert slide content:', err)
                    }
                }
            }

            // Only update local deck if there are truly new ids not yet present
            if (locallyNewSlideIds.length > 0) {
                setLiveOutputSlidesId([...currentLiveOutputIds, ...locallyNewSlideIds])
            }
            try {
                console.log('[useLiveSession] open-mode add to operator deck:', { sessionId: resolvedSessionId, slideIds, isOpenMode })
                await addToOperatorDeckMutation({
                    sessionId: resolvedSessionId,
                    slideIds,
                    position,
                })
                console.log('[useLiveSession] open-mode add to operator deck: success')
            } catch (err) {
                console.error('[useLiveSession] Failed to add to operator deck:', err)
            }
            return
        }

        // Moderated/strict mode: slide enters the shared suggestion queue
        // and the operator reviews it before adding to the deck.
        const addLocally = useAppStore.getState().addSharedQueueSlideIds
        pendingQueue.ids = [...pendingQueue.ids, ...slideIds]
        addLocally(slideIds)

        try {
            await addToQueueMutation({ sessionId: resolvedSessionId, slideIds, position })
        } catch (err) {
            pendingQueue.ids = removeByOccurrence(pendingQueue.ids, slideIds)
            useAppStore.getState().removeSharedQueueSlideIds(slideIds)
            console.error('[useLiveSession] Failed to add to queue:', err)
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, addToQueueMutation, addToOperatorDeckMutation, isOpenMode, setLiveOutputSlidesId, sessionScheduleId, upsertScheduleSlideMutation])

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
                trackEvent(AnalyticsEventType.SLIDE_REORDERED, {
                    scope: 'queue',
                    slide_count: orderedSlideIds.length,
                })
            } catch (err) {
                console.error('[useLiveSession] Failed to reorder queue:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, sessionRole, reorderQueueMutation, trackEvent])

    const handleSyncOperatorSlides = useCallback(async (slideIds: string[]) => {
        if (resolvedSessionId && isConvexConnected && !isOffline && sessionRole === 'operator') {
            try {
                await setOperatorSlidesMutation({ sessionId: resolvedSessionId, slideIds })
                trackEvent(AnalyticsEventType.SLIDE_REORDERED, {
                    scope: 'operator_deck',
                    slide_count: slideIds.length,
                })
            } catch (err) {
                console.error('[useLiveSession] Failed to sync operator slides:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, sessionRole, setOperatorSlidesMutation, trackEvent])

    const handleSyncSlideContent = useCallback(async (slide: Slide) => {
        if (!sessionScheduleId || !isConvexConnected || isOffline) return

        try {
            await upsertScheduleSlideMutation({
                scheduleId: sessionScheduleId,
                slide: toSyncableSlide(slide, 0),
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
        if (alertId) {
            trackEvent(AnalyticsEventType.ALERT_TRIGGERED, {
                alert_id: alertId,
                overlay,
            })
        }
        if (resolvedSessionId && isConvexConnected && !isOffline) {
            try {
                await setOverlayMutation({ sessionId: resolvedSessionId, overlay, alertId })
            } catch (err) {
                console.error('[useLiveSession] Failed to set overlay:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, setOverlayMutation, setActiveOverlay, trackEvent])

    const handleTransferOperator = useCallback(async (newOperatorId: string) => {
        if (resolvedSessionId && isConvexConnected && !isOffline) {
            try {
                await transferOperatorMutation({ sessionId: resolvedSessionId, newOperatorId: newOperatorId as Id<"users"> })
            } catch (err) {
                console.error('[useLiveSession] Failed to transfer operator:', err)
            }
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, transferOperatorMutation])

    const handleUpdateCollaborationMode = useCallback(async (mode: CollaborationMode) => {
        if (!resolvedSessionId || !isConvexConnected || isOffline) return

        if (sessionRole !== 'operator') {
            console.warn('[useLiveSession] Only the operator can change collaboration mode')
            return
        }

        try {
            await updateCollaborationModeMutation({ sessionId: resolvedSessionId, collaborationMode: mode })
            setCollaborationMode(mode)
        } catch (err) {
            console.error('[useLiveSession] Failed to update collaboration mode:', err)
        }
    }, [resolvedSessionId, isConvexConnected, isOffline, sessionRole, updateCollaborationModeMutation])

    // Auto-sync operator's slide order to Convex when it changes locally
    useEffect(() => {
        if (!sync || !resolvedSessionId || !isConvexConnected || isOffline || sessionRole !== 'operator') return
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
    }, [sync, liveOutputSlidesId, resolvedSessionId, isConvexConnected, isOffline, sessionRole, setOperatorSlidesMutation])

    // Push the operator's slide edits: only what changed since the last sync
    // or server update, and deletes only for slides this device had and lost.
    useEffect(() => {
        if (!sync || !sessionScheduleId || !isConvexConnected || isOffline || sessionRole !== 'operator') return
        resetBaselineFor(sessionScheduleId)

        const scheduleActiveSlides = activeSlides
            .filter((slide) => slide.scheduleId === sessionScheduleId || !slide.scheduleId || slide.scheduleId === '')
            .map((slide, index) => toSyncableSlide(slide, index))

        const { upserts, deletes, next } = diffScheduleSlides(slideBaselineRef.current, scheduleActiveSlides)
        if (upserts.length === 0 && deletes.length === 0) return

        const timeoutId = setTimeout(() => {
            applyScheduleSlideChangesMutation({ scheduleId: sessionScheduleId, upserts, deletes })
                .then(() => {
                    slideBaselineRef.current = next
                })
                .catch((err: unknown) => {
                    console.error('[useLiveSession] Failed to sync schedule slides:', err)
                })
        }, 750)

        return () => clearTimeout(timeoutId)
    }, [sync, activeSlides, sessionScheduleId, isConvexConnected, isOffline, sessionRole, applyScheduleSlideChangesMutation])

    // Reconnection recovery: reconcile session state when Convex reconnects
    const prevConnectedRef = useRef(isConvexConnected)
    useEffect(() => {
        const wasDisconnected = !prevConnectedRef.current
        prevConnectedRef.current = isConvexConnected

        if (sync && isConvexConnected && !isOffline && resolvedSessionId && wasDisconnected) {
            if (pendingQueue.ids.length > 0) {
                const pendingIds = [...pendingQueue.ids]
                pendingQueue.ids = []
                if (sessionRole !== 'operator') {
                    addToQueueMutation({ sessionId: resolvedSessionId, slideIds: pendingIds })
                        .catch(err => {
                            console.error('[useLiveSession] Failed to replay pending queue on reconnect:', err)
                        })
                }
            }
        }
    }, [sync, isConvexConnected, isOffline, resolvedSessionId, sessionRole, addToQueueMutation])

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
        updateCollaborationMode: handleUpdateCollaborationMode,
    }
}
