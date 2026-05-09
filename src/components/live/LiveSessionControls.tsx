import { useState, useCallback, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Radio, StopCircle, Users, Crown, Eye, Shield, Loader2, SwitchCamera, ArrowRight, Lock, Unlock, MessageSquare } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useUserRole } from '../../hooks/useUserRole'
import { useSchedules } from '../../hooks/useSchedules'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'

type SessionRole = 'operator' | 'contributor' | 'viewer'
type CollaborationMode = 'strict' | 'open' | 'moderated'

const MODE_INFO: Record<CollaborationMode, { label: string; description: string; icon: typeof Lock }> = {
    strict: { label: 'Strict', description: 'Only operator controls slides', icon: Lock },
    moderated: { label: 'Review', description: 'Suggestions need operator approval', icon: MessageSquare },
    open: { label: 'Open', description: 'Team can advance slides directly', icon: Unlock },
}

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
    const { activeSchedule, schedules, setActiveSchedule } = useSchedules()

    const [isStarting, setIsStarting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showTransferMenu, setShowTransferMenu] = useState(false)
    const [collabMode, setCollabMode] = useState<CollaborationMode>('moderated')

    const activeSession = useQuery(
        api.liveSessions.getActiveSession,
        activeSchedule?._id && !isOffline
            ? { scheduleId: activeSchedule._id as string }
            : 'skip'
    )

    const churchSessions = useQuery(
        api.liveSessions.getActiveSessionByChurch,
        churchId && !isOffline
            ? { churchId }
            : 'skip'
    )

    const discoveredSession = useMemo(() => {
        if (!churchSessions || churchSessions.length === 0) return null
        if (activeSession?._id) return null
        return churchSessions[0]
    }, [churchSessions, activeSession?._id])

    const effectiveSession = activeSession || discoveredSession

    const sessionUsers = useQuery(
        api.presence.getPresenceBySession,
        effectiveSession?._id && !isOffline
            ? { sessionId: effectiveSession._id as Id<"liveSessions"> }
            : 'skip'
    )

    const startSession = useMutation(api.liveSessions.startSession)
    const endSession = useMutation(api.liveSessions.endSession)
    const joinSession = useMutation(api.liveSessions.joinSession)
    const leaveSession = useMutation(api.liveSessions.leaveSession)
    const transferOperator = useMutation(api.liveSessions.transferOperator)

    const handleStartSession = async () => {
        if (!activeSchedule?._id || !churchId || isOffline) return

        setIsStarting(true)
        setError(null)
        try {
            await startSession({
                scheduleId: activeSchedule._id as string,
                churchId,
                collaborationMode: collabMode,
            })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to start session')
        } finally {
            setIsStarting(false)
        }
    }

    const handleJoin = async (role: 'contributor' | 'viewer') => {
        if (!effectiveSession?._id || isOffline) return

        if (discoveredSession) {
            const matchingSchedule = schedules.find(
                (s) => s?._id === discoveredSession.scheduleId
            )
            if (matchingSchedule && matchingSchedule._id !== activeSchedule?._id) {
                setActiveSchedule(matchingSchedule)
            }
        }

        try {
            await joinSession({ sessionId: effectiveSession._id as Id<"liveSessions">, role })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to join session')
        }
    }

    const handleEndSession = async () => {
        if (!effectiveSession?._id || isOffline) return

        try {
            await endSession({ sessionId: effectiveSession._id as Id<"liveSessions"> })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to end session')
        }
    }

    const handleLeave = async () => {
        if (!effectiveSession?._id || isOffline) return

        try {
            await leaveSession({ sessionId: effectiveSession._id as Id<"liveSessions"> })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to leave session')
        }
    }

    const handleTransfer = useCallback(async (newOperatorId: string) => {
        if (!effectiveSession?._id || isOffline) return

        try {
            await transferOperator({
                sessionId: effectiveSession._id as Id<"liveSessions">,
                newOperatorId: newOperatorId as Id<"users">,
            })
            setShowTransferMenu(false)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to transfer control')
        }
    }, [effectiveSession?._id, isOffline, transferOperator])

    const isOperator = effectiveSession?.operatorId === currentUser?._id
    const isActive = effectiveSession?.status === 'active'
    const isInSession = sessionUsers?.some((u: SessionUser) => u.userId === currentUser?._id)

    if (isOffline) {
        return (
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)]">
                <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                <span className="text-[10px] text-[var(--text-muted)]">Offline</span>
            </div>
        )
    }

    if (isActive && effectiveSession) {
        const isDifferentSchedule = discoveredSession && discoveredSession.scheduleId !== activeSchedule?._id

        return (
            <div className="flex items-center gap-2 relative">
                <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        SESSION
                    </span>
                    {sessionUsers && sessionUsers.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] text-emerald-600/70 dark:text-emerald-400/70">
                            <Users className="w-3 h-3" />
                            {sessionUsers.length}
                        </div>
                    )}
                    {effectiveSession.collaborationMode && (
                        <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-600/70 dark:text-emerald-400/70" title={MODE_INFO[effectiveSession.collaborationMode as CollaborationMode]?.description}>
                            {(() => { const ModeIcon = MODE_INFO[effectiveSession.collaborationMode as CollaborationMode]?.icon; return ModeIcon ? <ModeIcon className="w-2.5 h-2.5" /> : null })()}
                            {MODE_INFO[effectiveSession.collaborationMode as CollaborationMode]?.label}
                        </span>
                    )}
                </div>

                {isOperator ? (
                    <div className="flex items-center gap-1 relative">
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                            <Crown className="w-3 h-3 text-amber-500" />
                            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Operator</span>
                        </div>

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
                            title="End collaborative session"
                        >
                            <StopCircle className="w-3.5 h-3.5" />
                            End
                        </button>
                    </div>
                ) : isInSession ? (
                    <div className="flex items-center gap-1">
                        {sessionUsers?.find((u: SessionUser) => u.userId === currentUser?._id)?.sessionRole === 'contributor' ? (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                                <Shield className="w-3 h-3" />
                                Contributor
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[10px] font-medium text-[var(--text-secondary)]">
                                <Eye className="w-3 h-3" />
                                Viewer
                            </span>
                        )}
                        <button
                            onClick={handleLeave}
                            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                            title="Leave session"
                        >
                            <StopCircle className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-1">
                        {isDifferentSchedule && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400" title="Live session is on a different schedule — joining will switch your view">
                                <ArrowRight className="w-3 h-3" />
                            </span>
                        )}
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
            <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border-default)] overflow-hidden">
                {(Object.keys(MODE_INFO) as CollaborationMode[]).map((mode) => {
                    const info = MODE_INFO[mode]
                    const Icon = info.icon
                    return (
                        <button
                            key={mode}
                            onClick={() => setCollabMode(mode)}
                            className={`flex items-center gap-1 px-1.5 py-1 text-[10px] font-medium transition-colors ${
                                collabMode === mode
                                    ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                            }`}
                            title={info.description}
                        >
                            <Icon className="w-3 h-3" />
                            <span className="hidden sm:inline">{info.label}</span>
                        </button>
                    )
                })}
            </div>
            <button
                onClick={handleStartSession}
                disabled={isStarting || !activeSchedule?._id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] border border-[var(--accent-teal)]/20 hover:bg-[var(--accent-teal)]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!activeSchedule?._id ? 'Select a schedule first' : `Start ${MODE_INFO[collabMode].label.toLowerCase()} session`}
            >
                {isStarting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Users className="w-3.5 h-3.5" />
                )}
                Start Session
            </button>
            {error && (
                <span className="text-[10px] text-rose-500">{error}</span>
            )}
        </div>
    )
}