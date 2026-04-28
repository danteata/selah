import { useState, useEffect } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useUserRole } from '../../hooks/useUserRole'
import { Building2, ChevronDown, Check } from 'lucide-react'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { cacheChurch, getCachedChurch, getAllCachedChurches } from '../../hooks/useIndexedDB'

export function ChurchContext() {
    const [isOpen, setIsOpen] = useState(false)
    const { isSuperadmin, isAdmin, currentUser, isOfflineMode } = useUserRole()
    const { isConvexConnected } = useConvexConnection()

    const currentChurch = useQuery(
        api.churches.getChurchById,
        currentUser?.churchId ? { id: currentUser.churchId } : 'skip'
    )

    const allChurches = useQuery(
        api.churches.listChurches,
        isSuperadmin ? {} : 'skip'
    )

    const [cachedCurrentChurch, setCachedCurrentChurch] = useState<any>(null)
    const [cachedAllChurches, setCachedAllChurches] = useState<any[]>([])

    useEffect(() => {
        if (currentChurch && currentUser?.churchId) {
            cacheChurch(currentChurch).catch(() => {})
            setCachedCurrentChurch(currentChurch)
        }
    }, [currentChurch, currentUser?.churchId])

    useEffect(() => {
        if (allChurches) {
            for (const church of allChurches) {
                cacheChurch(church).catch(() => {})
            }
            setCachedAllChurches(allChurches)
        }
    }, [allChurches])

    useEffect(() => {
        if (isOfflineMode && currentUser?.churchId) {
            getCachedChurch(currentUser.churchId).then((cached) => {
                if (cached) setCachedCurrentChurch(cached)
            }).catch(() => {})
            if (isSuperadmin) {
                getAllCachedChurches().then((cached) => {
                    setCachedAllChurches(cached)
                }).catch(() => {})
            }
        }
    }, [isOfflineMode, currentUser?.churchId, isSuperadmin])

    const effectiveCurrentChurch = currentChurch ?? cachedCurrentChurch
    const effectiveAllChurches = allChurches ?? cachedAllChurches

    const updateUserChurch = useMutation(api.users.updateUserChurch)

    const handleSwitchChurch = async (churchId: string) => {
        if (!currentUser?._id || !isSuperadmin) return

        try {
            await updateUserChurch({
                userId: currentUser._id as any,
                churchId,
            })
            window.location.reload()
        } catch (error) {
            console.error('Failed to switch church:', error)
        }
        setIsOpen(false)
    }

    if (!currentUser) return null

    return (
        <div className="relative">
            <button
                onClick={() => isSuperadmin && setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isSuperadmin
                    ? 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
                    : 'cursor-default'
                    }`}
                disabled={!isSuperadmin}
            >
                <Building2 className="w-4 h-4 text-gray-500" />
                <div className="text-left">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        {isSuperadmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Member'}
                    </div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1">
                        {effectiveCurrentChurch?.name || 'No Church'}
                        {isSuperadmin && (
                            <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        )}
                    </div>
                </div>
            </button>

            {isOpen && isSuperadmin && effectiveAllChurches && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                    <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Switch Church Context
                        </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                        {effectiveAllChurches.map((church: any) => (
                            <button
                                key={church._id || church.id}
                                onClick={() => handleSwitchChurch(church._id || church.serverId)}
                                className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg ${church._id === currentUser.churchId ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                                    }`}
                            >
                                <div>
                                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                                        {church.name}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {church.type} • {church.address}
                                    </div>
                                </div>
                                {(church._id || church.serverId) === currentUser.churchId && (
                                    <Check className="w-4 h-4 text-primary-600" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}