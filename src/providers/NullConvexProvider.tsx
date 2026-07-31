import { type ReactNode } from 'react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { useAuth } from '@clerk/clerk-react'

class NullWatch {
    private listener: ((value: any) => void) | null = null

    localQueryResult() {
        return []
    }

    journal() {
        return undefined
    }

    onUpdate(callback: (value: any) => void) {
        this.listener = callback
        if (this.listener) {
            this.listener([])
        }
        return () => {
            this.listener = null
        }
    }
}

class NullConvexReactClient {
    query() {
        return Promise.resolve([])
    }

    mutation() {
        return Promise.reject(new Error('Convex is offline'))
    }

    action() {
        return Promise.reject(new Error('Convex is offline'))
    }

    watchQuery() {
        return new NullWatch()
    }

    watchPaginatedQuery() {
        return new NullWatch()
    }

    connectionState() {
        return { isInFlight: false, hasEverConnected: false } as any
    }

    subscribeToConnectionState() {
        return () => {}
    }

    setAuth() {}
    clearAuth() {}
    close() { return Promise.resolve() }

    get url() {
        return ''
    }
}

const nullClient = new NullConvexReactClient() as unknown as ConvexReactClient

/**
 * Stands in for the real Convex provider while offline — including when the
 * deployment is unreachable because its plan limit was hit.
 *
 * Deliberately `ConvexProviderWithClerk`, not the plain `ConvexProvider` it used
 * to be. `useConvexAuth()` (usePresence) requires the auth-aware provider and
 * throws without it: "Could not find ConvexProviderWithAuth as an ancestor
 * component". That threw during render, so an offline-first app failed to start
 * at all the moment Convex went away — precisely the case this provider exists
 * for. The null client's setAuth/clearAuth are no-ops, so the auth context
 * resolves to unauthenticated, which is the truth when Convex is unreachable.
 */
export function NullConvexProvider({ children }: { children: ReactNode }) {
    return (
        <ConvexProviderWithClerk client={nullClient} useAuth={useAuth}>
            {children}
        </ConvexProviderWithClerk>
    )
}