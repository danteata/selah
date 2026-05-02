import { useState, useCallback } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Radio, StopCircle, Users, Crown, Eye, Shield, Loader2, SwitchCamera } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useUserRole } from '../../hooks/useUserRole'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { useAppStore } from '../../store/appStore'

type SessionRole = 'operator' | 'contributor' | 'viewer'

interface LiveSessionControlsProps {
    churchId: string
}

interface SessionUser {
    userId: string
    user: {
        _id: string
        fullname: string
        email: string
        avatar: string
        role: string
    } | null
}

export function LiveSessionControls({ churchId }: LiveSessionControlsProps) {
    const { isOffline } = useConvexConnection()
    const { currentUser } = useUserRole()
    const activeSchedule = useAppStore((s) => s.activeSchedule)

    const [isStarting, setIsStarting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showTransferMenu, setShowTransferMenu] = useState(false)

    const activeSession = useQuery(
        api.liveSessions.getActiveSession,
        activeSchedule?._id && !isOffline
            ? { scheduleId: activeSchedule._id as string }
            : 'skip'
    )

    const sessionUsers = useQuery(
        api.presence.getPresenceBySession,
        activeSession?._id && !isOffline
            ? { sessionId: activeSession._id as Id<"liveSessions"> }
            : 'skip'
    )

    const startSession = useMutation(api.liveSessions.startSession)
    const endSession = useMutation(api.liveSessions.endSession)
    const joinSession = useMutation(api.liveSessions.joinSession)
    const leaveSession = useMutation(api.liveSessions.leaveSession)
    const transferOperator = useMutation(api.liveSessions.transferOperator)

    const handleGoLive = async () => {
        if (!activeSchedule?._id || !churchId || isOffline) return

        setIsStarting(true)
        setError(null)
        try {
            await startSession({
                scheduleId: activeSchedule._id as string,
                churchId,
            })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to start session')
        } finally {
            setIsStarting(false)
        }
    }

    const handleJoin = async (role: SessionRole = 'contributor') => {
        if (!activeSession?._id || isOffline) return

        try {
            await joinSession({ sessionId: activeSession._id as Id<"liveSessions">, role })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to join session')
        }
    }

    const handleEndSession = async () => {
        if (!activeSession?._id || isOffline) return

        try {
            await endSession({ sessionId: activeSession._id as Id<"liveSessions"> })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to end session')
        }
    }

    const handleLeave = async () => {
        if (!activeSession?._id || isOffline) return

        try {
            await leaveSession({ sessionId: activeSession._id as Id<"liveSessions"> })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to leave session')
        }
    }

    const handleTransfer = useCallback(async (newOperatorId: string) => {
        if (!activeSession?._id || isOffline) return

        try {
            await transferOperator({
                sessionId: activeSession._id as Id<"liveSessions">,
                newOperatorId,
            })
            setShowTransferMenu(false)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to transfer control')
        }
    }, [activeSession?._id, isOffline, transferOperator])

    const isOperator = activeSession?.operatorId === currentUser?._id
    const isActive = activeSession?.status === 'active'

    if (isOffline) {
        return (
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)]">
                <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                <span className="text-[10px] text-[var(--text-muted)]">Offline</span>
            </div>
        )
    }

    if (isActive && activeSession) {
        return (
            <div className="flex items-center gap-2 relative">
                <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        LIVE
                    </span>
                    {sessionUsers && sessionUsers.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] text-emerald-600/70 dark:text-emerald-400/70">
                            <Users className="w-3 h-3" />
                            {sessionUsers.length}
                        </div>
                    )}
                </div>

                {isOperator ? (
                    <div className="flex items-center gap-1 relative">
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                            <Crown className="w-3 h-3 text-amber-500" />
                            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Operator</span>
                        </div>

                        {/* Transfer operator button */}
                        <div className="relative">
                            <button
                                onClick={() => setShowTransferMenu(!showTransferMenu)}
                                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                                title="Transfer operator control"
                            >
                                <SwitchCamera className="w-3.5 h-3.5" />
                            </button>
                            {showTransferMenu && (
                                <div className="absolute top-full right-0 mt-1 w-48 rounded-lg bg-[var(--bg-elevated)] shadow-xl border border-[var(--border-default)] overflow-hidden z-50">
                                    <div className="px-2.5 py-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-subtle)]">
                                        Transfer to
                                    </div>
                                    {sessionUsers?.filter((u: SessionUser) => u.userId !== currentUser?._id).map((entry: SessionUser) => (
                                        <button
                                            key={entry.userId}
                                            onClick={() => handleTransfer(entry.userId)}
                                            className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                                        >
                                            <div className="w-5 h-5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-default)] flex items-center justify-center text-[9px] font-semibold text-[var(--text-secondary)]">
                                                {entry.user?.fullname?.charAt(0)?.toUpperCase() || '?'}
                                            </div>
                                            <span className="truncate">{entry.user?.fullname || 'Unknown'}</span>
                                        </button>
                                    ))}
                                    {(!sessionUsers || sessionUsers.filter((u: SessionUser) => u.userId !== currentUser?._id).length === 0) && (
                                        <div className="px-2.5 py-2 text-[11px] text-[var(--text-muted)] text-center">
                                            No other participants
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleEndSession}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
                            title="End live session"
                        >
                            <StopCircle className="w-3.5 h-3.5" />
                            End
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => handleJoin('contributor')}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                        >
                            <Shield className="w-3 h-3" />
                            Join
                        </button>
                        <button
                            onClick={() => handleJoin('viewer')}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <Eye className="w-3 h-3" />
                            Watch
                        </button>
                        <button
                            onClick={handleLeave}
                            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                            title="Leave session"
                        >
                            <StopCircle className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {error && (
                    <span className="text-[10px] text-rose-500">{error}</span>
                )}
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={handleGoLive}
                disabled={isStarting || !activeSchedule?._id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] border border-[var(--accent-teal)]/20 hover:bg-[var(--accent-teal)]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!activeSchedule?._id ? 'Select a schedule first' : 'Start live session'}
            >
                {isStarting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Radio className="w-3.5 h-3.5" />
                )}
                Go Live
            </button>
            {error && (
                <span className="text-[10px] text-rose-500">{error}</span>
            )}
        </div>
    )
}