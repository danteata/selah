import { useCallback } from 'react'
import { useAnalyticsContext } from '../providers/AnalyticsProvider'
import { AnalyticsEventType } from '../services/analytics/types'

/**
 * React hook that exposes a thin, type-safe wrapper around the analytics
 * singleton. Use this in components instead of importing `analytics` directly
 * so that the React context is wired up properly.
 *
 * @example
 * ```tsx
 * const { trackEvent, trackPage } = useAnalytics()
 *
 * trackEvent(AnalyticsEventType.SLIDE_CREATED, { slideType: 'bible' })
 * trackPage('Dashboard')
 * ```
 */
export function useAnalytics() {
    const { analytics } = useAnalyticsContext()

    const trackEvent = useCallback(
        (name: string, properties?: Record<string, unknown>) => {
            analytics.trackEvent(name, properties)
        },
        [analytics],
    )

    const trackPage = useCallback(
        (name: string, properties?: Record<string, unknown>) => {
            analytics.page(name, properties)
        },
        [analytics],
    )

    const identify = useCallback(
        (userId: string, properties?: Record<string, unknown>) => {
            analytics.identify(userId, properties)
        },
        [analytics],
    )

    const setUserProperties = useCallback(
        (properties: Record<string, unknown>) => {
            analytics.setUserProperties(properties)
        },
        [analytics],
    )

    const reset = useCallback(() => {
        analytics.reset()
    }, [analytics])

    return {
        /** Raw singleton — use when you need full control. */
        analytics,
        /** Track a named event with optional properties. */
        trackEvent,
        /** Track a page/screen view. */
        trackPage,
        /** Associate events with a user. */
        identify,
        /** Set user-level properties. */
        setUserProperties,
        /** Reset the current user (on logout). */
        reset,
        /** The enum of pre-defined event names. */
        AnalyticsEventType,
    }
}