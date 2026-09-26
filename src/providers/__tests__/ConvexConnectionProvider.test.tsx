import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useEffect, useState } from 'react'

// A fake real client whose websocket state the test drives.
const socket = vi.hoisted(() => ({
    state: { isWebSocketConnected: true, hasEverConnected: true },
    listeners: new Set<(s: { isWebSocketConnected: boolean; hasEverConnected: boolean }) => void>(),
    set(next: { isWebSocketConnected: boolean; hasEverConnected: boolean }) {
        this.state = next
        this.listeners.forEach((cb) => cb(next))
    },
}))

vi.mock('convex/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('convex/react')>()
    class FakeClient {
        connectionState() { return socket.state }
        subscribeToConnectionState(cb: (s: typeof socket.state) => void) {
            socket.listeners.add(cb)
            return () => socket.listeners.delete(cb)
        }
        close() { return Promise.resolve() }
    }
    return { ...actual, ConvexReactClient: FakeClient }
})

// Record which client the app is handed, without a real Clerk/Convex auth dance.
const clientsSeen = vi.hoisted(() => [] as unknown[])
vi.mock('convex/react-clerk', () => ({
    ConvexProviderWithClerk: ({ client, children }: { client: unknown; children: React.ReactNode }) => {
        clientsSeen.push(client)
        return <>{children}</>
    },
}))
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }))
vi.mock('../../hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }))
vi.mock('../../hooks/offline/useOnlineStatus', () => ({
    useOnlineStatus: () => ({ isOnline: true, isOffline: false }),
}))

import { ConvexConnectionProvider, useConvexConnection } from '../ConvexConnectionProvider'
import { nullClient } from '../NullConvexProvider'

let mounts = 0

/** Stands in for the studio: counts its mounts and holds some local state. */
function Studio() {
    const { isOffline } = useConvexConnection()
    const [draft] = useState(() => `draft-${Math.random()}`)
    useEffect(() => {
        mounts++
    }, [])
    return <div>{isOffline ? 'offline' : 'online'} <span>{draft}</span></div>
}

function healthResponds(ok: boolean) {
    vi.mocked(fetch).mockImplementation(async () =>
        ok ? new Response('{}', { status: 200 }) : Promise.reject(new TypeError('network down')),
    )
}

async function flush() {
    await act(async () => { await Promise.resolve() })
}

describe('ConvexConnectionProvider', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.stubGlobal('fetch', vi.fn())
        mounts = 0
        clientsSeen.length = 0
        socket.state = { isWebSocketConnected: true, hasEverConnected: true }
        socket.listeners.clear()
        try { localStorage.clear() } catch { /* not needed for the test */ }
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    async function renderConnected() {
        healthResponds(true)
        render(
            <ConvexConnectionProvider convexUrl="https://example.convex.cloud">
                <Studio />
            </ConvexConnectionProvider>,
        )
        await flush()
        expect(screen.getByText(/online/)).toBeInTheDocument()
    }

    it('rides out a failed check while the websocket is up', async () => {
        await renderConnected()

        healthResponds(false)
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })

        // Two failed probes, but the socket never dropped: still online.
        expect(screen.getByText(/^online/)).toBeInTheDocument()
        expect(mounts).toBe(1)
    })

    it('goes offline only on repeated failures with the socket down — without remounting', async () => {
        await renderConnected()
        const draft = screen.getByText(/^draft-/).textContent

        socket.set({ isWebSocketConnected: false, hasEverConnected: true })
        healthResponds(false)
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
        // One failure is a blip, not an outage.
        expect(screen.getByText(/^online/)).toBeInTheDocument()

        await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
        expect(screen.getByText(/^offline/)).toBeInTheDocument()
        expect(clientsSeen.at(-1)).toBe(nullClient)

        // The studio kept its state and was never remounted.
        expect(screen.getByText(/^draft-/).textContent).toBe(draft)
        expect(mounts).toBe(1)
    })

    it('comes back as soon as the websocket reconnects', async () => {
        await renderConnected()
        socket.set({ isWebSocketConnected: false, hasEverConnected: true })
        healthResponds(false)
        await act(async () => { await vi.advanceTimersByTimeAsync(40_000) })
        expect(screen.getByText(/^offline/)).toBeInTheDocument()

        act(() => socket.set({ isWebSocketConnected: true, hasEverConnected: true }))

        expect(screen.getByText(/^online/)).toBeInTheDocument()
        expect(clientsSeen.at(-1)).not.toBe(nullClient)
        expect(mounts).toBe(1)
    })

    it('retrying never blanks the app with the connection check screen', async () => {
        let retry: () => void = () => {}
        function Grab() {
            retry = useConvexConnection().retryConnection
            return null
        }
        healthResponds(true)
        render(
            <ConvexConnectionProvider convexUrl="https://example.convex.cloud">
                <Studio />
                <Grab />
            </ConvexConnectionProvider>,
        )
        await flush()

        act(() => retry())
        expect(screen.queryByText('Checking connection...')).not.toBeInTheDocument()
        await flush()
        expect(mounts).toBe(1)
    })
})
