import { useState, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMutation, useQuery } from 'convex/react'
import { StopCircle, Users, Crown, Eye, Shield, Loader2, SwitchCamera, ArrowRight, Lock, Unlock, MessageSquare, X, LogOut, ChevronDown } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useUserRole } from '../../hooks/useUserRole'
import { useSchedules } from '../../hooks/useSchedules'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { selectDiscoveredSession } from '../../hooks/liveSessionUtils'
import { useAppStore } from '../../store/appStore'

type CollaborationMode = 'strict' | 'open' | 'moderated'

const MODE_INFO: Record<CollaborationMode, { label: string; description: string; icon: typeof Lock }> = {
    strict: { label: 'Strict', description: 'Only operator controls slides', icon: Lock },
    moderated: { label: 'Review', description: 'Suggestions need operator approval', icon: MessageSquare },
    open: { label: 'Open', description: 'Team can advance slides directly', icon: Unlock },
}

interface LiveSessionControlsProps {
    churchId: string
    /** For a phone: one chip that opens a sheet with the session's details
     *  and every action, instead of a row of badges and buttons that ran off
     *  the screen (taking End and Leave with it). */
    compact?: boolean
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
    sessionRole?: 'operator' | 'contributor' | 'viewer'
}

export function LiveSessionControls({ churchId, compact = false }: LiveSessionControlsProps) {
    const { isOffline } = useConvexConnection()
    const { currentUser } = useUserRole()
    const { activeSchedule, schedules, setActiveSchedule } = useSchedules()
    const defaultCollaborationMode = (useAppStore((s) => s.settings.defaultCollaborationMode) || 'moderated') as CollaborationMode

    const [isStarting, setIsStarting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showTransferMenu, setShowTransferMenu] = useState(false)
    const [showModeMenu, setShowModeMenu] = useState(false)

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
        return selectDiscoveredSession({
            activeSessionId: activeSession?._id || null,
            activeScheduleId: activeSchedule?._id || null,
            sessionsByChurch: churchSessions || null,
        })
    }, [churchSessions, activeSession?._id, activeSchedule?._id])

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
    const updateCollaborationMode = useMutation(api.liveSessions.updateCollaborationMode)

    const handleStartSession = async () => {
        if (!activeSchedule?._id || !churchId || isOffline) return

        setIsStarting(true)
        setError(null)
        try {
            await startSession({
                scheduleId: activeSchedule._id as string,
                churchId,
                collaborationMode: defaultCollaborationMode,
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

    // The mode was fixed when the session started (from Settings), with no
    // way to let the team drive, or take it back, mid-service.
    const handleModeChange = useCallback(async (mode: CollaborationMode) => {
        setShowModeMenu(false)
        if (!effectiveSession?._id || isOffline || mode === effectiveSession.collaborationMode) return
        try {
            await updateCollaborationMode({ sessionId: effectiveSession._id as Id<"liveSessions">, collaborationMode: mode })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to change the session mode')
        }
    }, [effectiveSession?._id, effectiveSession?.collaborationMode, isOffline, updateCollaborationMode])

    const isOperator = effectiveSession?.operatorId === currentUser?._id
    const isActive = effectiveSession?.status === 'active'
    const isInSession = sessionUsers?.some((u: SessionUser) => u.userId === currentUser?._id)

    if (compact) {
        const mode = effectiveSession?.collaborationMode as CollaborationMode | undefined
        const ownRole = isOperator
            ? 'operator'
            : (sessionUsers as SessionUser[] | undefined)?.find((u) => u.userId === currentUser?._id)?.sessionRole ?? null
        return (
            <CompactSession
                isOffline={isOffline}
                isActive={!!(isActive && effectiveSession)}
                canStart={!!activeSchedule?._id}
                isStarting={isStarting}
                defaultMode={defaultCollaborationMode}
                mode={mode}
                ownRole={isInSession || isOperator ? ownRole : null}
                users={(sessionUsers as SessionUser[] | undefined) ?? []}
                currentUserId={currentUser?._id}
                error={error}
                onStart={handleStartSession}
                onJoin={handleJoin}
                onLeave={handleLeave}
                onEnd={handleEndSession}
                onTransfer={handleTransfer}
                onModeChange={isOperator ? handleModeChange : undefined}
            />
        )
    }

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
                    {effectiveSession.collaborationMode && (() => {
                        const current = effectiveSession.collaborationMode as CollaborationMode
                        const ModeIcon = MODE_INFO[current]?.icon
                        const chip = (
                            <>
                                {ModeIcon ? <ModeIcon className="w-2.5 h-2.5" /> : null}
                                {MODE_INFO[current]?.label}
                            </>
                        )
                        const chipClass = 'flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-600/70 dark:text-emerald-400/70'
                        if (!isOperator) {
                            return <span className={chipClass} title={MODE_INFO[current]?.description}>{chip}</span>
                        }
                        return (
                            <span className="relative">
                                <button
                                    type="button"
                                    onClick={() => setShowModeMenu((v) => !v)}
                                    aria-haspopup="menu"
                                    aria-expanded={showModeMenu}
                                    title={`${MODE_INFO[current]?.description} — change`}
                                    className={`${chipClass} hover:bg-emerald-500/20`}
                                >
                                    {chip}
                                    <ChevronDown className="w-2.5 h-2.5" />
                                </button>
                                {showModeMenu && (
                                    <div className="fixed inset-0 z-40" onClick={() => setShowModeMenu(false)} aria-hidden />
                                )}
                                {showModeMenu && (
                                    <div role="menu" className="absolute left-0 top-full mt-1 z-50 w-60 p-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-xl">
                                        {(Object.keys(MODE_INFO) as CollaborationMode[]).map((mode) => {
                                            const Icon = MODE_INFO[mode].icon
                                            return (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    role="menuitemradio"
                                                    aria-checked={mode === current}
                                                    onClick={() => void handleModeChange(mode)}
                                                    className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-[var(--bg-tertiary)] ${mode === current ? 'text-[var(--accent-teal)]' : 'text-[var(--text-primary)]'}`}
                                                >
                                                    <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                                    <span>
                                                        <span className="block text-xs font-semibold">{MODE_INFO[mode].label}</span>
                                                        <span className="block text-[11px] text-[var(--text-muted)]">{MODE_INFO[mode].description}</span>
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </span>
                        )
                    })()}
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
            <button
                onClick={handleStartSession}
                disabled={isStarting || !activeSchedule?._id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] border border-[var(--accent-teal)]/20 hover:bg-[var(--accent-teal)]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!activeSchedule?._id
                    ? 'Select a schedule first'
                    : `Start a ${MODE_INFO[defaultCollaborationMode].label.toLowerCase()} session`}
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

const ROLE_LABEL = { operator: 'Operator', contributor: 'Contributor', viewer: 'Viewer' } as const
const ROLE_ICON = { operator: Crown, contributor: Shield, viewer: Eye } as const

interface CompactSessionProps {
    isOffline: boolean
    isActive: boolean
    canStart: boolean
    isStarting: boolean
    defaultMode: CollaborationMode
    mode: CollaborationMode | undefined
    ownRole: 'operator' | 'contributor' | 'viewer' | null
    users: SessionUser[]
    currentUserId: string | undefined
    error: string | null
    onStart: () => void
    onJoin: (role: 'contributor' | 'viewer') => void
    onLeave: () => void
    onEnd: () => void
    onTransfer: (userId: string) => void
    /** The operator's: change who may drive the screen. */
    onModeChange?: (mode: CollaborationMode) => void
}

/** The session on a phone: a chip in the live strip, and a sheet with the rest. */
function CompactSession(props: CompactSessionProps) {
    const { isOffline, isActive, canStart, isStarting, defaultMode, mode, ownRole, users, currentUserId, error } = props
    const [open, setOpen] = useState(false)
    const [handingOver, setHandingOver] = useState(false)

    if (isOffline) {
        return (
            <span className="flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[11px] font-medium text-[var(--text-muted)] bg-[var(--bg-tertiary)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
                Offline
            </span>
        )
    }

    if (!isActive) {
        return (
            <button
                type="button"
                onClick={props.onStart}
                disabled={isStarting || !canStart}
                title={canStart ? `Start a ${MODE_INFO[defaultMode].label.toLowerCase()} session` : 'Select a schedule first'}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold text-[var(--accent-teal)] bg-[var(--accent-teal)]/10 active:scale-95 transition-transform disabled:opacity-50"
            >
                {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                Start session
            </button>
        )
    }

    const modeInfo = mode ? MODE_INFO[mode] : null
    const RoleIcon = ownRole ? ROLE_ICON[ownRole] : Users
    const others = users.filter((u) => u.userId !== currentUserId)
    const close = () => { setOpen(false); setHandingOver(false) }
    const act = (fn: () => void) => () => { fn(); close() }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`Live session${modeInfo ? `, ${modeInfo.label} mode` : ''}${ownRole ? `, you are ${ROLE_LABEL[ownRole]}` : ''}`}
                className="flex items-center gap-1.5 h-8 pl-2 pr-2.5 rounded-full text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 active:scale-95 transition-transform"
            >
                <RoleIcon className="w-3.5 h-3.5" />
                {/* On a phone on its side the words give way to what's live
                    beside them; the icon and the label above still say it. */}
                <span className={ownRole ? 'landscape:hidden' : undefined}>{ownRole ? ROLE_LABEL[ownRole] : 'Join'}</span>
                <span className="landscape:hidden text-emerald-700/50 dark:text-emerald-300/50" aria-hidden>·</span>
                <Users className="w-3 h-3 opacity-70" />
                <span className="tabular-nums">{users.length}</span>
            </button>

            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            className="fixed inset-0 bg-black/50 z-40"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={close}
                        />
                        <motion.div
                            role="dialog"
                            aria-label="Live session"
                            className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] flex flex-col bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl shadow-2xl"
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        >
                            <div className="flex items-start justify-between gap-3 pl-4 pr-1.5 pt-3 pb-3 border-b border-[var(--border-subtle)]">
                                <div className="min-w-0 pt-1">
                                    <h2 className="text-[17px] text-[var(--text-primary)]">Live session</h2>
                                    {modeInfo && (
                                        <p className="flex items-center gap-1.5 mt-0.5 text-xs text-[var(--text-secondary)]">
                                            <modeInfo.icon className="w-3.5 h-3.5 flex-shrink-0" />
                                            <span><span className="font-semibold">{modeInfo.label}</span> · {modeInfo.description}</span>
                                        </p>
                                    )}
                                    {props.onModeChange && mode && (
                                        <div className="flex gap-1 mt-2 p-1 rounded-xl bg-[var(--bg-tertiary)]" role="radiogroup" aria-label="Who can change slides">
                                            {(Object.keys(MODE_INFO) as CollaborationMode[]).map((m) => (
                                                <button
                                                    key={m}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={m === mode}
                                                    onClick={() => props.onModeChange?.(m)}
                                                    className={`flex-1 h-9 px-3 rounded-lg text-xs font-semibold transition-colors ${m === mode
                                                        ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                                                        : 'text-[var(--text-secondary)]'}`}
                                                >
                                                    {MODE_INFO[m].label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button onClick={close} aria-label="Close" className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full text-[var(--text-muted)] active:bg-[var(--bg-tertiary)]">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <ul className="flex-1 min-h-0 overflow-y-auto px-2 py-2" aria-label="People in the session">
                                {users.map((u) => {
                                    const role = u.sessionRole
                                    const Icon = role ? ROLE_ICON[role] : Users
                                    const isSelf = u.userId === currentUserId
                                    return (
                                        <li key={u.userId} className="flex items-center gap-3 px-2 py-2">
                                            <span className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)] bg-[var(--bg-tertiary)]">
                                                {u.user?.fullname?.charAt(0)?.toUpperCase() || '?'}
                                            </span>
                                            <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">
                                                {u.user?.fullname || 'Unknown'}{isSelf && <span className="text-[var(--text-muted)]"> (you)</span>}
                                            </span>
                                            {role && (
                                                <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                                                    <Icon className="w-3.5 h-3.5" />
                                                    {ROLE_LABEL[role]}
                                                </span>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>

                            {handingOver && (
                                <div className="px-4 pb-2">
                                    <p className="text-xs text-[var(--text-secondary)] mb-1.5">Hand control to</p>
                                    {others.length === 0 ? (
                                        <p className="text-sm text-[var(--text-muted)] py-2">No one else has joined yet.</p>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {others.map((u) => (
                                                <button
                                                    key={u.userId}
                                                    type="button"
                                                    onClick={act(() => props.onTransfer(u.userId))}
                                                    className="h-10 px-3.5 rounded-full text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-tertiary)] active:scale-95 transition-transform"
                                                >
                                                    {u.user?.fullname || 'Unknown'}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {error && <p className="px-4 pb-2 text-xs text-rose-500">{error}</p>}

                            <div className="grid grid-cols-2 gap-2 p-4 pt-2 border-t border-[var(--border-subtle)] pb-[max(1rem,env(safe-area-inset-bottom))]">
                                {ownRole === 'operator' ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => setHandingOver((v) => !v)}
                                            aria-pressed={handingOver}
                                            className="h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[var(--text-primary)] bg-[var(--bg-tertiary)] active:scale-[0.98] transition-transform"
                                        >
                                            <SwitchCamera className="w-4 h-4" />
                                            Hand over
                                        </button>
                                        <button
                                            type="button"
                                            onClick={act(props.onEnd)}
                                            className="h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white bg-rose-600 active:scale-[0.98] transition-transform"
                                        >
                                            <StopCircle className="w-4 h-4" />
                                            End session
                                        </button>
                                    </>
                                ) : ownRole ? (
                                    <button
                                        type="button"
                                        onClick={act(props.onLeave)}
                                        className="col-span-2 h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[var(--text-primary)] bg-[var(--bg-tertiary)] active:scale-[0.98] transition-transform"
                                    >
                                        <LogOut className="w-4 h-4" />
                                        Leave session
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={act(() => props.onJoin('contributor'))}
                                            className="h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white bg-[var(--accent-teal)] active:scale-[0.98] transition-transform"
                                        >
                                            <Shield className="w-4 h-4" />
                                            Join to help
                                        </button>
                                        <button
                                            type="button"
                                            onClick={act(() => props.onJoin('viewer'))}
                                            className="h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[var(--text-primary)] bg-[var(--bg-tertiary)] active:scale-[0.98] transition-transform"
                                        >
                                            <Eye className="w-4 h-4" />
                                            Just watch
                                        </button>
                                    </>
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    )
}
