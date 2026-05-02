import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useUserRole } from '../../hooks/useUserRole'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { Crown, Eye, Shield } from 'lucide-react'

interface PresenceAvatarsProps {
    churchId: string
    liveSessionId?: Id<"liveSessions">
    maxVisible?: number
}

interface PresenceUser {
    userId: string
    sessionRole?: string
    user: {
        _id: string
        fullname: string
        email: string
        avatar: string
        role: string
    } | null
}

function getRoleIcon(role?: string) {
    switch (role) {
        case 'operator':
            return <Crown className="w-2.5 h-2.5 text-amber-500" />
        case 'contributor':
            return <Shield className="w-2.5 h-2.5 text-blue-500" />
        case 'viewer':
            return <Eye className="w-2.5 h-2.5 text-[var(--text-muted)]" />
        default:
            return null
    }
}

function getRoleLabel(role?: string) {
    switch (role) {
        case 'operator':
            return 'Operator'
        case 'contributor':
            return 'Contributor'
        case 'viewer':
            return 'Viewer'
        default:
            return 'Online'
    }
}

export function PresenceAvatars({ churchId, liveSessionId, maxVisible = 4 }: PresenceAvatarsProps) {
    const { isOffline } = useConvexConnection()
    const { currentUser } = useUserRole()

    const churchPresence = useQuery(
        api.presence.getPresenceByChurch,
        !isOffline && churchId ? { churchId } : 'skip'
    )

    const sessionPresence = useQuery(
        api.presence.getPresenceBySession,
        !isOffline && liveSessionId ? { sessionId: liveSessionId } : 'skip'
    )

    if (isOffline || !churchPresence?.length) {
        return null
    }

    const users = liveSessionId && sessionPresence ? sessionPresence : churchPresence
    const filteredUsers = (users as PresenceUser[]).filter((u) => u.user !== null)
    const visibleUsers = filteredUsers.slice(0, maxVisible)
    const remainingCount = Math.max(0, filteredUsers.length - maxVisible)

    return (
        <div className="flex items-center -space-x-1.5" title={`${filteredUsers.length} team member${filteredUsers.length !== 1 ? 's' : ''} online`}>
            {visibleUsers.map((entry: PresenceUser) => {
                const isSelf = entry.userId === currentUser?._id
                const roleIcon = getRoleIcon(entry.sessionRole)
                const roleLabel = getRoleLabel(entry.sessionRole)

                return (
                    <div
                        key={entry.userId}
                        className="relative group"
                        title={`${entry.user?.fullname || 'Unknown'}${isSelf ? ' (You)' : ''} — ${roleLabel}`}
                    >
                        <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold border-2 transition-colors ${
                                isSelf
                                    ? 'bg-[var(--accent-teal)]/20 border-[var(--accent-teal)]/40 text-[var(--accent-teal)]'
                                    : 'bg-[var(--bg-tertiary)] border-[var(--border-default)] text-[var(--text-secondary)]'
                            }`}
                        >
                            {entry.user?.fullname?.charAt(0)?.toUpperCase() || entry.user?.email?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        {roleIcon && (
                            <div className="absolute -bottom-0.5 -right-0.5">
                                {roleIcon}
                            </div>
                        )}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-[var(--bg-elevated)] shadow-lg border border-[var(--border-default)] text-[10px] text-[var(--text-primary)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                            {entry.user?.fullname || 'Unknown'}
                            {isSelf && ' (You)'}
                            <span className="text-[var(--text-muted)] ml-1">— {roleLabel}</span>
                        </div>
                    </div>
                )
            })}
            {remainingCount > 0 && (
                <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] border-2 border-[var(--border-default)] flex items-center justify-center text-[9px] font-medium text-[var(--text-muted)]">
                    +{remainingCount}
                </div>
            )}
        </div>
    )
}