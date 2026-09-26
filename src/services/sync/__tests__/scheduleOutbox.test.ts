import { describe, it, expect, beforeEach, vi } from 'vitest'

// The shared setup installs a stub indexedDB; this test wants a real one.
// Assigned before Dexie loads, since Dexie captures it when imported.
await vi.hoisted(async () => {
    const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb')
    const win = globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown }
    win.indexedDB = new IDBFactory()
    win.IDBKeyRange = IDBKeyRange
})
import { getIndexedDB } from '../../../hooks/useIndexedDB'
import {
    enqueueScheduleOp,
    listPendingScheduleOps,
    mergeWithPending,
    replayScheduleOps,
    type ScheduleExecutor,
} from '../scheduleOutbox'
import type { Schedule } from '../../../types'

const ops = async () => (await listPendingScheduleOps()).map((q) => q.op)

function schedule(id: string, name: string): Schedule {
    return { _id: id, name, authorId: 'u1', editorIds: [], churchId: 'c1', createdAt: '', updatedAt: '' }
}

function executor(overrides: Partial<ScheduleExecutor> = {}): ScheduleExecutor {
    let n = 0
    return {
        create: vi.fn(async () => `server_${++n}`),
        update: vi.fn(async () => null),
        delete: vi.fn(async () => null),
        onCreated: vi.fn(),
        onDropped: vi.fn(),
        ...overrides,
    }
}

describe('schedule outbox', () => {
    beforeEach(async () => {
        await getIndexedDB().pendingMutations.clear()
    })

    describe('folding changes as they queue', () => {
        it('renames a schedule the server has not seen inside its queued create', async () => {
            await enqueueScheduleOp({ kind: 'create', localId: 'schedule_1', name: 'Sunday', churchId: 'c1' })
            await enqueueScheduleOp({ kind: 'update', scheduleId: 'schedule_1', name: 'Sunday AM' })

            expect(await ops()).toEqual([{ kind: 'create', localId: 'schedule_1', name: 'Sunday AM', churchId: 'c1' }])
        })

        it('keeps only the last rename of a server schedule', async () => {
            await enqueueScheduleOp({ kind: 'update', scheduleId: 'abc', name: 'One' })
            await enqueueScheduleOp({ kind: 'update', scheduleId: 'abc', name: 'Two' })

            expect(await ops()).toEqual([{ kind: 'update', scheduleId: 'abc', name: 'Two' }])
        })

        it('cancels a create outright when the unsynced schedule is deleted', async () => {
            await enqueueScheduleOp({ kind: 'create', localId: 'schedule_1', name: 'Oops', churchId: 'c1' })
            await enqueueScheduleOp({ kind: 'update', scheduleId: 'schedule_1', name: 'Oops 2' })
            await enqueueScheduleOp({ kind: 'delete', scheduleId: 'schedule_1' })

            // The server never needs to hear about it.
            expect(await ops()).toEqual([])
        })

        it('drops pending renames of a server schedule that is then deleted', async () => {
            await enqueueScheduleOp({ kind: 'update', scheduleId: 'abc', name: 'Renamed' })
            await enqueueScheduleOp({ kind: 'delete', scheduleId: 'abc' })

            expect(await ops()).toEqual([{ kind: 'delete', scheduleId: 'abc' }])
        })
    })

    describe('merging over the server list', () => {
        it('keeps offline creates, renames and deletes instead of reverting them', () => {
            const server = [schedule('a', 'Old name'), schedule('b', 'Deleted offline')]
            const merged = mergeWithPending(
                server,
                [
                    { kind: 'update', scheduleId: 'a', name: 'New name' },
                    { kind: 'delete', scheduleId: 'b' },
                    { kind: 'create', localId: 'schedule_1', name: 'Made offline', churchId: 'c1' },
                ],
                [schedule('schedule_1', 'Made offline')],
            )

            expect(merged.map((s) => [s._id, s.name])).toEqual([
                ['a', 'New name'],
                ['schedule_1', 'Made offline'],
            ])
        })
    })

    describe('replay', () => {
        it('sends queued changes in order and empties the queue', async () => {
            const exec = executor()
            await enqueueScheduleOp({ kind: 'update', scheduleId: 'a', name: 'X' })
            await enqueueScheduleOp({ kind: 'delete', scheduleId: 'b' })

            const result = await replayScheduleOps(exec)

            expect(result).toEqual({ synced: 2, dropped: 0, stalled: false })
            expect(exec.update).toHaveBeenCalledWith('a', 'X')
            expect(exec.delete).toHaveBeenCalledWith('b')
            expect(await ops()).toEqual([])
        })

        it("points later changes at the server's id once a create lands", async () => {
            const exec = executor()
            await enqueueScheduleOp({ kind: 'create', localId: 'schedule_1', name: 'Sunday', churchId: 'c1' })
            // Queued behind the create but not folded into it: pretend the
            // create was already in flight when this rename was made.
            await getIndexedDB().pendingMutations.add({
                mutationName: 'schedules.update',
                args: { kind: 'update', scheduleId: 'schedule_1', name: 'Later' },
                status: 'pending',
                createdAt: new Date().toISOString(),
                retryCount: 0,
            })

            await replayScheduleOps(exec)

            expect(exec.onCreated).toHaveBeenCalledWith('schedule_1', 'server_1')
            expect(exec.update).toHaveBeenCalledWith('server_1', 'Later')
        })

        it('runs one pass at a time, so a create is never sent twice', async () => {
            let release: () => void = () => {}
            const exec = executor({
                create: vi.fn(() => new Promise<string>((resolve) => { release = () => resolve('server_1') })),
            })
            await enqueueScheduleOp({ kind: 'create', localId: 'schedule_1', name: 'Sunday', churchId: 'c1' })

            const first = replayScheduleOps(exec)
            const second = replayScheduleOps(exec)
            await vi.waitFor(() => expect(exec.create).toHaveBeenCalled())
            release()
            await Promise.all([first, second])

            expect(exec.create).toHaveBeenCalledTimes(1)
        })

        it('stops on a refusal, retries later, and gives up after a few tries', async () => {
            const exec = executor({ update: vi.fn(async () => { throw new Error('Schedule not found') }) })
            await enqueueScheduleOp({ kind: 'update', scheduleId: 'gone', name: 'X' })
            await enqueueScheduleOp({ kind: 'delete', scheduleId: 'other' })

            expect((await replayScheduleOps(exec)).stalled).toBe(true)
            expect(exec.delete).not.toHaveBeenCalled()
            await replayScheduleOps(exec)
            const third = await replayScheduleOps(exec)

            // Dropped, told about, and the rest of the queue moves on.
            expect(third.dropped).toBe(1)
            expect(exec.onDropped).toHaveBeenCalled()
            expect(exec.delete).toHaveBeenCalledWith('other')
            expect(await ops()).toEqual([])
        })
    })
})
