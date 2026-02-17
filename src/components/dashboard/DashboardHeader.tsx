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
                ? 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg shadow-black/5 dark:shadow-black/20'
                : 'bg-white dark:bg-gray-900'
                } border-b border-gray-200 dark:border-gray-800`}
        >
            <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    {/* Logo and Schedule */}
                    <div className="flex items-center gap-4">
                        {/* Logo with gradient */}
                        <motion.div
                            className="flex items-center gap-2"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.5 }}
                        >
                            <div className="relative">
                                <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-lg blur-sm opacity-50" />
                                <h1 className="relative text-xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 dark:from-blue-400 dark:via-purple-400 dark:to-pink-400 bg-clip-text text-transparent">
                                    Selah
                                </h1>
                            </div>
                            {/* Status indicator */}
                            <div className="flex items-center gap-1.5">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                </span>
                            </div>
                        </motion.div>

                        {/* Active Schedule Badge */}
                        {activeSchedule && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/30 dark:to-purple-900/30 border border-blue-200 dark:border-blue-800"
                            >
                                <Calendar className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                                    {activeSchedule.name}
                                </span>
                            </motion.div>
                        )}
                    </div>

                    {/* Right Side Actions */}
                    <div className="flex items-center gap-2 sm:gap-4">
                        {/* Church Context Switcher (for superadmin) */}
                        <ChurchContext />

                        {/* Admin Panel Toggle (for superadmin/admin) */}
                        {canAccessAdmin && onToggleAdminPanel && (
                            <motion.button
                                onClick={onToggleAdminPanel}
                                className={`relative p-2.5 rounded-xl transition-all duration-300 ${showAdminPanel
                                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/25'
                                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                                    }`}
                                title="Admin Panel"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                <Shield className="w-5 h-5" />
                            </motion.button>
                        )}

                        {/* Sermon Listener Toggle */}
                        <motion.button
                            onClick={onToggleSermonListener}
                            className={`relative p-2.5 rounded-xl transition-all duration-300 ${showSermonListener
                                ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/25'
                                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                                }`}
                            title="Sermon Listener"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            <Mic className="w-5 h-5" />
                            {showSermonListener && (
                                <motion.div
                                    className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-white dark:border-gray-900"
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                                />
                            )}
                        </motion.button>

                        {/* Theme Toggle */}
                        <motion.button
                            onClick={onToggleTheme}
                            className="relative p-2.5 rounded-xl text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors overflow-hidden"
                            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
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
                                        <Sun className="w-5 h-5 text-amber-500" />
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="moon"
                                        initial={{ y: -20, opacity: 0, rotate: 90 }}
                                        animate={{ y: 0, opacity: 1, rotate: 0 }}
                                        exit={{ y: 20, opacity: 0, rotate: -90 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        <Moon className="w-5 h-5 text-indigo-500" />
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
                                className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
                                    {user.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {user.name}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                            </motion.button>

                            {/* Dropdown Menu */}
                            <AnimatePresence>
                                {showUserMenu && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                        transition={{ duration: 0.15 }}
                                        className="absolute right-0 mt-2 w-56 rounded-xl bg-white dark:bg-gray-800 shadow-xl shadow-black/10 dark:shadow-black/30 border border-gray-200 dark:border-gray-700 overflow-hidden"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="p-2">
                                            <div className="px-3 py-2 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                                Account
                                            </div>

                                            <button
                                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                            >
                                                <User className="w-4 h-4" />
                                                <span className="text-sm">Profile</span>
                                            </button>

                                            <button
                                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                            >
                                                <Settings className="w-4 h-4" />
                                                <span className="text-sm">Settings</span>
                                            </button>

                                            <div className="my-2 border-t border-gray-200 dark:border-gray-700" />

                                            <button
                                                onClick={user.onSignOut}
                                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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