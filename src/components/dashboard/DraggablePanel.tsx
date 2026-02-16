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
    accentColor = 'blue',
}: DraggablePanelProps) {
    const [isHovered, setIsHovered] = useState(false)
    const [showMenu, setShowMenu] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)

    // Accent color mappings
    const accentColors: Record<string, { bg: string; border: string; text: string; headerAccent: string }> = {
        blue: {
            bg: 'bg-blue-500/10',
            border: 'border-blue-400/40',
            text: 'text-blue-500',
            headerAccent: 'from-blue-500/8 to-transparent',
        },
        purple: {
            bg: 'bg-purple-500/10',
            border: 'border-purple-400/40',
            text: 'text-purple-500',
            headerAccent: 'from-purple-500/8 to-transparent',
        },
        emerald: {
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-400/40',
            text: 'text-emerald-500',
            headerAccent: 'from-emerald-500/8 to-transparent',
        },
        amber: {
            bg: 'bg-amber-500/10',
            border: 'border-amber-400/40',
            text: 'text-amber-500',
            headerAccent: 'from-amber-500/8 to-transparent',
        },
        rose: {
            bg: 'bg-rose-500/10',
            border: 'border-rose-400/40',
            text: 'text-rose-500',
            headerAccent: 'from-rose-500/8 to-transparent',
        },
    }

    const colors = accentColors[accentColor] || accentColors.blue

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
                bg-white dark:bg-gray-900/95
                rounded-xl
                border border-gray-200/60 dark:border-gray-700/60
                shadow-sm
                transition-shadow duration-200 ease-out
                ${isHovered ? `shadow-md ${colors.border}` : ''}
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
                    px-3 py-2
                    bg-gradient-to-r ${isHovered ? colors.headerAccent : 'from-gray-50/60 to-transparent dark:from-gray-800/40 dark:to-transparent'}
                    ${!isCollapsed ? 'border-b border-gray-100 dark:border-gray-800/60' : ''}
                    cursor-move
                    select-none
                    transition-all duration-200
                    flex-shrink-0
                `}
            >
                {/* Left: Drag Handle + Icon + Title */}
                <div className="flex items-center gap-2 min-w-0">
                    <div className="text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-400 transition-colors cursor-grab active:cursor-grabbing flex-shrink-0">
                        <GripVertical className="w-3.5 h-3.5" />
                    </div>

                    <div className={`${colors.text} flex-shrink-0`}>
                        {icon}
                    </div>

                    <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 truncate">
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
                                p-1 rounded-md
                                text-gray-400 dark:text-gray-500
                                hover:text-gray-600 dark:hover:text-gray-300
                                hover:bg-gray-100/80 dark:hover:bg-gray-800/80
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
                                    p-1 rounded-md
                                    text-gray-400 dark:text-gray-500
                                    hover:text-gray-600 dark:hover:text-gray-300
                                    hover:bg-gray-100/80 dark:hover:bg-gray-800/80
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
                                        p-1 rounded-md
                                        text-gray-400 dark:text-gray-500
                                        hover:text-gray-600 dark:hover:text-gray-300
                                        hover:bg-gray-100/80 dark:hover:bg-gray-800/80
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
                                            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[130px]">
                                                <button
                                                    onClick={() => {
                                                        onCollapse?.()
                                                        setShowMenu(false)
                                                    }}
                                                    className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
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
                                                        className="w-full px-3 py-1.5 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
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
                                p-1 rounded-md
                                text-gray-400 dark:text-gray-500
                                hover:text-red-500 dark:hover:text-red-400
                                hover:bg-red-50 dark:hover:bg-red-900/20
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