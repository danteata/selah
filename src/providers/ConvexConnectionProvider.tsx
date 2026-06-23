import { useState, useEffect, useRef, type ReactNode, useCallback } from 'react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { useAuth } from '@clerk/clerk-react'
import { useOnlineStatus } from '../hooks/offline/useOnlineStatus'
import { useAnalytics } from '../hooks/useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'
import { NullConvexProvider } from './NullConvexProvider'
import { createContext, useContext } from 'react'

export interface ConvexConnectionState {
    isConvexConnected: boolean
    isOffline: boolean
    isReconnecting: boolean
    isPlanLimit: boolean
    lastConnectedAt: Date | null
    connectionState: 'connected' | 'disconnected' | 'connecting' | 'reconnecting'
}

interface ConvexConnectionContextType extends ConvexConnectionState {
    isOnline: boolean
    retryConnection: () => void
}

const ConvexConnectionContext = createContext<ConvexConnectionContextType>({
    isConvexConnected: false,
    isOffline: true,
    isReconnecting: false,
    isPlanLimit: false,
    lastConnectedAt: null,
    connectionState: 'disconnected',
    isOnline: false,
    retryConnection: () => { },
})

export function useConvexConnection() {
    return useContext(ConvexConnectionContext)
}

const CONNECTION_CHECK_INTERVAL = 30_000
const INITIAL_TIMEOUT = 8_000
const PLAN_LIMIT_KEY = 'selah-convex-plan-limit'

async function checkConvexHealth(convexUrl: string, isOnline: boolean): Promise<{
    connected: boolean
    planLimit: boolean
}> {
    if (!isOnline) return { connected: false, planLimit: false }

    try {
        const baseUrl = convexUrl.replace(/\/api\/query.*/, '')
        const response = await fetch(`${baseUrl}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: 'churches:hasChurch', args: {}, format: 'json' }),
            signal: AbortSignal.timeout(INITIAL_TIMEOUT),
        })

        const body = await response.text().catch(() => '')
        if (body.includes('exceeded the free plan') || body.includes('deployments have been disabled')) {
            return { connected: false, planLimit: true }
        }

        if (response.ok) {
            return { connected: true, planLimit: false }
        }

        if (response.status === 401 || response.status === 400) {
            return { connected: true, planLimit: false }
        }

        if (response.status === 405) {
            return { connected: false, planLimit: true }
        }

        return { connected: false, planLimit: false }
    } catch {
        return { connected: false, planLimit: false }
    }
}

export function ConvexConnectionProvider({
    convexUrl,
    children,
}: {
    convexUrl: string
    children: ReactNode
}) {
    const { isOnline, isOffline: isBrowserOffline } = useOnlineStatus()
    const { trackEvent } = useAnalytics()
    const [connectionState, setConnectionState] = useState<ConvexConnectionState['connectionState']>('connecting')
    const [isConvexConnected, setIsConvexConnected] = useState(false)
    const [isPlanLimit, setIsPlanLimit] = useState(() => {
        try { return localStorage.getItem(PLAN_LIMIT_KEY) === 'true' } catch { return false }
    })
    const [lastConnectedAt, setLastConnectedAt] = useState<Date | null>(null)
    const [initialCheckDone, setInitialCheckDone] = useState(false)
    const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const wasOfflineRef = useRef(false)

    const realClientRef = useRef<ConvexReactClient | null>(null)

    if (!realClientRef.current) {
        realClientRef.current = new ConvexReactClient(convexUrl, { verbose: false })
    }

    const checkConnection = useCallback(async () => {
        const result = await checkConvexHealth(convexUrl, isOnline)

        if (result.connected) {
            const wasOffline = wasOfflineRef.current
            setIsConvexConnected(true)
            setIsPlanLimit(false)
            try { localStorage.removeItem(PLAN_LIMIT_KEY) } catch { }
            setConnectionState('connected')
            setLastConnectedAt(new Date())
            if (wasOffline) {
                // Just came back online
                wasOfflineRef.current = false
                trackEvent(AnalyticsEventType.SESSION_START, { reason: 'reconnected' })
            }
        } else {
            const justWentOffline = !wasOfflineRef.current
            setIsConvexConnected(false)
            setIsPlanLimit(result.planLimit)
            if (result.planLimit) {
                try { localStorage.setItem(PLAN_LIMIT_KEY, 'true') } catch { }
            }
            setConnectionState('disconnected')
            if (justWentOffline && initialCheckDone) {
                wasOfflineRef.current = true
                trackEvent(AnalyticsEventType.OFFLINE_MODE_ENTERED, {
                    plan_limit: result.planLimit,
                })
            }
        }

        setInitialCheckDone(true)
    }, [convexUrl, isOnline, initialCheckDone, trackEvent])

    const retryConnection = useCallback(() => {
        setConnectionState('reconnecting')
        setInitialCheckDone(false)
        realClientRef.current = new ConvexReactClient(convexUrl, { verbose: false })
        checkConnection()
    }, [checkConnection, convexUrl])

    useEffect(() => {
        if (isBrowserOffline) {
            setConnectionState('disconnected')
            setIsConvexConnected(false)
            setInitialCheckDone(true)
            if (checkIntervalRef.current) clearInterval(checkIntervalRef.current)
            return
        }

        checkConnection()

        checkIntervalRef.current = setInterval(checkConnection, CONNECTION_CHECK_INTERVAL)

        return () => {
            if (checkIntervalRef.current) clearInterval(checkIntervalRef.current)
        }
    }, [isBrowserOffline, checkConnection])

    const useOffline = isPlanLimit || (isConvexConnected === false && initialCheckDone)

    const value: ConvexConnectionContextType = {
        isConvexConnected,
        isOffline: !isConvexConnected || isBrowserOffline,
        isReconnecting: connectionState === 'reconnecting',
        isPlanLimit,
        lastConnectedAt,
        connectionState,
        isOnline,
        retryConnection,
    }

    if (!initialCheckDone) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">Checking connection...</p>
                </div>
            </div>
        )
    }

    if (useOffline) {
        return (
            <ConvexConnectionContext.Provider value={value}>
                <NullConvexProvider>
                    {children}
                </NullConvexProvider>
            </ConvexConnectionContext.Provider>
        )
    }

    return (
        <ConvexConnectionContext.Provider value={value}>
            <ConvexProviderWithClerk client={realClientRef.current!} useAuth={useAuth}>
                {children}
            </ConvexProviderWithClerk>
        </ConvexConnectionContext.Provider>
    )
}