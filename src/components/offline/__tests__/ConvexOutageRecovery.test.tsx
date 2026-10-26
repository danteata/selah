import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { CONVEX_OUTAGE_EVENT } from '../../../utils/convexOutage'

// Stands in for ConvexConnectionProvider: a reported outage takes the app offline.
const connection = vi.hoisted(() => ({
    offline: false,
    listeners: new Set<() => void>(),
    goOffline() {
        connection.offline = true
        connection.listeners.forEach((l) => l())
    },
}))
vi.mock('../../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: () => {
        const isOffline = useSyncExternalStore(
            (l) => { connection.listeners.add(l); return () => connection.listeners.delete(l) },
            () => connection.offline,
        )
        return { isOffline }
    },
}))
vi.mock('../../../services/analytics', () => ({
    analytics: { trackEvent: vi.fn() },
    AnalyticsEventType: { ERROR_OCCURRED: 'error_occurred' },
}))

import { RouteErrorBoundary } from '../RouteErrorBoundary'
import { PanelErrorBoundary } from '../PanelErrorBoundary'
import { ConvexErrorBoundary } from '../ConvexErrorBoundary'
import { useConvexConnection } from '../../../providers/ConvexConnectionProvider'

const OUTAGE = '[CONVEX Q(templates:getTemplates)] [Request ID: 3efc01c0817a0af4] Server Error\n'
    + 'You have exceeded the free plan limits, so your deployments have been disabled.'

/** A screen whose query throws while Convex is in use, and reads local data offline. */
function Templates() {
    const { isOffline } = useConvexConnection()
    if (!isOffline) throw new Error(OUTAGE)
    return <div>Templates on this computer</div>
}

/** One that throws the outage whatever client it has: not something to retry forever. */
function AlwaysOutage(): never {
    throw new Error(OUTAGE)
}

describe('error boundaries during a Convex outage', () => {
    beforeEach(() => {
        connection.offline = false
        connection.listeners.clear()
        window.addEventListener(CONVEX_OUTAGE_EVENT, connection.goOffline)
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        window.removeEventListener(CONVEX_OUTAGE_EVENT, connection.goOffline)
        vi.restoreAllMocks()
    })

    it('a route carries on offline instead of showing the crash screen', async () => {
        render(<RouteErrorBoundary name="dashboard"><Templates /></RouteErrorBoundary>)

        expect(await screen.findByText('Templates on this computer')).toBeInTheDocument()
        expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
        expect(screen.queryByText(/exceeded the free plan/)).not.toBeInTheDocument()
    })

    it('a panel carries on offline instead of saying it stopped responding', async () => {
        render(<PanelErrorBoundary name="templates"><Templates /></PanelErrorBoundary>)

        expect(await screen.findByText('Templates on this computer')).toBeInTheDocument()
        expect(screen.queryByText('This panel stopped responding')).not.toBeInTheDocument()
    })

    it('the app-level boundary carries on offline too', async () => {
        render(<ConvexErrorBoundary><Templates /></ConvexErrorBoundary>)

        expect(await screen.findByText('Templates on this computer')).toBeInTheDocument()
    })

    it('gives up and shows the crash screen if the screen keeps throwing offline', async () => {
        render(<RouteErrorBoundary name="dashboard"><AlwaysOutage /></RouteErrorBoundary>)

        expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    })
})
