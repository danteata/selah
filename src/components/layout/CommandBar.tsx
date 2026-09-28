import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
    Search, Command, Zap, Play, Book, BookA,
    Music, Image, Settings, HelpCircle, ArrowRight,
    Layout, Clock, AlertCircle
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useDialog } from '../../hooks/useDialog'

interface CommandItem {
    id: string
    title: string
    description?: string
    icon: React.ElementType
    category: 'action' | 'navigation' | 'slide' | 'bible'
    shortcut?: string
    action: () => void
}

export function CommandBar() {
    const commandBarOpen = useAppStore((s) => s.commandBarOpen)
    const setCommandBarOpen = useAppStore((s) => s.setCommandBarOpen)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const setMusicPanelQuery = useAppStore((s) => s.setMusicPanelQuery)
    const setBiblePanelQuery = useAppStore((s) => s.setBiblePanelQuery)
    const setContextPanelOpen = useAppStore((s) => s.setContextPanelOpen)
    const activeSlides = useAppStore((s) => s.activeSlides)
    const setLiveSlide = useAppStore((s) => s.setLiveSlide)
    const activeSchedule = useAppStore((s) => s.activeSchedule)
    
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // Clear the previous search each time the bar opens (adjusted during render)
    const [prevCommandBarOpen, setPrevCommandBarOpen] = useState(commandBarOpen)
    if (commandBarOpen !== prevCommandBarOpen) {
        setPrevCommandBarOpen(commandBarOpen)
        if (commandBarOpen) {
            setQuery('')
            setSelectedIndex(0)
        }
    }

    const handleClose = useCallback(() => {
        setCommandBarOpen(false)
    }, [setCommandBarOpen])

    // Focus lands on the search box (the panel's first control), Tab stays in
    // the palette, and Escape closes it without reaching a dialog underneath.
    const panelRef = useDialog({ isOpen: commandBarOpen, onClose: handleClose })

    const staticCommands: CommandItem[] = [
        {
            id: 'go-bible',
            title: 'Search Bible',
            description: 'Open the Bible explorer',
            icon: Book,
            category: 'navigation',
            action: () => { setActiveNavSection('bible'); handleClose() }
        },
        {
            id: 'go-songs',
            title: 'Search Songs',
            description: 'Browse the song library',
            icon: Music,
            category: 'navigation',
            action: () => { setActiveNavSection('music'); handleClose() }
        },
        {
            id: 'go-media',
            title: 'Open Media',
            description: 'Browse background media',
            icon: Image,
            category: 'navigation',
            action: () => { setActiveNavSection('media'); handleClose() }
        },
        {
            id: 'go-dictionary',
            title: 'Define a Word',
            description: 'Bible, Greek/Hebrew and English dictionaries',
            icon: BookA,
            category: 'navigation',
            action: () => { setActiveNavSection('dictionary'); handleClose() }
        },
        {
            id: 'go-templates',
            title: 'Browse Templates',
            description: 'Apply layouts and styles',
            icon: Layout,
            category: 'navigation',
            action: () => { setActiveNavSection('templates'); handleClose() }
        },
        {
            id: 'go-countdown',
            title: 'Add Countdown',
            description: 'Insert a countdown timer',
            icon: Clock,
            category: 'navigation',
            action: () => { setActiveNavSection('countdown'); handleClose() }
        },
        {
            id: 'go-alerts',
            title: 'Broadcast Alert',
            description: 'Show a banner or message',
            icon: AlertCircle,
            category: 'navigation',
            action: () => { setActiveNavSection('alerts'); handleClose() }
        },
        {
            id: 'stop-live',
            title: 'Stop Live Output',
            description: 'Clear the live screen',
            icon: Zap,
            category: 'action',
            shortcut: 'Esc',
            action: () => { setLiveSlide(''); handleClose() }
        },
        {
            id: 'settings',
            title: 'App Settings',
            description: 'Configure Selah Studio',
            icon: Settings,
            category: 'navigation',
            action: () => { setActiveNavSection('settings'); handleClose() }
        }
    ]

    // Dynamic commands based on search query (Slides)
    const dynamicCommands: CommandItem[] = query.length > 0 ? activeSlides
        .filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5)
        .map(s => ({
            id: `slide-${s.id}`,
            title: s.name,
            description: `Slide in ${activeSchedule?.name || 'Current Schedule'}`,
            icon: Play,
            category: 'slide',
            action: () => { setLiveSlide(s.id); handleClose() }
        })) : []

    // The top bar promises a search of songs, hymns and the Bible, but this
    // only knew its own commands: "Amazing Grace" found nothing. Any query
    // also offers to search the songs panel and the Bible for it.
    const trimmed = query.trim()
    const searchCommands: CommandItem[] = trimmed ? [
        {
            id: 'search-songs',
            title: `Find “${trimmed}” in songs and hymns`,
            description: 'Opens Songs with this search',
            icon: Music,
            category: 'navigation',
            action: () => { setMusicPanelQuery(trimmed); setActiveNavSection('music'); setContextPanelOpen(true); handleClose() }
        },
        {
            id: 'search-bible',
            title: `Look up “${trimmed}” in the Bible`,
            description: 'A reference like John 3:16, or words from a verse',
            icon: Book,
            category: 'bible',
            action: () => { setBiblePanelQuery(trimmed); setActiveNavSection('bible'); setContextPanelOpen(true); handleClose() }
        },
    ] : []

    const filteredCommands = [...dynamicCommands, ...staticCommands.filter(c =>
        c.title.toLowerCase().includes(query.toLowerCase()) ||
        c.description?.toLowerCase().includes(query.toLowerCase())
    ), ...searchCommands]

    const commandCount = filteredCommands.length

    // Typing shrinks the list, so a stored index left over from a hover or an
    // earlier query can point past its end — and then Enter silently does
    // nothing while the mouse still works. Derived rather than clamped in an
    // effect, so there's no render where the highlight sits out of range.
    const activeIndex = commandCount === 0 ? 0 : Math.min(selectedIndex, commandCount - 1)

    // The key handler is registered once per open, so it reads the current list
    // and selection through refs instead of taking them as effect deps — the
    // command array is rebuilt every render, which would otherwise tear the
    // listener down and rebuild it on every keystroke.
    const commandsRef = useRef<CommandItem[]>(filteredCommands)
    const activeIndexRef = useRef(activeIndex)
    useEffect(() => {
        commandsRef.current = filteredCommands
        activeIndexRef.current = activeIndex
    })

    // Key handling lives on the window rather than the input's onKeyDown so it
    // works whether or not focus is in the search box — a click on a row, or
    // anything else that takes focus, used to leave the palette mouse-only.
    useEffect(() => {
        if (!commandBarOpen) return

        const handleKeyDown = (event: KeyboardEvent) => {
            const count = commandsRef.current.length

            switch (event.key) {
                case 'ArrowDown':
                    // preventDefault stops the caret jumping to the end of the
                    // query and stops the global slide-queue Arrow shortcuts
                    // firing behind the palette.
                    event.preventDefault()
                    if (count > 0) setSelectedIndex((activeIndexRef.current + 1) % count)
                    break
                case 'ArrowUp':
                    event.preventDefault()
                    if (count > 0) setSelectedIndex((activeIndexRef.current - 1 + count) % count)
                    break
                case 'Home':
                    event.preventDefault()
                    setSelectedIndex(0)
                    break
                case 'End':
                    event.preventDefault()
                    setSelectedIndex(Math.max(0, count - 1))
                    break
                case 'Enter': {
                    const command = commandsRef.current[activeIndexRef.current]
                    if (!command) return
                    event.preventDefault()
                    command.action()
                    break
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [commandBarOpen])

    // ⌘K stays separate: it has to work when the palette is closed, which the
    // effect above deliberately doesn't run for. Escape is useDialog's.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault()
                setCommandBarOpen(!commandBarOpen)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [commandBarOpen, setCommandBarOpen])

    // Keep the highlighted row on screen — the list scrolls past ~6 items, and
    // arrowing into an off-screen selection looks like nothing happened.
    useEffect(() => {
        const selected = listRef.current?.querySelector(`[data-command-index="${activeIndex}"]`)
        selected?.scrollIntoView({ block: 'nearest' })
    }, [activeIndex])

    return (
        <AnimatePresence>
            {commandBarOpen && (
                <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4">
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={handleClose}
                    />
                    
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Command palette"
                        tabIndex={-1}
                        className="relative w-full max-w-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-2xl outline-none shadow-2xl overflow-hidden flex flex-col"
                    >
                        <div className="flex items-center px-4 py-4 border-b border-[var(--border-subtle)]">
                            <Search className="w-5 h-5 text-[var(--text-muted)] mr-3" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                // A new query selects its best match, the first row.
                                onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
                                placeholder="Type a command or search..."
                                aria-label="Search commands"
                                className="flex-1 bg-transparent border-none text-[var(--text-primary)] text-lg focus:outline-none focus:ring-0 placeholder:text-[var(--text-muted)]"
                            />
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--bg-tertiary)] rounded-md border border-[var(--border-subtle)]">
                                <Command className="w-3 h-3 text-[var(--text-muted)]" />
                                <span className="text-[10px] font-bold text-[var(--text-muted)]">K</span>
                            </div>
                        </div>

                        <div ref={listRef} className="flex-1 max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
                            {filteredCommands.length > 0 ? (
                                <div className="space-y-1">
                                    {filteredCommands.map((command, index) => (
                                        <button
                                            key={command.id}
                                            data-command-index={index}
                                            onClick={() => command.action()}
                                            onMouseEnter={() => setSelectedIndex(index)}
                                            className={`w-full flex items-center gap-4 px-3 py-3 rounded-xl transition-all group ${
                                                activeIndex === index 
                                                    ? 'bg-[var(--accent-teal)] text-white shadow-lg shadow-[var(--accent-teal)]/20' 
                                                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                            }`}
                                        >
                                            <div className={`p-2 rounded-lg ${activeIndex === index ? 'bg-white/20' : 'bg-[var(--bg-tertiary)]'}`}>
                                                <command.icon className="w-5 h-5" />
                                            </div>
                                            <div className="flex-1 text-left">
                                                <div className={`font-bold text-sm ${activeIndex === index ? 'text-white' : 'text-[var(--text-primary)]'}`}>
                                                    {command.title}
                                                </div>
                                                <div className={`text-xs ${activeIndex === index ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>
                                                    {command.description}
                                                </div>
                                            </div>
                                            {command.shortcut && (
                                                <div className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${activeIndex === index ? 'bg-white/20' : 'bg-[var(--bg-tertiary)]'}`}>
                                                    {command.shortcut}
                                                </div>
                                            )}
                                            {activeIndex === index && (
                                                <ArrowRight className="w-4 h-4 text-white/50" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-12 text-center text-[var(--text-muted)]">
                                    <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-20" />
                                    <p className="text-sm">No commands found for "{query}"</p>
                                </div>
                            )}
                        </div>

                        <div className="px-4 py-3 bg-[var(--bg-tertiary)]/30 border-t border-[var(--border-subtle)] flex items-center justify-between text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
                            <div className="flex gap-4">
                                <span className="flex items-center gap-1"><kbd className="bg-[var(--bg-tertiary)] px-1 rounded">↵</kbd> Select</span>
                                <span className="flex items-center gap-1"><kbd className="bg-[var(--bg-tertiary)] px-1 rounded">↑↓</kbd> Navigate</span>
                            </div>
                            <div>
                                Press <kbd className="bg-[var(--bg-tertiary)] px-1 rounded">Esc</kbd> to close
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}
