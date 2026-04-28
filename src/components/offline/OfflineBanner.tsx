import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { WifiOff, RefreshCw, CloudOff } from 'lucide-react'

export function OfflineBanner() {
    const { isOffline, connectionState, isPlanLimit, retryConnection } = useConvexConnection()

    if (!isOffline) return null

    return (
        <div className="fixed top-0 left-0 right-0 z-50 bg-gray-800/90 dark:bg-gray-900/90 backdrop-blur-sm text-gray-200 px-4 py-1 flex items-center justify-between shadow-sm text-xs">
            <div className="flex items-center gap-2">
                {isPlanLimit ? (
                    <>
                        <CloudOff className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                        <span>Offline — server unavailable</span>
                    </>
                ) : (
                    <>
                        <WifiOff className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                        <span>
                            {connectionState === 'reconnecting'
                                ? 'Reconnecting...'
                                : 'Offline'}
                        </span>
                    </>
                )}
            </div>
            <button
                onClick={retryConnection}
                className="flex items-center gap-1 px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
            >
                <RefreshCw className="w-3 h-3" />
                Retry
            </button>
        </div>
    )
}