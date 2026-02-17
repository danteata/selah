import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sun, Moon, Mic, ChevronDown, LogOut, User, Settings, Calendar, Shield } from 'lucide-react'
import type { Schedule } from '../../types'
import { ChurchContext } from '../layout/ChurchContext'

interface DashboardHeaderProps {
    isDark: boolean
    onToggleTheme: () => void
    activeSchedule?: Schedule | null
    showSermonListener: boolean
    onToggleSermonListener: () => void
    showAdminPanel?: boolean
    onToggleAdminPanel?: () => void
    canAccessAdmin?: boolean
    user: {
        name: string
        onSignOut: () => void
    }
}

export function DashboardHeader({
    isDark,
    onToggleTheme,
    activeSchedule,
    showSermonListener,
    onToggleSermonListener,
    showAdminPanel = false,
    onToggleAdminPanel,
    canAccessAdmin = false,
    user
}: DashboardHeaderProps) {
    const [isScrolled, setIsScrolled] = useState(false)
    const [showUserMenu, setShowUserMenu] = useState(false)

    // Track scroll for backdrop blur effect
    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 10)
        }
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    // Close user menu when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setShowUserMenu(false)
        if (showUserMenu) {
            document.addEventListener('click', handleClickOutside)
            return () => document.removeEventListener('click', handleClickOutside)
        }
    }, [showUserMenu])

    return (
        <header
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled
                    ? 'bg-[var(--bg-secondary)]/90 backdrop-blur-xl shadow-lg shadow-black/5 dark:shadow-black/20 border-b border-[var(--border-subtle)]'
                    : 'bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)]'
                }`}
        >
            <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    {/* Logo and Schedule */}
                    <div className="flex items-center gap-4">
                        {/* Logo - refined, no gradients */}
                        <motion.div
                            className="flex items-center gap-3"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.5 }}
                        >
                            <div className="relative">
                                {/* Subtle accent mark */}
                                <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-[var(--accent-teal)]" />
                                <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight" style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}>
                                    Selah
                                </h1>
                            </div>
                            {/* Status indicator */}
                            <div className="flex items-center gap-1.5">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent-teal)] opacity-60" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent-teal)]" />
                                </span>
                            </div>
                        </motion.div>

                        {/* Active Schedule Badge */}
                        {activeSchedule && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-default)]"
                            >
                                <Calendar className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
                                <span className="text-sm font-medium text-[var(--text-secondary)]">
                                    {activeSchedule.name}
                                </span>
                            </motion.div>
                        )}
                    </div>

                    {/* Right Side Actions */}
                    <div className="flex items-center gap-2 sm:gap-3">
                        {/* Church Context Switcher (for superadmin) */}
                        <ChurchContext />

                        {/* Admin Panel Toggle (for superadmin/admin) */}
                        {canAccessAdmin && onToggleAdminPanel && (
                            <motion.button
                                onClick={onToggleAdminPanel}
                                className={`relative p-2.5 rounded-lg transition-all duration-200 ${showAdminPanel
                                        ? 'bg-[var(--accent-indigo)]/10 text-[var(--accent-indigo)] ring-1 ring-[var(--accent-indigo)]/20'
                                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                                    }`}
                                title="Admin Panel"
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                <Shield className="w-5 h-5" />
                            </motion.button>
                        )}

                        {/* Sermon Listener Toggle */}
                        <motion.button
                            onClick={onToggleSermonListener}
                            className={`relative p-2.5 rounded-lg transition-all duration-200 ${showSermonListener
                                    ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)] ring-1 ring-[var(--accent-teal)]/20'
                                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                                }`}
                            title="Sermon Listener"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                        >
                            <Mic className="w-5 h-5" />
                            {showSermonListener && (
                                <motion.div
                                    className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--accent-teal)] rounded-full border-2 border-[var(--bg-secondary)]"
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                                />
                            )}
                        </motion.button>

                        {/* Theme Toggle */}
                        <motion.button
                            onClick={onToggleTheme}
                            className="relative p-2.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-all duration-200 overflow-hidden"
                            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                        >
                            <AnimatePresence mode="wait">
                                {isDark ? (
                                    <motion.div
                                        key="sun"
                                        initial={{ y: -20, opacity: 0, rotate: -90 }}
                                        animate={{ y: 0, opacity: 1, rotate: 0 }}
                                        exit={{ y: 20, opacity: 0, rotate: 90 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        <Sun className="w-5 h-5 text-[var(--accent-amber)]" />
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="moon"
                                        initial={{ y: -20, opacity: 0, rotate: 90 }}
                                        animate={{ y: 0, opacity: 1, rotate: 0 }}
                                        exit={{ y: 20, opacity: 0, rotate: -90 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        <Moon className="w-5 h-5 text-[var(--accent-indigo)]" />
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
                                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-secondary)] text-sm font-medium">
                                    {user.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="hidden sm:block text-sm font-medium text-[var(--text-primary)]">
                                    {user.name}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                            </motion.button>

                            {/* Dropdown Menu */}
                            <AnimatePresence>
                                {showUserMenu && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                        transition={{ duration: 0.15 }}
                                        className="absolute right-0 mt-2 w-56 rounded-xl bg-[var(--bg-elevated)] shadow-xl border border-[var(--border-default)] overflow-hidden"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="p-2">
                                            <div className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                                                Account
                                            </div>

                                            <button
                                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                                            >
                                                <User className="w-4 h-4 text-[var(--text-tertiary)]" />
                                                <span className="text-sm">Profile</span>
                                            </button>

                                            <button
                                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                                            >
                                                <Settings className="w-4 h-4 text-[var(--text-tertiary)]" />
                                                <span className="text-sm">Settings</span>
                                            </button>

                                            <div className="my-2 border-t border-[var(--border-subtle)]" />

                                            <button
                                                onClick={user.onSignOut}
                                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/5 transition-colors"
                                            >
                                                <LogOut className="w-4 h-4" />
                                                <span className="text-sm">Sign Out</span>
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
            </div>
        </header>
    )
}
