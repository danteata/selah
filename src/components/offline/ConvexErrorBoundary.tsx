import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
    children: ReactNode
}

interface State {
    errorCount: number
}

export class ConvexErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { errorCount: 0 }
    }

    static getDerivedStateFromError(error: Error): State | null {
        const msg = error.message || ''
        const isConvexError =
            msg.includes('exceeded the free plan') ||
            msg.includes('deployments have been disabled') ||
            (msg.includes('CONVEX') && msg.includes('Server Error'))

        if (isConvexError) {
            return { errorCount: Date.now() }
        }
        return null
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.warn('[ConvexErrorBoundary] Convex error caught and suppressed:', error.message?.substring(0, 80))
    }

    render() {
        return this.props.children
    }
}