import { useState, useEffect, useRef, useMemo, type ReactNode, useCallback } from 'react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { useAuth } from '@clerk/clerk-react'
import { useOnlineStatus } from '../hooks/offline/useOnlineStatus'
import { useAnalytics } from '../hooks/useAnalytics'
import { AnalyticsEventType } from '../services/analytics/types'
import { nullClient } from './NullConvexProvider'
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

// A health check that fails right after one that succeeded is re-run this soon,
// so a blip is confirmed (or not) quickly instead of 30s later.
const RECHECK_AFTER_FAILURE_MS = 10_000
// Consecutive failed checks, mid-session, before calling Convex unreachable.
const FAILURES_BEFORE_OFFLINE = 2

/**
 * Tracks whether Convex is reachable and routes the app to the real client or
 * the offline stand-in.
 *
 * The tree under this provider never remounts. It used to render a different
 * provider component when offline, so one failed health check — a few seconds
 * of lost Wi-Fi, every 30s probe with an 8s timeout — unmounted the whole app
 * mid-service: open editors, modals, the live session, all gone, and again on
 * the way back. Now there is one provider whose *client* is switched (Convex's
 * hooks re-point existing queries on a client change), and "offline" means the
 * websocket is down and repeated checks agree, not that one fetch timed out.
 */
export function ConvexConnectionProvider({
    convexUrl,
    children,
}: {
    convexUrl: string
    children: ReactNode
}) {
    const { isOnline, isOffline: isBrowserOffline } = useOnlineStatus()
    const { trackEvent } = useAnalytics()

    // One real client for the life of the app. It reconnects its websocket on
    // its own; replacing it (as the old retry did) leaked the previous one.
    // Not closed on unmount: it lives as long as the app, and StrictMode's
    // rehearsal unmount would otherwise close the only client for good.
    const [realClient] = useState(() => new ConvexReactClient(convexUrl, { verbose: false }))

    const [isPlanLimit, setIsPlanLimit] = useState(() => {
        try { return localStorage.getItem(PLAN_LIMIT_KEY) === 'true' } catch { return false }
    })
    const [initialCheckDone, setInitialCheckDone] = useState(false)
    const [consecutiveFailures, setConsecutiveFailures] = useState(0)
    const [checking, setChecking] = useState(false)
    const [lastConnectedAt, setLastConnectedAt] = useState<Date | null>(null)
    const [socket, setSocket] = useState(() => {
        const state = realClient.connectionState()
        return { connected: state.isWebSocketConnected, everConnected: state.hasEverConnected }
    })
    const [everHealthy, setEverHealthy] = useState(false)
    const recheckRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // The websocket is the ground truth for "connected": while it is up we
    // are online whatever a health probe says, and it coming back ends an
    // outage at once rather than at the next 30s check.
    useEffect(() => {
        return realClient.subscribeToConnectionState((state) => {
            setSocket((prev) =>
                prev.connected === state.isWebSocketConnected && prev.everConnected === state.hasEverConnected
                    ? prev
                    : { connected: state.isWebSocketConnected, everConnected: state.hasEverConnected }
            )
        })
    }, [realClient])

    const checkConnection = useCallback(async () => {
        setChecking(true)
        const result = await checkConvexHealth(convexUrl, isOnline)
        setChecking(false)

        if (result.connected) {
            setEverHealthy(true)
            setConsecutiveFailures(0)
            setIsPlanLimit(false)
            try { localStorage.removeItem(PLAN_LIMIT_KEY) } catch { /* storage unavailable; the state above already cleared the flag */ }
        } else {
            setConsecutiveFailures((n) => n + 1)
            setIsPlanLimit(result.planLimit)
            if (result.planLimit) {
                try { localStorage.setItem(PLAN_LIMIT_KEY, 'true') } catch { /* storage unavailable: the banner still shows this session */ }
            }
            // Confirm a first failure soon, rather than waiting a full interval.
            if (!recheckRef.current) {
                recheckRef.current = setTimeout(() => {
                    recheckRef.current = null
                    void checkConnectionRef.current()
                }, RECHECK_AFTER_FAILURE_MS)
            }
        }

        setInitialCheckDone(true)
    }, [convexUrl, isOnline])

    const checkConnectionRef = useRef(checkConnection)
    useEffect(() => {
        checkConnectionRef.current = checkConnection
    }, [checkConnection])

    useEffect(() => {
        if (isBrowserOffline) {
            setInitialCheckDone(true)
            return
        }
        void checkConnection()
        const interval = setInterval(() => void checkConnection(), CONNECTION_CHECK_INTERVAL)
        return () => {
            clearInterval(interval)
            if (recheckRef.current) {
                clearTimeout(recheckRef.current)
                recheckRef.current = null
            }
        }
    }, [isBrowserOffline, checkConnection])

    // Before we have ever reached Convex, one failure is enough (a cold start
    // with no network should go straight to the offline tree). After that, it
    // takes consecutive failures with the websocket also down.
    const failuresNeeded = everHealthy || socket.everConnected ? FAILURES_BEFORE_OFFLINE : 1
    const unreachable = !socket.connected && consecutiveFailures >= failuresNeeded
    const isOffline = isPlanLimit || isBrowserOffline || (initialCheckDone && unreachable)
    const isConvexConnected = !isOffline

    // Record transitions, not every probe: setting this on each 30s check
    // re-rendered every consumer of this context every 30s.
    const wasOfflineRef = useRef<boolean | null>(null)
    useEffect(() => {
        if (!initialCheckDone) return
        const previous = wasOfflineRef.current
        wasOfflineRef.current = isOffline
        if (!isOffline && previous !== false) setLastConnectedAt(new Date())
        if (previous === null) return
        if (isOffline && !previous) {
            trackEvent(AnalyticsEventType.OFFLINE_MODE_ENTERED, { plan_limit: isPlanLimit })
        } else if (!isOffline && previous) {
            trackEvent(AnalyticsEventType.SESSION_START, { reason: 'reconnected' })
        }
    }, [isOffline, initialCheckDone, isPlanLimit, trackEvent])

    // Retry re-probes in place. It used to reset the initial check, which
    // replaced the entire app with a "Checking connection..." screen.
    const retryConnection = useCallback(() => {
        void checkConnection()
    }, [checkConnection])

    const connectionState: ConvexConnectionState['connectionState'] = isOffline
        ? (checking ? 'reconnecting' : 'disconnected')
        : (socket.connected ? 'connected' : 'connecting')

    const value = useMemo<ConvexConnectionContextType>(() => ({
        isConvexConnected,
        isOffline,
        isReconnecting: connectionState === 'reconnecting',
        isPlanLimit,
        lastConnectedAt,
        connectionState,
        isOnline,
        retryConnection,
    }), [isConvexConnected, isOffline, connectionState, isPlanLimit, lastConnectedAt, isOnline, retryConnection])

    // Only the very first check holds the app back; later ones never do.
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

    return (
        <ConvexConnectionContext.Provider value={value}>
            <ConvexProviderWithClerk client={isOffline ? nullClient : realClient} useAuth={useAuth}>
                {children}
            </ConvexProviderWithClerk>
        </ConvexConnectionContext.Provider>
    )
}
