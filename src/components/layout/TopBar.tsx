import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sun, Moon, ChevronDown, LogOut, User, Search, Calendar, X, Command, LayoutGrid, Rows3, Users, Plus, Check, Loader2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useUserRole } from '../../hooks/useUserRole'
import { useConvexConnection } from '../../providers/ConvexConnectionProvider'
import { useSchedules } from '../../hooks/useSchedules'
import { api } from '../../../convex/_generated/api'
import { LiveSessionControls } from '../live/LiveSessionControls'
import { PresenceAvatars } from '../live/PresenceAvatars'
import type { Schedule } from '../../types'

interface TopBarProps {
    isDark: boolean
    onToggleTheme: () => void
    activeSchedule?: Schedule | null
    user: {
        name: string
        onSignOut: () => void
    }
}

export function TopBar({ isDark, onToggleTheme, activeSchedule, user }: TopBarProps) {
    const { currentUser } = useUserRole()
    const { isOffline } = useConvexConnection()
    const churchId = currentUser?.churchId || ''
    const [showUserMenu, setShowUserMenu] = useState(false)
    const [showScheduleMenu, setShowScheduleMenu] = useState(false)
    const commandBarOpen = useAppStore((s) => s.commandBarOpen)
    const setCommandBarOpen = useAppStore((s) => s.setCommandBarOpen)
    const openModal = useAppStore((s) => s.openModal)
    const workspaceMode = useAppStore((s) => s.workspaceMode)
    const setWorkspaceMode = useAppStore((s) => s.setWorkspaceMode)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const scheduleMenuRef = useRef<HTMLDivElement>(null)

    const {
        schedules,
        activeSchedule: currentSchedule,
        setActiveSchedule,
        createSchedule,
        deleteSchedule,
        updateSchedule,
        isLoading: schedulesLoading,
    } = useSchedules()

    const scheduleViewers = useQuery(
        api.presence.getPresenceByChurch,
        churchId && !isOffline ? { churchId } : 'skip'
    )

    const onlineScheduleCount = useMemo(() => {
        if (!scheduleViewers || !currentSchedule) return 0
        return scheduleViewers.filter(
            (u: any) =>
                u.activeScheduleId === currentSchedule._id &&
                u.userId !== currentUser?._id
        ).length
    }, [scheduleViewers, currentSchedule, currentUser?._id])

    // Close user menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (showUserMenu && !target.closest('.user-menu')) {
                setShowUserMenu(false)
            }
            if (showScheduleMenu && scheduleMenuRef.current && !scheduleMenuRef.current.contains(target)) {
                setShowScheduleMenu(false)
            }
        }

        document.addEventListener('click', handleClickOutside)
        return () => document.removeEventListener('click', handleClickOutside)
    }, [showUserMenu, showScheduleMenu])

    // Focus search input when command bar opens
    useEffect(() => {
        if (commandBarOpen) {
            // Small delay to let animation start
            setTimeout(() => searchInputRef.current?.focus(), 100)
        }
    }, [commandBarOpen])

    // Listen for ⌘/ keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === '/') {
                e.preventDefault()
                setCommandBarOpen(!commandBarOpen)
            }
            if (e.key === 'Escape' && commandBarOpen) {
                setCommandBarOpen(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [commandBarOpen, setCommandBarOpen])

    return (
        <header className="studio-top-bar glass-panel border-b border-[var(--border-subtle)] flex items-center px-4 gap-3">
            {/* Logo */}
            <motion.div
                className="flex items-center gap-2 flex-shrink-0"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
            >
                <div className="relative">
                    <div className="absolute -left-0.5 -top-0.5 w-1.5 h-1.5 rounded-full bg-[var(--accent-teal)]" />
                    <h1
                        className="text-base font-semibold text-[var(--text-primary)] tracking-tight leading-none"
                        style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}
                    >
                        Selah
                    </h1>
                </div>
            </motion.div>

            {/* Schedule selector dropdown */}
            <div className="relative" ref={scheduleMenuRef}>
                <button
                    onClick={() => setShowScheduleMenu(!showScheduleMenu)}
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] hover:border-[var(--accent-teal)]/30 transition-colors text-xs"
                >
                    <Calendar className="w-3 h-3 text-[var(--accent-teal)]" />
                    <span className="text-[var(--text-secondary)] font-medium max-w-[120px] truncate">
                        {currentSchedule?.name || 'No Schedule'}
                    </span>
                    {onlineScheduleCount > 0 && (
                        <span className="flex items-center gap-0.5 px-1 py-0.5 bg-[var(--bg-secondary)] rounded text-[9px] text-[var(--text-muted)]"
                            title={`${onlineScheduleCount} other team member${onlineScheduleCount > 1 ? 's' : ''} viewing this schedule`}
                        >
                            <Users className="w-2.5 h-2.5" />
                            {onlineScheduleCount}
                        </span>
                    )}
                    <ChevronDown className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${showScheduleMenu ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                    {showScheduleMenu && (
                        <motion.div
                            initial={{ opacity: 0, y: -4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.98 }}
                            transition={{ duration: 0.12 }}
                            className="absolute top-full left-0 mt-1.5 w-64 rounded-xl bg-[var(--bg-elevated)] shadow-xl border border-[var(--border-default)] overflow-hidden z-50"
                        >
                            <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                                <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                                    Schedules
                                </span>
                            </div>

                            <div className="max-h-52 overflow-y-auto">
                                {schedulesLoading ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-[var(--text-muted)]">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Loading...
                                    </div>
                                ) : schedules.length === 0 ? (
                                    <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">
                                        No schedules yet
                                    </div>
                                ) : (
                                    schedules.map((schedule) => (
                                        <button
                                            key={schedule._id}
                                            onClick={() => {
                                                setActiveSchedule(schedule)
                                                setShowScheduleMenu(false)
                                            }}
                                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                                                currentSchedule?._id === schedule._id
                                                    ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                                    : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                                            }`}
                                        >
                                            <Calendar className={`w-3.5 h-3.5 flex-shrink-0 ${currentSchedule?._id === schedule._id ? 'text-[var(--accent-teal)]' : 'text-[var(--text-muted)]'}`} />
                                            <span className="truncate flex-1 text-left">{schedule.name}</span>
                                            {currentSchedule?._id === schedule._id && (
                                                <Check className="w-3 h-3 text-[var(--accent-teal)] flex-shrink-0" />
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>

                            <div className="border-t border-[var(--border-subtle)]">
                                <button
                                    onClick={() => {
                                        setShowScheduleMenu(false)
                                        openModal('scheduleModal')
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/5 transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    Create New Schedule
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Command Bar (center) */}
            <div className="flex-1 flex justify-center max-w-xl mx-auto">
                <button
                    onClick={() => setCommandBarOpen(true)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] hover:border-[var(--accent-teal)]/30 transition-all text-xs group"
                >
                    <Search className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--accent-teal)] transition-colors" />
                    <span className="text-[var(--text-muted)] flex-1 text-left">
                        Search bible, hymns, songs, actions...
                    </span>
                    <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] font-mono">
                        <Command className="w-2.5 h-2.5" />/
                    </kbd>
                </button>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Collaboration: Presence & Live Session */}
                {churchId && (
                    <>
                        <PresenceAvatars churchId={churchId} maxVisible={3} />
                        <LiveSessionControls churchId={churchId} />
                    </>
                )}

                {/* Workspace Mode Toggle */}
                <button
                    onClick={() => setWorkspaceMode(workspaceMode === 'studio' ? 'dashboard' : 'studio')}
                    className={`p-1.5 rounded-lg transition-all ${
                        workspaceMode === 'dashboard'
                            ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                    title={workspaceMode === 'studio' ? 'Switch to dashboard layout' : 'Switch to studio layout'}
                >
                    {workspaceMode === 'studio' ? <LayoutGrid className="w-4 h-4" /> : <Rows3 className="w-4 h-4" />}
                </button>

                {/* Theme Toggle */}
                <motion.button
                    onClick={onToggleTheme}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-all"
                    title={isDark ? 'Light mode' : 'Dark mode'}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                >
                    <AnimatePresence mode="wait">
                        {isDark ? (
                            <motion.div
                                key="sun"
                                initial={{ y: -12, opacity: 0, rotate: -90 }}
                                animate={{ y: 0, opacity: 1, rotate: 0 }}
                                exit={{ y: 12, opacity: 0, rotate: 90 }}
                                transition={{ duration: 0.15 }}
                            >
                                <Sun className="w-4 h-4 text-[var(--accent-amber)]" />
                            </motion.div>
                        ) : (
                            <motion.div
                                key="moon"
                                initial={{ y: -12, opacity: 0, rotate: 90 }}
                                animate={{ y: 0, opacity: 1, rotate: 0 }}
                                exit={{ y: 12, opacity: 0, rotate: -90 }}
                                transition={{ duration: 0.15 }}
                            >
                                <Moon className="w-4 h-4 text-[var(--accent-indigo)]" />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.button>

                {/* User Menu */}
                <div className="relative">
                    <motion.button
                        onClick={(e) => {
                            e.stopPropagation()
                            setShowUserMenu(!showUserMenu)
                        }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                    >
                        <div className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-secondary)] text-[10px] font-semibold">
                            {user.name.charAt(0).toUpperCase()}
                        </div>
                        <ChevronDown className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                    </motion.button>

                    <AnimatePresence>
                        {showUserMenu && (
                            <motion.div
                                initial={{ opacity: 0, y: 6, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 6, scale: 0.95 }}
                                transition={{ duration: 0.12 }}
                                className="absolute right-0 mt-1 w-48 rounded-xl bg-[var(--bg-elevated)] shadow-xl border border-[var(--border-default)] overflow-hidden z-50"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="p-1.5">
                                    <div className="px-2.5 py-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                                        Account
                                    </div>
                                    <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-xs">
                                        <User className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                                        Profile
                                    </button>
                                    <div className="my-1 border-t border-[var(--border-subtle)]" />
                                    <button
                                        onClick={user.onSignOut}
                                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/5 transition-colors text-xs"
                                    >
                                        <LogOut className="w-3.5 h-3.5" />
                                        Sign Out
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Command Bar Overlay (full-width dropdown) */}
            <AnimatePresence>
                {commandBarOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setCommandBarOpen(false)}
                        />
                        {/* Command Bar */}
                        <motion.div
                            className="fixed top-12 left-1/2 -translate-x-1/2 w-full max-w-lg z-[101]"
                            initial={{ opacity: 0, y: -10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.98 }}
                            transition={{ duration: 0.15 }}
                        >
                            <div className="bg-[var(--bg-elevated)] rounded-xl shadow-2xl border border-[var(--border-default)] overflow-hidden">
                                <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
                                    <Search className="w-4 h-4 text-[var(--text-muted)]" />
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        placeholder="Search bible, hymns, songs, or type a command..."
                                        className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') setCommandBarOpen(false)
                                        }}
                                    />
                                    <button
                                        onClick={() => setCommandBarOpen(false)}
                                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                {/* Placeholder for search results — will be populated in Phase 2 */}
                                <div className="p-3 text-xs text-[var(--text-muted)] text-center">
                                    Start typing to search...
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </header>
    )
}
