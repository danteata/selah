import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useConvexAuth, useQuery } from 'convex/react'
import { NullConvexProvider } from '../NullConvexProvider'

// Clerk isn't signed in here; offline means unauthenticated to Convex anyway.
vi.mock('@clerk/clerk-react', () => ({
    useAuth: () => ({
        isLoaded: true,
        isSignedIn: false,
        getToken: async () => null,
        orgId: undefined,
        orgRole: undefined,
    }),
}))

function NeedsConvexAuth() {
    // usePresence does exactly this. Under a plain ConvexProvider it throws
    // during render, which took the whole app down when Convex went away.
    const { isAuthenticated, isLoading } = useConvexAuth()
    return <div>auth:{String(isAuthenticated)} loading:{String(isLoading)}</div>
}

function NeedsQuery() {
    const result = useQuery('anything:atAll' as never)
    return <div>query:{JSON.stringify(result)}</div>
}

describe('NullConvexProvider', () => {
    it('satisfies useConvexAuth, so an offline app still renders', () => {
        // The regression: "Could not find ConvexProviderWithAuth as an ancestor
        // component" thrown during render of an offline-first app.
        render(
            <NullConvexProvider>
                <NeedsConvexAuth />
            </NullConvexProvider>,
        )
        expect(screen.getByText(/^auth:/)).toBeInTheDocument()
        expect(screen.getByText(/auth:false/)).toBeInTheDocument()
    })

    it('lets queries render rather than throw', () => {
        render(
            <NullConvexProvider>
                <NeedsQuery />
            </NullConvexProvider>,
        )
        expect(screen.getByText(/^query:/)).toBeInTheDocument()
    })
})
