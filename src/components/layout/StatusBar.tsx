import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Radio, Mic, PanelRight, Keyboard, Monitor } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { SlideChip } from '../slides/SlideChip'
import { OfflineIndicator } from '../offline/OfflineIndicator'
import { useSermonListenerContext } from '../sermon-listener/SermonListenerContext'

export function StatusBar() {
    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const contextPanelOpen = useAppStore((s) => s.contextPanelOpen)
    const toggleContextPanel = useAppStore((s) => s.toggleContextPanel)
    const sermonListener = useSermonListenerContext()

    // Get live slide info
    const liveSlide = useMemo(() => {
        return activeSlides.find((s) => s.id === liveSlideId)
    }, [activeSlides, liveSlideId])

    return (
        <footer className="studio-status-bar glass-panel border-t border-[var(--border-subtle)] flex items-center px-3 gap-4 text-[11px]">
            {/* Left — Live indicator */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
                {liveSlide ? (
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 flex-shrink-0">
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                            </span>
                            <span className="font-semibold text-[10px] uppercase tracking-wider">Live</span>
                        </div>
                        <AnimatePresence mode="wait">
                            <motion.span
                                key={liveSlide.id}
                                className="text-[var(--text-primary)] font-medium truncate"
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.15 }}
                            >
                                {liveSlide.name}
                            </motion.span>
                        </AnimatePresence>
                        <SlideChip slideType={liveSlide.type} />
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                        <Monitor className="w-3 h-3" />
                        <span>Not live</span>
                    </div>
                )}
            </div>

            {/* Center — Sermon listener mini-status */}
            <button
                onClick={() => {
                    if (activeNavSection === 'sermon') {
                        setActiveNavSection(null)
                    } else {
                        setActiveNavSection('sermon')
                    }
                }}
                className={`
                    flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors
                    ${sermonListener?.isListening
                        ? 'bg-red-500/10 text-red-500'
                        : activeNavSection === 'sermon'
                            ? 'bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }
                `}
                title={sermonListener?.isListening && activeNavSection !== 'sermon' ? 'Sermon Listener — Recording in background (click to show)' : 'Toggle Sermon Listener'}
            >
                {sermonListener?.isListening && (
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                    </span>
                )}
                <Mic className="w-3 h-3" />
                <span>{sermonListener?.isListening ? (activeNavSection === 'sermon' ? 'Recording' : 'Background') : 'Sermon'}</span>
            </button>

            {/* Right — Controls */}
            <div className="flex items-center gap-2">
                <OfflineIndicator />
                {/* Keyboard shortcut hints */}
                <div className="hidden lg:flex items-center gap-2 text-[var(--text-muted)]">
                    <span className="flex items-center gap-0.5">
                        <kbd className="px-1 py-px bg-[var(--bg-tertiary)] rounded text-[9px] font-mono border border-[var(--border-subtle)]">↑</kbd>
                        <kbd className="px-1 py-px bg-[var(--bg-tertiary)] rounded text-[9px] font-mono border border-[var(--border-subtle)]">↓</kbd>
                        <span className="ml-0.5">Navigate</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                        <kbd className="px-1 py-px bg-[var(--bg-tertiary)] rounded text-[9px] font-mono border border-[var(--border-subtle)]">⌘/</kbd>
                        <span className="ml-0.5">Search</span>
                    </span>
                </div>

                {/* Context panel toggle */}
                <button
                    onClick={toggleContextPanel}
                    className={`
                        p-1 rounded transition-colors
                        ${contextPanelOpen
                            ? 'text-[var(--accent-teal)] bg-[var(--accent-teal)]/10'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                        }
                    `}
                    title={contextPanelOpen ? 'Hide panel (⌘\\)' : 'Show panel (⌘\\)'}
                >
                    <PanelRight className="w-3.5 h-3.5" />
                </button>
            </div>
        </footer>
    )
}
