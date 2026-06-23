import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { analytics, AnalyticsEventType } from '../../services/analytics'

interface Props {
    children: ReactNode
    /** Optional label used in the fallback UI; defaults to "Selah". */
    name?: string
}

interface State {
    error: Error | null
}

/**
 * Generic top-level error boundary used to wrap every route. Catches runtime
 * exceptions that would otherwise leave the user staring at a white screen.
 *
 * The fallback offers a single, predictable action — reload — which is the
 * correct answer for the operator standing in front of a congregation. It
 * deliberately does not try to render a clever diagnostic; that belongs in
 * dev tools and a future Sentry integration.
 */
export class RouteErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Always surface in console.error so it is visible in production logs
        // (esbuild's `pure` list only drops console.log/debug/info).
        console.error('[RouteErrorBoundary]', this.props.name ?? 'app', error, info.componentStack)

        // Track error in analytics — sanitize to avoid leaking PII
        const errorCategory = this.categorizeError(error.message)
        analytics.trackEvent(AnalyticsEventType.ERROR_OCCURRED, {
            error_category: errorCategory,
            route_name: this.props.name ?? 'app',
            error_message: error.message?.slice(0, 120) ?? 'unknown',
            component_stack: info.componentStack?.slice(0, 200) ?? '',
        })
    }

    private categorizeError(message: string): string {
        const m = message.toLowerCase()
        if (m.includes('convex') || m.includes('exceeded the free plan') || m.includes('deployments have been disabled')) {
            return 'convex_error'
        }
        if (m.includes('network') || m.includes('fetch') || m.includes('connection')) {
            return 'network_error'
        }
        if (m.includes('undefined') || m.includes('null') || m.includes('cannot read') || m.includes('is not a')) {
            return 'type_error'
        }
        if (m.includes('out of memory') || m.includes('heap') || m.includes('allocation')) {
            return 'memory_error'
        }
        return 'runtime_error'
    }

    private handleReload = () => {
        window.location.reload()
    }

    render() {
        if (!this.state.error) return this.props.children

        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6">
                <div className="max-w-md w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg p-6 text-center">
                    <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
                        <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        Something went wrong
                    </h1>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Selah hit an unexpected error and stopped rendering this screen.
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mb-5 font-mono break-all">
                        {this.state.error.message.slice(0, 240)}
                    </p>
                    <button
                        onClick={this.handleReload}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-teal)] text-white text-sm font-medium hover:brightness-110 transition-all shadow-sm"
                    >
                        <RotateCcw className="w-4 h-4" />
                        Reload Selah
                    </button>
                </div>
            </div>
        )
    }
}

export default RouteErrorBoundary
