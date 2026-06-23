/**
 * MobileBottomNav — bottom tab bar for narrow viewports.
 *
 * Renders only below the `md` breakpoint (768px) so it disappears on
 * tablet/desktop where the full NavRail takes over. Mirrors the rail's
 * most-used sections (Bible, Music, Templates, Sermon, Settings) plus
 * a quick-add button. Sections that open modals (library, schedule,
 * settings) are kept accessible via the more-button that opens the
 * full NavRail as a slide-up sheet on small screens.
 */

import { useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    BookOpen, Music, Layout, Mic, Settings, Zap, X, Image,
    Clock, AlertCircle, Archive, Calendar
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSermonListenerContext } from '../sermon-listener/SermonListenerContext'
import type { NavSection } from '../../types/studio'

const PRIMARY_ITEMS: NavSection[] = ['bible', 'music', 'templates', 'sermon']
const MORE_ITEMS: NavSection[] = ['media', 'countdown', 'alerts', 'library', 'schedule', 'settings']

const ICON: Record<NavSection, React.ElementType> = {
    bible: BookOpen,
    music: Music,
    media: Image,
    templates: Layout,
    countdown: Clock,
    alerts: AlertCircle,
    library: Archive,
    schedule: Calendar,
    sermon: Mic,
    settings: Settings,
}

const LABELS: Record<NavSection, string> = {
    bible: 'Bible',
    music: 'Music',
    media: 'Media',
    templates: 'Templates',
    countdown: 'Countdown',
    alerts: 'Alerts',
    library: 'Library',
    schedule: 'Schedule',
    sermon: 'Sermon',
    settings: 'Settings',
}

export function MobileBottomNav() {
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const commandBarOpen = useAppStore((s) => s.commandBarOpen)
    const setCommandBarOpen = useAppStore((s) => s.setCommandBarOpen)
    const sermonListener = useSermonListenerContext()
    const [moreOpen, setMoreOpen] = useState(false)

    const handleNav = useCallback((section: NavSection) => {
        if (activeNavSection === section) {
            setActiveNavSection(null)
        } else {
            setActiveNavSection(section)
        }
        setMoreOpen(false)
    }, [activeNavSection, setActiveNavSection])

    const handleQuickAdd = useCallback(() => {
        setCommandBarOpen(true)
    }, [setCommandBarOpen])

    return (
        <>
            <nav
                className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 backdrop-blur-md"
                aria-label="Mobile navigation"
            >
                <div className="flex items-stretch justify-around h-14">
                    {PRIMARY_ITEMS.map((section) => {
                        const Icon = ICON[section]
                        const isActive = activeNavSection === section
                        const isRecording = section === 'sermon' && sermonListener?.isListening
                        return (
                            <button
                                key={section}
                                type="button"
                                onClick={() => handleNav(section)}
                                aria-pressed={isActive}
                                aria-label={LABELS[section]}
                                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                                    isActive
                                        ? 'text-[var(--accent-teal)]'
                                        : isRecording
                                            ? 'text-red-500'
                                            : 'text-[var(--text-muted)]'
                                }`}
                            >
                                <span className="relative">
                                    <Icon className="w-5 h-5" />
                                    {isRecording && (
                                        <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                                        </span>
                                    )}
                                </span>
                                <span>{LABELS[section]}</span>
                            </button>
                        )
                    })}
                    <button
                        type="button"
                        onClick={handleQuickAdd}
                        aria-label="Quick add"
                        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[var(--accent-teal)]"
                    >
                        <Zap className="w-5 h-5" />
                        <span>Add</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setMoreOpen(true)}
                        aria-label="More navigation"
                        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[var(--text-muted)]"
                    >
                        <span className="grid grid-cols-2 gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-current" />
                            <span className="w-1 h-1 rounded-full bg-current" />
                            <span className="w-1 h-1 rounded-full bg-current" />
                            <span className="w-1 h-1 rounded-full bg-current" />
                        </span>
                        <span>More</span>
                    </button>
                </div>
            </nav>

            {/* "More" sheet — slides up from the bottom with the secondary
                nav items. The bottom nav stays visible underneath. */}
            <AnimatePresence>
                {moreOpen && (
                    <>
                        <motion.div
                            className="md:hidden fixed inset-0 bg-black/50 z-40"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setMoreOpen(false)}
                        />
                        <motion.div
                            className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl shadow-2xl"
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        >
                            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
                                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                                    More
                                </h2>
                                <button
                                    onClick={() => setMoreOpen(false)}
                                    className="p-1 text-[var(--text-muted)]"
                                    aria-label="Close"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="grid grid-cols-3 gap-1 p-3">
                                {MORE_ITEMS.map((section) => {
                                    const Icon = ICON[section]
                                    const isActive = activeNavSection === section
                                    return (
                                        <button
                                            key={section}
                                            type="button"
                                            onClick={() => handleNav(section)}
                                            aria-pressed={isActive}
                                            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg transition-colors ${
                                                isActive
                                                    ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                            }`}
                                        >
                                            <Icon className="w-5 h-5" />
                                            <span className="text-xs font-medium">
                                                {LABELS[section]}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                            <div className="h-14" /> {/* Spacer so the bottom
                                nav doesn't overlap the sheet's last row. */}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    )
}
