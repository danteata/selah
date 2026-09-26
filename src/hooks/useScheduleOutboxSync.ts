import { useEffect } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import { useAppStore } from '../store/appStore'
import { useConvexConnection } from '../providers/ConvexConnectionProvider'
import {
    onScheduleOutboxChange,
    replayScheduleOps,
    type ScheduleOp,
} from '../services/sync/scheduleOutbox'

// A pass that stopped on an error tries again after this long.
const RETRY_MS = 30_000

function describe(op: ScheduleOp): string {
    if (op.kind === 'create') return `create "${op.name}"`
    if (op.kind === 'update') return `rename a schedule to "${op.name}"`
    return 'delete a schedule'
}

/**
 * Sends schedule changes made offline once Convex is reachable.
 *
 * Mounted once (Dashboard), not in useSchedules: that hook has several
 * instances, and each running its own replay would send every queued create
 * several times. Runs when the connection returns, whenever something new is
 * queued, and on a timer while a pass is stalled.
 */
export function useScheduleOutboxSync() {
    const { isOffline } = useConvexConnection()
    const createSchedule = useMutation(api.schedules.createSchedule)
    const updateSchedule = useMutation(api.schedules.updateSchedule)
    const deleteSchedule = useMutation(api.schedules.deleteSchedule)

    useEffect(() => {
        if (isOffline) return

        let stopped = false
        let retryTimer: ReturnType<typeof setTimeout> | null = null

        const run = async () => {
            if (stopped) return
            if (retryTimer) {
                clearTimeout(retryTimer)
                retryTimer = null
            }
            try {
                const result = await replayScheduleOps({
                    create: async (name, churchId) => (await createSchedule({ name, churchId })) as string,
                    update: (scheduleId, name) => updateSchedule({ scheduleId, name }),
                    delete: (scheduleId) => deleteSchedule({ scheduleId }),
                    onCreated: (localId, serverId) => useAppStore.getState().remapScheduleId(localId, serverId),
                    onDropped: (op, error) => {
                        console.warn('[scheduleSync] dropped a change the server kept refusing:', op, error)
                        toast.error(`Couldn't ${describe(op)} made while offline`)
                    },
                })
                if (result.synced > 0) {
                    toast.success(
                        result.synced === 1
                            ? 'Synced a schedule change made offline'
                            : `Synced ${result.synced} schedule changes made offline`
                    )
                }
                if (result.stalled && !stopped) retryTimer = setTimeout(run, RETRY_MS)
            } catch (err) {
                // IndexedDB unavailable, most likely: nothing could be queued.
                console.warn('[scheduleSync] replay failed:', err)
            }
        }

        void run()
        const unsubscribe = onScheduleOutboxChange(() => void run())
        return () => {
            stopped = true
            unsubscribe()
            if (retryTimer) clearTimeout(retryTimer)
        }
    }, [isOffline, createSchedule, updateSchedule, deleteSchedule])
}
