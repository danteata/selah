import { useCallback } from 'react'
import { motion } from 'framer-motion'
import {
    BookOpen, Music, Image, Layout, Clock, AlertCircle,
    Archive, Calendar, Mic, Settings, Zap
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSermonListenerContext } from '../sermon-listener/SermonListenerContext'
import type { NavSection } from '../../types/studio'

const NAV_ICON_MAP: Record<NavSection, React.ElementType> = {
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

const NAV_LABELS: Record<NavSection, string> = {
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

// Group items with dividers between groups
const NAV_GROUPS: { items: NavSection[]; }[] = [
    { items: ['bible', 'music', 'media', 'templates', 'countdown', 'alerts', 'library'] },
    { items: ['schedule', 'sermon'] },
    { items: ['settings'] },
]

export function NavRail() {
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const commandBarOpen = useAppStore((s) => s.commandBarOpen)
    const setCommandBarOpen = useAppStore((s) => s.setCommandBarOpen)
    const sermonListener = useSermonListenerContext()

    const handleNavClick = useCallback((section: NavSection) => {
        if (activeNavSection === section) {
            setActiveNavSection(null)
        } else {
            setActiveNavSection(section)
        }
    }, [activeNavSection, setActiveNavSection])

    const handleQuickAdd = useCallback(() => {
        setCommandBarOpen(!commandBarOpen)
    }, [commandBarOpen, setCommandBarOpen])

    return (
        <nav
            className="studio-nav-rail glass-panel border-r border-[var(--border-subtle)] flex flex-col items-center py-2 gap-0.5"
            role="navigation"
            aria-label="Main navigation"
        >
            {/* Quick Add button at top */}
            <motion.button
                onClick={handleQuickAdd}
                className={`
                    nav-rail-btn mb-1
                    ${commandBarOpen
                        ? 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)]'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                    }
                `}
                title="Quick Add (⌘/)"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
            >
                <Zap className="w-[18px] h-[18px]" />
            </motion.button>

            <div className="w-6 border-t border-[var(--border-subtle)] mb-1" />

            {/* Navigation groups */}
            <div className="flex-1 flex flex-col items-center gap-0.5 overflow-y-auto nav-rail-scroll">
                {NAV_GROUPS.map((group, groupIdx) => (
                    <div key={groupIdx} className="flex flex-col items-center gap-0.5">
                        {groupIdx > 0 && (
                            <div className="w-6 border-t border-[var(--border-subtle)] my-1.5" />
                        )}
                        {group.items.map((section) => {
                            const Icon = NAV_ICON_MAP[section]
                            const isActive = activeNavSection === section
                            const label = NAV_LABELS[section]
                            const isBackgroundRecording = section === 'sermon' && sermonListener?.isListening

                            return (
                                <motion.button
                                    key={section}
                                    onClick={() => handleNavClick(section)}
                                    className={`
                                        nav-rail-btn relative
                                        ${isActive
                                            ? 'text-[var(--accent-teal)]'
                                            : isBackgroundRecording
                                                ? 'text-red-500'
                                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                                        }
                                    `}
                                    title={isBackgroundRecording && !isActive ? `${label} — Recording in background` : label}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    aria-pressed={isActive}
                                    aria-label={label}
                                >
                                    {/* Active indicator pill */}
                                    {isActive && (
                                        <motion.div
                                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[var(--accent-teal)]"
                                            layoutId="nav-active-indicator"
                                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                        />
                                    )}
                                    {isActive && (
                                        <motion.div
                                            className="absolute inset-1 rounded-lg bg-[var(--accent-teal)]/10"
                                            layoutId="nav-active-bg"
                                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                        />
                                    )}
                                    {/* Background recording pulsing dot */}
                                    {isBackgroundRecording && !isActive && (
                                        <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                                        </span>
                                    )}
                                    <Icon className="w-[18px] h-[18px] relative z-10" />
                                </motion.button>
                            )
                        })}
                    </div>
                )                )}
            </div>
        </nav>
    )
}
