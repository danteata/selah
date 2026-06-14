import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { analytics, AnalyticsService } from '../services/analytics/service'
import type { AnalyticsProviderType, AnalyticsProviderConfig } from '../services/analytics/types'
import { isDesktop } from '../platform'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AnalyticsContextValue {
    analytics: AnalyticsService
}

const AnalyticsContext = createContext<AnalyticsContextValue>({ analytics })

export function useAnalyticsContext(): AnalyticsContextValue {
    return useContext(AnalyticsContext)
}

// ---------------------------------------------------------------------------
// Provider component
// ---------------------------------------------------------------------------

interface Props {
    providerType: AnalyticsProviderType
    apiKey: string
    children: ReactNode
    /** Extra options forwarded to the underlying SDK. */
    options?: Record<string, unknown>
    /** Application version (typically from package.json or Tauri). */
    appVersion?: string
}

/**
 * Wraps the app in an analytics context.
 * Initialise the analytics singleton on mount, tear down on unmount.
 *
 * Usage:
 * ```tsx
 * <AnalyticsProvider providerType="posthog" apiKey={import.meta.env.VITE_POSTHOG_KEY}>
 *   <App />
 * </AnalyticsProvider>
 * ```
 */
export function AnalyticsProvider({
    providerType,
    apiKey,
    children,
    options,
    appVersion,
}: Props) {
    const initialised = useRef(false)

    useEffect(() => {
        if (initialised.current) return
        initialised.current = true

        const config: AnalyticsProviderConfig = {
            apiKey,
            enabled: true,
            environment: import.meta.env.DEV ? 'development' : 'production',
            appVersion: appVersion ?? '0.1.0',
            isDesktop: isDesktop(),
            options,
        }

        // analytics.initialize may be async (e.g. Amplitude) — fire and let
        // the singleton buffer events until the provider is ready.
        void analytics.initialize(providerType, config)
    }, [providerType, apiKey, options, appVersion])

    // Flush on page unload so buffered events aren't lost
    useEffect(() => {
        function handleBeforeUnload() {
            analytics.flush()
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [])

    return (
        <AnalyticsContext.Provider value={{ analytics }}>
            {children}
        </AnalyticsContext.Provider>
    )
}