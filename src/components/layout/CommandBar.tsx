import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
    Search, Command, Zap, Play, Eye, Book, 
    Music, Image, Settings, HelpCircle, ArrowRight,
    Layout, Clock, AlertCircle
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'

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
    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const setLiveSlide = useAppStore((s) => s.setLiveSlide)
    const activeSchedule = useAppStore((s) => s.activeSchedule)
    
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (commandBarOpen) {
            inputRef.current?.focus()
            setQuery('')
            setSelectedIndex(0)
        }
    }, [commandBarOpen])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault()
                setCommandBarOpen(!commandBarOpen)
            } else if (e.key === 'Escape' && commandBarOpen) {
                setCommandBarOpen(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [commandBarOpen, setCommandBarOpen])

    const handleClose = useCallback(() => {
        setCommandBarOpen(false)
    }, [setCommandBarOpen])

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

    const filteredCommands = [...dynamicCommands, ...staticCommands.filter(c => 
        c.title.toLowerCase().includes(query.toLowerCase()) || 
        c.description?.toLowerCase().includes(query.toLowerCase())
    )]

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            setSelectedIndex(prev => (prev + 1) % filteredCommands.length)
        } else if (e.key === 'ArrowUp') {
            setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        } else if (e.key === 'Enter') {
            filteredCommands[selectedIndex]?.action()
        }
    }

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
                        className="relative w-full max-w-2xl bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                    >
                        <div className="flex items-center px-4 py-4 border-b border-white/5">
                            <Search className="w-5 h-5 text-gray-500 mr-3" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type a command or search..."
                                className="flex-1 bg-transparent border-none text-white text-lg focus:outline-none focus:ring-0 placeholder-gray-600"
                            />
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/10">
                                <Command className="w-3 h-3 text-gray-400" />
                                <span className="text-[10px] font-bold text-gray-400">K</span>
                            </div>
                        </div>

                        <div className="flex-1 max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
                            {filteredCommands.length > 0 ? (
                                <div className="space-y-1">
                                    {filteredCommands.map((command, index) => (
                                        <button
                                            key={command.id}
                                            onClick={command.action}
                                            onMouseEnter={() => setSelectedIndex(index)}
                                            className={`w-full flex items-center gap-4 px-3 py-3 rounded-xl transition-all group ${
                                                selectedIndex === index 
                                                    ? 'bg-[var(--accent-teal)] text-white shadow-lg shadow-[var(--accent-teal)]/20' 
                                                    : 'text-gray-400 hover:bg-white/5'
                                            }`}
                                        >
                                            <div className={`p-2 rounded-lg ${selectedIndex === index ? 'bg-white/20' : 'bg-white/5 group-hover:bg-white/10'}`}>
                                                <command.icon className="w-5 h-5" />
                                            </div>
                                            <div className="flex-1 text-left">
                                                <div className={`font-bold text-sm ${selectedIndex === index ? 'text-white' : 'text-gray-200'}`}>
                                                    {command.title}
                                                </div>
                                                <div className={`text-xs ${selectedIndex === index ? 'text-white/80' : 'text-gray-500'}`}>
                                                    {command.description}
                                                </div>
                                            </div>
                                            {command.shortcut && (
                                                <div className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${selectedIndex === index ? 'bg-white/20' : 'bg-white/5'}`}>
                                                    {command.shortcut}
                                                </div>
                                            )}
                                            {selectedIndex === index && (
                                                <ArrowRight className="w-4 h-4 text-white/50" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-12 text-center text-gray-500">
                                    <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-20" />
                                    <p className="text-sm">No commands found for "{query}"</p>
                                </div>
                            )}
                        </div>

                        <div className="px-4 py-3 bg-black/40 border-t border-white/5 flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            <div className="flex gap-4">
                                <span className="flex items-center gap-1"><kbd className="bg-white/5 px-1 rounded">↵</kbd> Select</span>
                                <span className="flex items-center gap-1"><kbd className="bg-white/5 px-1 rounded">↑↓</kbd> Navigate</span>
                            </div>
                            <div>
                                Press <kbd className="bg-white/5 px-1 rounded">Esc</kbd> to close
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}
