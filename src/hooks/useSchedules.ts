import { useEffect, useCallback } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAppStore } from '../store/appStore'
import { useUserRole } from './useUserRole'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import type { Schedule } from '../types'

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

        const mapped: Schedule[] = convexSchedules.map((s: any) => ({
            _id: s._id,
            name: s.name,
            authorId: s.authorId,
            editorIds: s.editorIds || [],
            churchId: s.churchId,
            lastUpdated: s.lastUpdated,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
        }))

        setSchedules(mapped)
    }, [convexSchedules, isOffline, setSchedules])

    const createSchedule = useCallback(async (name: string) => {
        if (isOffline || !churchId) {
            const localSchedule: Schedule = {
                _id: `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name,
                authorId: currentUser?._id || '',
                editorIds: [],
                churchId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
            setActiveSchedule(localSchedule)
            return localSchedule._id
        }

        try {
            const scheduleId = await createScheduleMutation({ name, churchId })
            return scheduleId
        } catch (err) {
            console.error('Failed to create schedule:', err)
            const localSchedule: Schedule = {
                _id: `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name,
                authorId: currentUser?._id || '',
                editorIds: [],
                churchId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
            setActiveSchedule(localSchedule)
            return localSchedule._id
        }
    }, [churchId, createScheduleMutation, isOffline, setActiveSchedule, currentUser?._id])

    const updateSchedule = useCallback(async (scheduleId: string, updates: { name?: string }) => {
        const storeUpdate = useAppStore.getState().updateSchedule
        storeUpdate(scheduleId, updates)

        if (isOffline || !scheduleId) return

        try {
            await updateScheduleMutation({ scheduleId, ...updates })
        } catch (err) {
            console.error('Failed to update schedule on server:', err)
        }
    }, [updateScheduleMutation, isOffline])

    const deleteSchedule = useCallback(async (scheduleId: string) => {
        deleteScheduleLocal(scheduleId)

        if (isOffline || !scheduleId) return

        try {
            await deleteScheduleMutation({ scheduleId })
        } catch (err) {
            console.error('Failed to delete schedule on server:', err)
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