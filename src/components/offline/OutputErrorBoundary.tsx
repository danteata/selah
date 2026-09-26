import { Component, type ErrorInfo, type ReactNode } from 'react'
import { analytics, AnalyticsEventType } from '../../services/analytics'

interface Props {
    children: ReactNode
    /** A change (e.g. the next slide going live) clears the error and re-renders. */
    resetKey?: unknown
}

interface State {
    error: Error | null
}

// Nobody can click "Reload" on a projector, so try again on our own.
const RETRY_MS = 3000

/**
 * Error boundary for what the congregation sees.
 *
 * The app-wide boundary shows a light "Something went wrong" card with the raw
 * error and a reload button: right for an operator, wrong on a fullscreen
 * output with no keyboard or mouse attached, where it stayed until someone
 * walked over. This falls back to plain black — indistinguishable from a
 * cleared screen — and recovers as soon as the next slide arrives, or after a
 * short pause if none does.
 */
export class OutputErrorBoundary extends Component<Props, State> {
    private retryTimer: ReturnType<typeof setTimeout> | null = null

    constructor(props: Props) {
        super(props)
        this.state = { error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[OutputErrorBoundary]', error, info.componentStack)
        analytics.trackEvent(AnalyticsEventType.ERROR_OCCURRED, {
            error_category: 'output_render_error',
            route_name: 'live-output',
            error_message: error.message?.slice(0, 120) ?? 'unknown',
            component_stack: info.componentStack?.slice(0, 200) ?? '',
        })
        this.scheduleRetry()
    }

    componentDidUpdate(prevProps: Props) {
        if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
            this.clear()
        }
    }

    componentWillUnmount() {
        if (this.retryTimer) clearTimeout(this.retryTimer)
    }

    private scheduleRetry() {
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.retryTimer = setTimeout(() => this.clear(), RETRY_MS)
    }

    private clear() {
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.retryTimer = null
        this.setState({ error: null })
    }

    render() {
        if (this.state.error) return <div className="h-screen w-screen bg-black" />
        return this.props.children
    }
}

export default OutputErrorBoundary
