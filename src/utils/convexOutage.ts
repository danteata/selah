/**
 * Convex refusing to run anything at all: the plan's limits were exceeded and
 * the deployment disabled, or the deployment paused. Unlike one function
 * failing, this is an outage, and Selah carries on offline through it.
 *
 * The health check spots it too, but only every 30s and only when its probe
 * gets through; a query that hits it first used to throw the raw Convex
 * message onto the operator's screen as a crash.
 */

const OUTAGE_SIGNS = [
    'exceeded the free plan',
    'deployments have been disabled',
    'deployment is paused',
]

/** Whether an error (or a response body) says the Convex deployment won't run functions. */
export function isConvexOutage(errorOrText: unknown): boolean {
    const text = typeof errorOrText === 'string'
        ? errorOrText
        : errorOrText instanceof Error ? errorOrText.message : ''
    return OUTAGE_SIGNS.some((sign) => text.includes(sign))
}

export const CONVEX_OUTAGE_EVENT = 'selah:convex-outage'

/** Tell ConvexConnectionProvider to go offline now rather than at its next check. */
export function reportConvexOutage(): void {
    window.dispatchEvent(new Event(CONVEX_OUTAGE_EVENT))
}
