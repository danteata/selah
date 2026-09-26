import { useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAppStore } from '../store/appStore'
import { useUserRole } from './useUserRole'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import type { Schedule } from '../types'
import {
    enqueueScheduleOp,
    isLocalScheduleId,
    listPendingScheduleOps,
    mergeWithPending,
    newLocalScheduleId,
} from '../services/sync/scheduleOutbox'

/** The server's own reason, without Convex's "[CONVEX M(...)] Uncaught Error:" wrapper. */
function serverMessage(err: unknown, fallback: string): string {
    const raw = err instanceof Error ? err.message : ''
    const match = raw.match(/Uncaught Error:\s*(.+?)(?:\n|\s+at |$)/)
    return match?.[1] || fallback
}

export function useSchedules() {
    const { currentUser } = useUserRole()
    const { isOffline } = useConvexConnection()
    const churchId = currentUser?.churchId || ''

    const activeSchedule = useAppStore((s) => s.activeSchedule)
    const schedules = useAppStore((s) => s.schedules)
    const setActiveSchedule = useAppStore((s) => s.setActiveSchedule)
    const setSchedules = useAppStore((s) => s.setSchedules)
    const deleteScheduleLocal = useAppStore((s) => s.deleteSchedule)

    const convexSchedules = useQuery(
        api.schedules.getSchedules,
        churchId && !isOffline ? { churchId } : 'skip'
    )

    const createScheduleMutation = useMutation(api.schedules.createSchedule)
    const updateScheduleMutation = useMutation(api.schedules.updateSchedule)
    const deleteScheduleMutation = useMutation(api.schedules.deleteSchedule)

    useEffect(() => {
        if (!convexSchedules || isOffline) return

        const mapped: Schedule[] = convexSchedules.map((s) => ({
            _id: s._id,
            name: s.name,
            authorId: s.authorId,
            editorIds: s.editorIds || [],
            churchId: s.churchId,
            lastUpdated: s.lastUpdated,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
        }))

        // Lay changes still waiting to sync over the server's list. Taking the
        // list as-is is what made offline creates vanish, renames revert and
        // deleted schedules reappear the moment the connection came back.
        let cancelled = false
        listPendingScheduleOps()
            .then((queued) => {
                if (cancelled) return
                const local = useAppStore.getState().schedules
                setSchedules(mergeWithPending(mapped, queued.map((q) => q.op), local))
            })
            .catch(() => {
                // No IndexedDB (private mode): nothing can be queued either.
                if (!cancelled) setSchedules(mapped)
            })
        return () => { cancelled = true }
    }, [convexSchedules, isOffline, setSchedules])

    const createSchedule = useCallback(async (name: string) => {
        const createLocally = () => {
            const localSchedule: Schedule = {
                _id: newLocalScheduleId(),
                name,
                authorId: currentUser?._id || '',
                editorIds: [],
                churchId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
            setActiveSchedule(localSchedule)
            // Without a church there is nowhere on the server for it to go.
            if (churchId) {
                void enqueueScheduleOp({ kind: 'create', localId: localSchedule._id, name, churchId })
                    .catch((err) => console.warn('[useSchedules] could not queue schedule for sync:', err))
            }
            return localSchedule._id
        }

        if (isOffline || !churchId) return createLocally()

        try {
            return await createScheduleMutation({ name, churchId })
        } catch (err) {
            console.error('Failed to create schedule:', err)
            return createLocally()
        }
    }, [churchId, createScheduleMutation, isOffline, setActiveSchedule, currentUser?._id])

    // Online, Convex holds calls while the socket reconnects instead of failing
    // them, so a rejection is the server refusing (not an editor, gone
    // already). Those aren't queued — they'd only fail again — but undone, and
    // said out loud rather than left as a silent local-only change.
    const updateSchedule = useCallback(async (scheduleId: string, updates: { name?: string }) => {
        if (!scheduleId) return
        const before = useAppStore.getState().schedules.find((schedule) => schedule._id === scheduleId)
        useAppStore.getState().updateSchedule(scheduleId, updates)
        if (updates.name === undefined) return

        const queue = () => enqueueScheduleOp({ kind: 'update', scheduleId, name: updates.name! })
            .catch((err) => console.warn('[useSchedules] could not queue rename for sync:', err))

        // A schedule still waiting to be created is renamed in the queue.
        if (isOffline || isLocalScheduleId(scheduleId)) {
            await queue()
            return
        }

        try {
            await updateScheduleMutation({ scheduleId, ...updates })
        } catch (err) {
            console.error('Failed to update schedule on server:', err)
            if (before) useAppStore.getState().updateSchedule(scheduleId, { name: before.name })
            toast.error(serverMessage(err, "Couldn't rename that schedule"))
        }
    }, [updateScheduleMutation, isOffline])

    const deleteSchedule = useCallback(async (scheduleId: string) => {
        if (!scheduleId) return
        const before = useAppStore.getState().schedules.find((schedule) => schedule._id === scheduleId)
        deleteScheduleLocal(scheduleId)

        const queue = () => enqueueScheduleOp({ kind: 'delete', scheduleId })
            .catch((err) => console.warn('[useSchedules] could not queue delete for sync:', err))

        if (isOffline || isLocalScheduleId(scheduleId)) {
            await queue()
            return
        }

        try {
            await deleteScheduleMutation({ scheduleId })
        } catch (err) {
            console.error('Failed to delete schedule on server:', err)
            if (before) {
                const state = useAppStore.getState()
                state.setSchedules([...state.schedules, before])
            }
            toast.error(serverMessage(err, "Couldn't delete that schedule"))
        }
    }, [deleteScheduleMutation, deleteScheduleLocal, isOffline])

    return {
        schedules,
        activeSchedule,
        setActiveSchedule,
        createSchedule,
        updateSchedule,
        deleteSchedule,
        churchId,
        isLoading: convexSchedules === undefined && !isOffline,
    }
}