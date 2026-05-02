import { type ReactNode } from 'react'
import { ConvexReactClient, ConvexProvider } from 'convex/react'

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

export function NullConvexProvider({ children }: { children: ReactNode }) {
    return (
        <ConvexProvider client={nullClient}>
            {children}
        </ConvexProvider>
    )
}