import { useEffect, type ReactNode } from 'react'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { reportConvexOutage } from '../../utils/convexOutage'

/**
 * Shown by an error boundary in place of a screen that threw a Convex outage
 * (see convexOutage.ts). It puts the app in offline mode and, once the
 * offline client is in place, has the boundary render the screen again,
 * which now reads local data instead of throwing.
 */
export function ConvexOutageRecovery({ onRecovered, children }: {
    onRecovered: () => void
    children?: ReactNode
}) {
    const { isOffline } = useConvexConnection()

    useEffect(() => {
        reportConvexOutage()
    }, [])

    useEffect(() => {
        if (isOffline) onRecovered()
    }, [isOffline, onRecovered])

    return <>{children}</>
}
