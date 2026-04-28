import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { WifiOff, CloudOff, RefreshCw } from 'lucide-react'

export function OfflineIndicator() {
    const { isOffline, connectionState, isPlanLimit, retryConnection } = useConvexConnection()

    if (!isOffline) return null

    if (isPlanLimit) {
        return (
            <button
                onClick={retryConnection}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                title="Server unavailable — click to retry"
            >
                <CloudOff className="w-3 h-3" />
                <span className="hidden sm:inline">Offline</span>
            </button>
        )
    }

    return (
        <button
            onClick={retryConnection}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                connectionState === 'reconnecting'
                    ? 'text-amber-400 bg-amber-500/10 animate-pulse'
                    : 'text-[var(--text-muted)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)]'
            }`}
            title={connectionState === 'reconnecting' ? 'Reconnecting...' : 'Offline — click to retry'}
        >
            {connectionState === 'reconnecting' ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
                <WifiOff className="w-3 h-3" />
            )}
            <span className="hidden sm:inline">
                {connectionState === 'reconnecting' ? 'Reconnecting' : 'Offline'}
            </span>
        </button>
    )
}