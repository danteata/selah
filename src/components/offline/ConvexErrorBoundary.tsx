import { Component, type ReactNode, type ErrorInfo } from 'react'
import { isConvexOutage } from '../../utils/convexOutage'
import { ConvexOutageRecovery } from './ConvexOutageRecovery'

interface Props {
    children: ReactNode
}

interface State {
    error: Error | null
}

/** See RouteErrorBoundary's OUTAGE_RECOVERIES. */
const OUTAGE_RECOVERIES = 2

/**
 * Catches a Convex outage (plan limit, disabled deployment) thrown by
 * anything outside a route's own boundary, and puts the app back on the
 * offline client. Any other error goes on to the boundary above.
 *
 * It used to render its children again straight away, against the same
 * failing client, so the error simply went on up to the crash screen.
 */
export class ConvexErrorBoundary extends Component<Props, State> {
    state: State = { error: null }
    private outageRecoveries = 0

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
        if (isConvexOutage(error)) {
            console.warn('[ConvexErrorBoundary] Convex is unavailable; carrying on offline:', error.message.slice(0, 120))
        }
    }

    private handleOutageRecovered = () => {
        this.outageRecoveries++
        this.setState({ error: null })
    }

    render() {
        const { error } = this.state
        if (!error) return this.props.children
        if (isConvexOutage(error) && this.outageRecoveries < OUTAGE_RECOVERIES) {
            return <ConvexOutageRecovery onRecovered={this.handleOutageRecovered} />
        }
        // Not ours: rethrown to the boundary above.
        throw error
    }
}
