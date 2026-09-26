/**
 * Schedule changes made offline, kept until the server has them.
 *
 * Offline, or when a server call failed, schedule edits used to happen only in
 * the local store and were then lost: a created schedule kept a local id that
 * never reached the server, renames and deletes were never sent, and the next
 * server list replaced everything — offline creates vanished, renames reverted,
 * deleted schedules came back.
 *
 * Changes now queue here (IndexedDB `pendingMutations`, so they survive a
 * reload), folded together as they arrive, and are replayed in order by a
 * single sync loop (useScheduleOutboxSync) whenever Convex is reachable.
 */

import { getIndexedDB, type PendingMutation } from '../../hooks/useIndexedDB'
import type { Schedule } from '../../types'

export type ScheduleOp =
    | { kind: 'create'; localId: string; name: string; churchId: string }
    | { kind: 'update'; scheduleId: string; name: string }
    | { kind: 'delete'; scheduleId: string }

type QueuedOp = { rowId: number; op: ScheduleOp; retryCount: number }

const PREFIX = 'schedules.'
// A change the server keeps rejecting (e.g. renaming a schedule someone else
// deleted) is dropped after this many attempts rather than blocking the queue.
const MAX_ATTEMPTS = 3

/** Ids minted locally for schedules the server hasn't seen yet. */
export function isLocalScheduleId(id: string): boolean {
    return id.startsWith('schedule_')
}

export function newLocalScheduleId(): string {
    return `schedule_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

function toRow(op: ScheduleOp): Omit<PendingMutation, 'id'> {
    return {
        mutationName: PREFIX + op.kind,
        args: op as unknown as Record<string, unknown>,
        status: 'pending',
        createdAt: new Date().toISOString(),
        retryCount: 0,
        localId: op.kind === 'create' ? op.localId : undefined,
    }
}

async function pendingRows(): Promise<PendingMutation[]> {
    const rows = await getIndexedDB().pendingMutations.where('status').equals('pending').toArray()
    // Insertion order: the auto-increment key, which createdAt can tie on.
    return rows
        .filter((row) => row.mutationName.startsWith(PREFIX))
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}

export async function listPendingScheduleOps(): Promise<QueuedOp[]> {
    const rows = await pendingRows()
    return rows.map((row) => ({ rowId: row.id!, op: row.args as unknown as ScheduleOp, retryCount: row.retryCount }))
}

const listeners = new Set<() => void>()

/** Called after every change to the queue — how the sync loop hears about work. */
export function onScheduleOutboxChange(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function notify() {
    listeners.forEach((listener) => listener())
}

/**
 * Queue a change, folded into what is already waiting:
 * - renaming a schedule the server hasn't seen renames its queued create;
 * - a second rename replaces the first;
 * - deleting one the server hasn't seen cancels its create (and renames) —
 *   the server never needs to hear about it at all.
 */
export async function enqueueScheduleOp(op: ScheduleOp): Promise<void> {
    const db = getIndexedDB()
    await db.transaction('rw', db.pendingMutations, async () => {
        const queued = await pendingRows()
        const argsOf = (row: PendingMutation) => row.args as unknown as ScheduleOp

        if (op.kind === 'create') {
            await db.pendingMutations.add(toRow(op) as PendingMutation)
            return
        }

        const targetId = op.scheduleId
        const create = queued.find((row) => {
            const queuedOp = argsOf(row)
            return queuedOp.kind === 'create' && queuedOp.localId === targetId
        })
        const updates = queued.filter((row) => {
            const queuedOp = argsOf(row)
            return queuedOp.kind === 'update' && queuedOp.scheduleId === targetId
        })

        if (op.kind === 'update') {
            if (create) {
                await db.pendingMutations.update(create.id!, { args: { ...argsOf(create), name: op.name } })
            } else if (updates.length > 0) {
                await db.pendingMutations.update(updates[updates.length - 1].id!, { args: op as unknown as Record<string, unknown> })
            } else {
                await db.pendingMutations.add(toRow(op) as PendingMutation)
            }
            return
        }

        // delete
        await db.pendingMutations.bulkDelete(updates.map((row) => row.id!))
        if (create) {
            await db.pendingMutations.delete(create.id!)
        } else {
            await db.pendingMutations.add(toRow(op) as PendingMutation)
        }
    })
    notify()
}

/**
 * The server's schedule list with changes still waiting laid on top, so the
 * UI shows what the user did rather than flickering back to what the server
 * knew before.
 */
export function mergeWithPending(server: Schedule[], pending: ScheduleOp[], local: Schedule[]): Schedule[] {
    const deleted = new Set<string>()
    const renamed = new Map<string, string>()
    const created: ScheduleOp[] = []
    for (const op of pending) {
        if (op.kind === 'delete') deleted.add(op.scheduleId)
        else if (op.kind === 'update') renamed.set(op.scheduleId, op.name)
        else created.push(op)
    }

    const merged = server
        .filter((schedule) => !deleted.has(schedule._id))
        .map((schedule) => (renamed.has(schedule._id) ? { ...schedule, name: renamed.get(schedule._id)! } : schedule))

    for (const op of created) {
        if (op.kind !== 'create' || merged.some((schedule) => schedule._id === op.localId)) continue
        const existing = local.find((schedule) => schedule._id === op.localId)
        const now = new Date().toISOString()
        merged.push({
            ...(existing ?? { authorId: '', editorIds: [], createdAt: now, updatedAt: now }),
            _id: op.localId,
            name: op.name,
            churchId: op.churchId,
        } as Schedule)
    }
    return merged
}

export interface ScheduleExecutor {
    create: (name: string, churchId: string) => Promise<string>
    update: (scheduleId: string, name: string) => Promise<unknown>
    delete: (scheduleId: string) => Promise<unknown>
    /** A queued create landed: swap the local id for the server's everywhere. */
    onCreated: (localId: string, serverId: string) => void
    /** A change the server kept rejecting was dropped. */
    onDropped?: (op: ScheduleOp, error: unknown) => void
}

export interface ReplayResult {
    synced: number
    dropped: number
    /** Stopped on an error and will try again later. */
    stalled: boolean
}

let replaying: Promise<ReplayResult> | null = null

/**
 * Send queued changes, oldest first. One pass at a time across the app, since
 * two concurrent passes would each send the same create.
 */
export function replayScheduleOps(executor: ScheduleExecutor): Promise<ReplayResult> {
    if (replaying) return replaying
    replaying = (async () => {
        const db = getIndexedDB()
        const result: ReplayResult = { synced: 0, dropped: 0, stalled: false }
        try {
            // Re-read each round: the queue can change while a call is out.
            for (;;) {
                const [next] = await listPendingScheduleOps()
                if (!next) break
                const { op, rowId, retryCount } = next
                try {
                    if (op.kind === 'create') {
                        const serverId = await executor.create(op.name, op.churchId)
                        // Point anything still queued for the local id at the
                        // real one before this create leaves the queue.
                        await db.transaction('rw', db.pendingMutations, async () => {
                            for (const row of await pendingRows()) {
                                const queued = row.args as unknown as ScheduleOp
                                if (queued.kind !== 'create' && queued.scheduleId === op.localId) {
                                    await db.pendingMutations.update(row.id!, { args: { ...queued, scheduleId: serverId } })
                                }
                            }
                            await db.pendingMutations.delete(rowId)
                        })
                        executor.onCreated(op.localId, serverId)
                    } else {
                        if (op.kind === 'update') await executor.update(op.scheduleId, op.name)
                        else await executor.delete(op.scheduleId)
                        await db.pendingMutations.delete(rowId)
                    }
                    result.synced++
                } catch (error) {
                    // Convex queues calls while disconnected rather than
                    // rejecting them, so a rejection is the server refusing.
                    // Retry a few passes (it may be transient), then give up
                    // on this one so the rest of the queue can move.
                    if (retryCount + 1 >= MAX_ATTEMPTS) {
                        await db.pendingMutations.update(rowId, { status: 'failed', retryCount: retryCount + 1 })
                        result.dropped++
                        executor.onDropped?.(op, error)
                        continue
                    }
                    await db.pendingMutations.update(rowId, { retryCount: retryCount + 1 })
                    result.stalled = true
                    break
                }
            }
            return result
        } finally {
            // No notify() here: the sync loop listens for changes, and a pass
            // that stalled would otherwise retrigger itself at once, forever.
            replaying = null
        }
    })()
    return replaying
}
