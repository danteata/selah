import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const server = vi.hoisted(() => ({ list: [] as unknown[] }))
const locals = vi.hoisted(() => ({ rows: [] as unknown[] }))
const connection = vi.hoisted(() => ({ isOffline: false }))

vi.mock('convex/react', () => ({
    useQuery: () => server.list,
    useMutation: () => vi.fn(async () => 'x'),
    useConvex: () => ({}),
}))
vi.mock('../../providers/ConvexConnectionProvider', () => ({ useConvexConnection: () => connection }))
vi.mock('../useIndexedDB', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../useIndexedDB')>()),
    getLocalTemplates: vi.fn(async () => locals.rows),
    saveLocalTemplate: vi.fn(async () => {}),
    deleteLocalTemplate: vi.fn(async () => {}),
    updateLocalTemplate: vi.fn(async () => {}),
}))

import { useTemplates } from '../useTemplates'

const serverTemplate = (id: string, name: string) => ({
    _id: id, name, slideId: '{}', category: 'general', createdBy: 'u1', createdAt: '', updatedAt: '2026-01-01',
})
const cached = (id: string, name: string, synced: boolean) => ({
    id, name, slideId: '{}', category: 'general', createdBy: 'u1', createdAt: '', updatedAt: '2030-01-01', synced,
})

/** Leaving out the built-ins the app lists offline. */
const theChurchs = (templates: Array<{ _id: string; name: string }> | undefined) =>
    (templates ?? []).filter((t) => !t._id.startsWith('builtin:'))

describe('useTemplates merge', () => {
    beforeEach(() => {
        server.list = [serverTemplate('a', 'Server A')]
        locals.rows = []
        connection.isOffline = false
        localStorage.clear()
    })

    it('does not bring back a template deleted elsewhere', async () => {
        // A cached copy of "gone", which the server no longer has.
        locals.rows = [cached('gone', 'Deleted on another device', true)]
        const { result } = renderHook(() => useTemplates())
        await waitFor(() => expect(result.current.templates?.map((t) => t._id)).toEqual(['a']))
    })

    it('does not let a stale cached copy override the server', async () => {
        locals.rows = [cached('a', 'Old local name', true)]
        const { result } = renderHook(() => useTemplates())
        await waitFor(() => expect(result.current.templates?.[0]?.name).toBe('Server A'))
    })

    it('shows a change the server does not have yet', async () => {
        locals.rows = [cached('a', 'Edited offline', false), cached('local_1', 'Made offline', false)]
        const { result } = renderHook(() => useTemplates())
        await waitFor(() => expect(result.current.templates?.map((t) => t.name).sort()).toEqual(['Edited offline', 'Made offline']))
    })

    it("keeps the church's templates when going offline", async () => {
        // Offline used to list only templates made on this device: every
        // shared template vanished from the picker mid-service.
        const online = renderHook(() => useTemplates())
        await waitFor(() => expect(online.result.current.templates?.map((t) => t._id)).toEqual(['a']))
        online.unmount()

        connection.isOffline = true
        locals.rows = [cached('local_1', 'Made offline', false)]
        const { result } = renderHook(() => useTemplates())
        await waitFor(() => expect(theChurchs(result.current.templates).map((t) => t.name).sort()).toEqual(['Made offline', 'Server A']))
    })

    it("doesn't overwrite the church's templates with the offline client's empty answer", async () => {
        const online = renderHook(() => useTemplates())
        await waitFor(() => expect(online.result.current.templates?.map((t) => t._id)).toEqual(['a']))
        online.unmount()

        // Offline, every query answers with an empty list.
        connection.isOffline = true
        server.list = []
        const first = renderHook(() => useTemplates())
        await waitFor(() => expect(theChurchs(first.result.current.templates).map((t) => t._id)).toEqual(['a']))
        first.unmount()

        const again = renderHook(() => useTemplates())
        await waitFor(() => expect(theChurchs(again.result.current.templates).map((t) => t._id)).toEqual(['a']))
    })

    it('lists the built-in motion templates offline, even with nothing cached', async () => {
        connection.isOffline = true
        server.list = []
        const { result } = renderHook(() => useTemplates())
        await waitFor(() => expect(result.current.templates?.map((t) => t.name)).toEqual(
            expect.arrayContaining(['Galaxy', 'Aurora', 'Warm Glow', 'Embers', 'Silk', 'Light Rays']),
        ))
    })
})
