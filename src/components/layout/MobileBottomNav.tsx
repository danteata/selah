/**
 * MobileBottomNav — bottom tab bar for narrow viewports.
 *
 * Renders only in the phone layout (useIsMobile: a narrow screen, or a phone
 * on its side) so it disappears on tablet/desktop where the NavRail takes
 * over. First comes Live, the
 * remote-control view of what's on the screen: it was only what showed when
 * no panel was open, with no tab, so after putting a verse up from Bible
 * there was no evident way back to it. Then the rail's most-used sections
 * during a service (Bible, Music) and a quick-add button. Templates are setup work, so they live under More. So does the
 * sermon listener: a phone browser stops listening at every pause (Android
 * beeps each time) and when the screen locks, so it belongs on the desk's
 * computer — but while it's running here it stays on the bar, recording
 * light and all, so it can always be found and stopped. Sections that open modals (library, schedule,
 * settings) are kept accessible via the more-button that opens the
 * full NavRail as a slide-up sheet on small screens.
 */

import { useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    BookOpen, BookA, Music, Layout, Mic, Settings, Zap, X, Image,
    Clock, AlertCircle, Archive, Calendar, MonitorPlay
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useSermonListenerContext } from '../sermon-listener/SermonListenerContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { NavSection } from '../../types/studio'

const PRIMARY_ITEMS: NavSection[] = ['bible', 'music']
const MORE_ITEMS: NavSection[] = ['media', 'dictionary', 'templates', 'sermon', 'countdown', 'alerts', 'library', 'schedule', 'settings']

const ICON: Record<NavSection, React.ElementType> = {
    bible: BookOpen,
    dictionary: BookA,
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
    dictionary: 'Dictionary',
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
    const setCommandBarOpen = useAppStore((s) => s.setCommandBarOpen)
    const somethingLive = useAppStore((s) => !!s.liveSlideId)
    const isPhone = useIsMobile()
    const sermonListener = useSermonListenerContext()
    const [moreOpen, setMoreOpen] = useState(false)
    // A listener running on this phone keeps its tab, so it's never out of sight.
    const listening = !!sermonListener?.isListening
    const primaryItems: NavSection[] = listening ? [...PRIMARY_ITEMS, 'sermon'] : PRIMARY_ITEMS
    const moreItems = listening ? MORE_ITEMS.filter((section) => section !== 'sermon') : MORE_ITEMS

    const handleNav = useCallback((section: NavSection) => {
        if (activeNavSection === section) {
            setActiveNavSection(null)
        } else {
            setActiveNavSection(section)
        }
        setMoreOpen(false)
    }, [activeNavSection, setActiveNavSection])

    const showLive = useCallback(() => {
        setActiveNavSection(null)
        setMoreOpen(false)
    }, [setActiveNavSection])

    const handleQuickAdd = useCallback(() => {
        setCommandBarOpen(true)
    }, [setCommandBarOpen])

    if (!isPhone) return null

    return (
        <>
            <nav
                className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 backdrop-blur-md"
                aria-label="Mobile navigation"
            >
                <div className="mobile-bottom-nav-row flex items-stretch justify-around h-14">
                    <button
                        type="button"
                        onClick={showLive}
                        aria-pressed={activeNavSection === null}
                        aria-label="Live"
                        className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                            activeNavSection === null ? 'text-[var(--accent-teal)]' : 'text-[var(--text-muted)]'
                        }`}
                    >
                        <span className="relative">
                            <MonitorPlay className="w-5 h-5" />
                            {somethingLive && (
                                <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[var(--bg-elevated)]" />
                            )}
                        </span>
                        <span className="mobile-bottom-nav-label">Live</span>
                    </button>
                    {primaryItems.map((section) => {
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
                                <span className="mobile-bottom-nav-label">{LABELS[section]}</span>
                            </button>
                        )
                    })}
                    <button
                        type="button"
                        onClick={handleQuickAdd}
                        aria-label="Quick add"
                        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[var(--text-muted)]"
                    >
                        {/* An action, not a place: tinted icon, plain label, so
                            it never reads as the selected tab. */}
                        <Zap className="w-5 h-5 text-[var(--accent-teal)]" />
                        <span className="mobile-bottom-nav-label">Add</span>
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
                        <span className="mobile-bottom-nav-label">More</span>
                    </button>
                </div>
            </nav>

            {/* "More" sheet — slides up from the bottom with the secondary
                nav items. The bottom nav stays visible underneath. */}
            <AnimatePresence>
                {moreOpen && (
                    <>
                        <motion.div
                            className="fixed inset-0 bg-black/50 z-40"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setMoreOpen(false)}
                        />
                        <motion.div
                            className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl shadow-2xl"
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
                                {moreItems.map((section) => {
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
