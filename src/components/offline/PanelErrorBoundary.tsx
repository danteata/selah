import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { analytics, AnalyticsEventType } from '../../services/analytics'
import { isConvexOutage } from '../../utils/convexOutage'
import { ConvexOutageRecovery } from './ConvexOutageRecovery'

interface Props {
    children: ReactNode
    /** Which panel this guards. Shown to the operator and sent to analytics. */
    name: string
    /**
     * Render nothing instead of a notice. For a panel on the projector output,
     * where a fallback card would be a card the congregation reads.
     */
    silent?: boolean
}

interface State {
    failed: boolean
    outage: boolean
}

/** See RouteErrorBoundary's OUTAGE_RECOVERIES. */
const OUTAGE_RECOVERIES = 2

/**
 * Contains a failure to one panel instead of one route.
 *
 * `RouteErrorBoundary` already stops a throw from whiting out the app, but it
 * catches at route granularity: a bug in the sermon-listener panel takes the
 * entire Dashboard — or, worse, the whole `/live` output the congregation is
 * looking at — down with it, and the only offered recovery is a reload. A
 * panel is not worth a route.
 *
 * The fallback deliberately offers no retry. Re-mounting the subtree that just
 * threw usually throws again, and a button that appears to do nothing is worse
 * during a service than an honest note that one panel is unavailable. The
 * route-level reload is still there for anyone who wants it.
 *
 * The exception is a Convex outage (plan limit, disabled deployment): that
 * goes away once the app is offline, so the panel is put back then
 * (ConvexOutageRecovery).
 */
export class PanelErrorBoundary extends Component<Props, State> {
    state: State = { failed: false, outage: false }
    private outageRecoveries = 0

    static getDerivedStateFromError(error: Error): State {
        return { failed: true, outage: isConvexOutage(error) }
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        if (isConvexOutage(error) && this.outageRecoveries < OUTAGE_RECOVERIES) {
            console.warn(`[PanelErrorBoundary] ${this.props.name}: Convex is unavailable; carrying on offline`)
            return
        }
        console.error(`[PanelErrorBoundary] ${this.props.name}`, error, info.componentStack)
        analytics.trackEvent(AnalyticsEventType.ERROR_OCCURRED, {
            error_category: 'panel_error',
            route_name: `panel:${this.props.name}`,
            error_message: error.message?.slice(0, 120) ?? 'unknown',
            component_stack: info.componentStack?.slice(0, 200) ?? '',
        })
    }

    private handleOutageRecovered = () => {
        this.outageRecoveries++
        this.setState({ failed: false, outage: false })
    }

    render(): ReactNode {
        if (!this.state.failed) return this.props.children
        if (this.state.outage && this.outageRecoveries < OUTAGE_RECOVERIES) {
            return <ConvexOutageRecovery onRecovered={this.handleOutageRecovered} />
        }
        if (this.props.silent) return null

        return (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                    <div className="font-medium">This panel stopped responding</div>
                    <div className="text-xs opacity-80">
                        The rest of Selah is still working. Reload when you get a moment.
                    </div>
                </div>
            </div>
        )
    }
}
