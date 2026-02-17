import { useState, useCallback, useRef, useEffect } from 'react'
import {
    ChevronDown,
    ChevronUp,
    X,
    GripVertical,
    Maximize2,
    Minimize2,
    MoreHorizontal
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { PanelId } from '../../types/dashboard'

interface DraggablePanelProps {
    id: PanelId
    title: string
    icon: React.ReactNode
    children: React.ReactNode
    isCollapsed?: boolean
    isClosable?: boolean
    onClose?: () => void
    onCollapse?: () => void
    className?: string
    accentColor?: string
}

export function DraggablePanel({
    id,
    title,
    icon,
    children,
    isCollapsed = false,
    isClosable = false,
    onClose,
    onCollapse,
    className = '',
    accentColor = 'teal',
}: DraggablePanelProps) {
    const [isHovered, setIsHovered] = useState(false)
    const [showMenu, setShowMenu] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)

    // Refined accent color mappings - subtle, not garish
    const accentColors: Record<string, {
        indicator: string;
        hoverBg: string;
        text: string;
        ring: string;
        glow: string;
    }> = {
        teal: {
            indicator: 'bg-[var(--accent-teal)]',
            hoverBg: 'hover:bg-[var(--accent-teal)]/5',
            text: 'text-[var(--accent-teal)]',
            ring: 'ring-[var(--accent-teal)]/20',
            glow: 'shadow-[var(--accent-teal)]/10',
        },
        amber: {
            indicator: 'bg-[var(--accent-amber)]',
            hoverBg: 'hover:bg-[var(--accent-amber)]/5',
            text: 'text-[var(--accent-amber)]',
            ring: 'ring-[var(--accent-amber)]/20',
            glow: 'shadow-[var(--accent-amber)]/10',
        },
        rose: {
            indicator: 'bg-[var(--accent-rose)]',
            hoverBg: 'hover:bg-[var(--accent-rose)]/5',
            text: 'text-[var(--accent-rose)]',
            ring: 'ring-[var(--accent-rose)]/20',
            glow: 'shadow-[var(--accent-rose)]/10',
        },
        indigo: {
            indicator: 'bg-[var(--accent-indigo)]',
            hoverBg: 'hover:bg-[var(--accent-indigo)]/5',
            text: 'text-[var(--accent-indigo)]',
            ring: 'ring-[var(--accent-indigo)]/20',
            glow: 'shadow-[var(--accent-indigo)]/10',
        },
        emerald: {
            indicator: 'bg-[var(--accent-emerald)]',
            hoverBg: 'hover:bg-[var(--accent-emerald)]/5',
            text: 'text-[var(--accent-emerald)]',
            ring: 'ring-[var(--accent-emerald)]/20',
            glow: 'shadow-[var(--accent-emerald)]/10',
        },
    }

    const colors = accentColors[accentColor] || accentColors.teal

    const handleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            panelRef.current?.requestFullscreen()
            setIsFullscreen(true)
        } else {
            document.exitFullscreen()
            setIsFullscreen(false)
        }
    }, [])

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }
        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    // Close the dropdown when clicking outside
    useEffect(() => {
        if (!showMenu) return
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setShowMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showMenu])

    return (
        <div
            ref={panelRef}
            className={`
                draggable-panel
                ${isCollapsed ? 'draggable-panel--collapsed' : ''}
                h-full flex flex-col
                bg-[var(--bg-secondary)]
                rounded-xl
                border border-[var(--border-default)]
                shadow-sm
                transition-all duration-200 ease-out
                ${isHovered ? `shadow-md ring-1 ${colors.ring}` : ''}
                ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''}
                ${className}
                overflow-hidden
            `}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Panel Header — always visible, acts as drag handle */}
            <div
                className={`
                    flex items-center justify-between
                    px-3 py-2.5
                    bg-[var(--bg-tertiary)]/50
                    ${!isCollapsed ? 'border-b border-[var(--border-subtle)]' : ''}
                    cursor-move
                    select-none
                    transition-all duration-200
                    flex-shrink-0
                    group
                `}
            >
                {/* Left: Drag Handle + Icon + Title */}
                <div className="flex items-center gap-2.5 min-w-0">
                    {/* Accent indicator */}
                    <div className={`w-1 h-4 rounded-full ${colors.indicator} opacity-80`} />

                    <div className="text-[var(--text-muted)] group-hover:text-[var(--text-tertiary)] transition-colors cursor-grab active:cursor-grabbing flex-shrink-0">
                        <GripVertical className="w-3.5 h-3.5" />
                    </div>

                    <div className={`${colors.text} flex-shrink-0`}>
                        {icon}
                    </div>

                    <h3 className="text-xs font-medium text-[var(--text-secondary)] truncate tracking-wide">
                        {title}
                    </h3>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                    {/* Collapse/Expand Button */}
                    {onCollapse && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onCollapse()
                            }}
                            className="
                                p-1.5 rounded-md
                                text-[var(--text-muted)]
                                hover:text-[var(--text-secondary)]
                                hover:bg-[var(--bg-tertiary)]
                                transition-all duration-150
                            "
                            title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
                        >
                            {isCollapsed ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                                <ChevronUp className="w-3.5 h-3.5" />
                            )}
                        </button>
                    )}

                    {/* Only show these controls when expanded */}
                    {!isCollapsed && (
                        <>
                            {/* Fullscreen Button */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleFullscreen()
                                }}
                                className="
                                    p-1.5 rounded-md
                                    text-[var(--text-muted)]
                                    hover:text-[var(--text-secondary)]
                                    hover:bg-[var(--bg-tertiary)]
                                    transition-all duration-150
                                "
                                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                            >
                                {isFullscreen ? (
                                    <Minimize2 className="w-3.5 h-3.5" />
                                ) : (
                                    <Maximize2 className="w-3.5 h-3.5" />
                                )}
                            </button>

                            {/* More Options */}
                            <div className="relative">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setShowMenu(!showMenu)
                                    }}
                                    className="
                                        p-1.5 rounded-md
                                        text-[var(--text-muted)]
                                        hover:text-[var(--text-secondary)]
                                        hover:bg-[var(--bg-tertiary)]
                                        transition-all duration-150
                                    "
                                >
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                </button>

                                {/* Dropdown Menu */}
                                <AnimatePresence>
                                    {showMenu && (
                                        <motion.div
                                            initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                            transition={{ duration: 0.12 }}
                                            className="absolute right-0 top-full mt-1 z-50"
                                        >
                                            <div className="bg-[var(--bg-elevated)] rounded-lg shadow-lg border border-[var(--border-default)] py-1 min-w-[130px]">
                                                <button
                                                    onClick={() => {
                                                        onCollapse?.()
                                                        setShowMenu(false)
                                                    }}
                                                    className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
                                                >
                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                    Collapse
                                                </button>
                                                {isClosable && onClose && (
                                                    <button
                                                        onClick={() => {
                                                            onClose()
                                                            setShowMenu(false)
                                                        }}
                                                        className="w-full px-3 py-1.5 text-left text-xs text-[var(--accent-rose)] hover:bg-[var(--accent-rose)]/5 flex items-center gap-2"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                        Close Panel
                                                    </button>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </>
                    )}

                    {/* Close Button — visible when closable, even when collapsed */}
                    {isClosable && onClose && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onClose()
                            }}
                            className="
                                p-1.5 rounded-md
                                text-[var(--text-muted)]
                                hover:text-[var(--accent-rose)]
                                hover:bg-[var(--accent-rose)]/5
                                transition-all duration-150
                            "
                            title="Close panel"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Panel Content — only rendered when expanded */}
            <AnimatePresence initial={false}>
                {!isCollapsed && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className="flex-1 min-h-0 overflow-y-auto"
                    >
                        <div className="p-3">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
