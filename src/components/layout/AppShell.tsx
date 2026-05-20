import { useEffect } from 'react'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { ContextPanel } from './ContextPanel'
import { QuickBibleBar } from '../bible/QuickBibleBar'
import { SermonListenerProvider } from '../sermon-listener/SermonListenerContext'
import { ListeningChip } from '../sermon-listener/ListeningChip'
import { useAppStore } from '../../store/appStore'
import type { Schedule } from '../../types'

interface AppShellProps {
    isDark: boolean
    onToggleTheme: () => void
    activeSchedule?: Schedule | null
    user: {
        name: string
        onSignOut: () => void
    }
    children: React.ReactNode
}

export function AppShell({ isDark, onToggleTheme, activeSchedule, user, children }: AppShellProps) {
    const openModal = useAppStore((s) => s.openModal)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const contextPanelOpen = useAppStore((s) => s.contextPanelOpen)
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const panelMode = useAppStore((s) => s.panelMode)
    const toggleQuickBibleBar = useAppStore((s) => s.toggleQuickBibleBar)

    // Handle sections that trigger modals instead of the inline sidebar
    useEffect(() => {
        if (activeNavSection === 'library') {
            openModal('libraryPanel')
            setActiveNavSection(null)
        } else if (activeNavSection === 'schedule') {
            openModal('scheduleModal')
            setActiveNavSection(null)
        } else if (activeNavSection === 'settings') {
            openModal('settings')
            setActiveNavSection(null)
        }
    }, [activeNavSection, openModal, setActiveNavSection])

    // Ctrl+B shortcut for Quick Bible Bar
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault()
                toggleQuickBibleBar()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [toggleQuickBibleBar])

    // Determine if context panel is actually showing inline content
    const INLINE_SECTIONS = ['bible', 'music', 'media', 'templates', 'countdown', 'alerts', 'sermon']
    const showInline = activeNavSection && INLINE_SECTIONS.includes(activeNavSection)
    const panelVisible = contextPanelOpen && showInline

    return (
        <SermonListenerProvider>
        <div className={`studio-shell ${isDark ? 'dark' : ''}`}>
            {/* Subtle Background Elements */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-[var(--accent-teal)]/8 dark:bg-[var(--accent-teal)]/5 rounded-full blur-3xl animate-pulse-soft" />
                <div className="absolute top-1/3 -left-40 w-80 h-80 bg-[var(--accent-amber)]/6 dark:bg-[var(--accent-amber)]/4 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: '2s' }} />
                <div className="absolute -bottom-40 right-1/4 w-72 h-72 bg-[var(--accent-rose)]/5 dark:bg-[var(--accent-rose)]/3 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: '4s' }} />
            </div>

            {/* Grain texture overlay */}
            <div className="grain-overlay" />

            {/* Top Bar */}
            <TopBar
                isDark={isDark}
                onToggleTheme={onToggleTheme}
                activeSchedule={activeSchedule}
                user={user}
            />

            {/* Middle row: NavRail + Workspace + ContextPanel */}
            <div className="studio-middle">
                <NavRail />

                <main className="studio-workspace">
                    {children}
                </main>

                {panelVisible && panelMode === 'docked' && <ContextPanel />}
            </div>

            {/* Floating context panel renders outside the flex flow */}
            {panelVisible && panelMode === 'floating' && <ContextPanel />}

            {/* Quick Bible Bar overlay */}
            <QuickBibleBar />

            {/* Floating chip when listener is recording in background */}
            <ListeningChip />

            {/* Status Bar */}
            <StatusBar />
        </div>
        </SermonListenerProvider>
    )
}