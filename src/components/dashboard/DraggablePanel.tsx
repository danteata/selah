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

    // Accent color mappings for visual distinction
    const accentColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
        blue: {
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/30',
            text: 'text-blue-400',
            glow: 'shadow-blue-500/20',
        },
        purple: {
            bg: 'bg-purple-500/10',
            border: 'border-purple-500/30',
            text: 'text-purple-400',
            glow: 'shadow-purple-500/20',
        },
        emerald: {
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/30',
            text: 'text-emerald-400',
            glow: 'shadow-emerald-500/20',
        },
        amber: {
            bg: 'bg-amber-500/10',
            border: 'border-amber-500/30',
            text: 'text-amber-400',
            glow: 'shadow-amber-500/20',
        },
        rose: {
            bg: 'bg-rose-500/10',
            border: 'border-rose-500/30',
            text: 'text-rose-400',
            glow: 'shadow-rose-500/20',
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

    return (
        <div
            ref={panelRef}
            className={`
        h-full flex flex-col
        bg-white/80 dark:bg-gray-900/80
        backdrop-blur-xl
        rounded-2xl
        border border-gray-200/50 dark:border-gray-700/50
        shadow-lg shadow-gray-200/20 dark:shadow-black/30
        transition-all duration-300 ease-out
        hover:shadow-xl hover:shadow-gray-200/30 dark:hover:shadow-black/40
        ${isHovered ? `${colors.border}` : ''}
        ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''}
        ${className}
      `}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Panel Header */}
            <div
                className={`
          flex items-center justify-between
          px-4 py-3
          bg-gradient-to-r from-gray-50/80 to-transparent
          dark:from-gray-800/50 dark:to-transparent
          border-b border-gray-100 dark:border-gray-800
          rounded-t-2xl
          cursor-move
          select-none
          transition-colors duration-200
          ${isHovered ? `${colors.bg}` : ''}
        `}
            >
                {/* Left: Drag Handle + Icon + Title */}
                <div className="flex items-center gap-3">
                    {/* Drag Handle */}
                    <div
                        className={`
              flex items-center justify-center
              w-6 h-6
              text-gray-400 dark:text-gray-500
              hover:text-gray-600 dark:hover:text-gray-300
              transition-colors duration-200
              cursor-grab active:cursor-grabbing
            `}
                    >
                        <GripVertical className="w-4 h-4" />
                    </div>

                    {/* Icon */}
                    <div className={`${colors.text}`}>
                        {icon}
                    </div>

                    {/* Title */}
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 tracking-wide">
                        {title}
                    </h3>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1">
                    {/* Collapse Button */}
                    {onCollapse && (
                        <button
                            onClick={onCollapse}
                            className={`
                p-1.5 rounded-lg
                text-gray-400 dark:text-gray-500
                hover:text-gray-600 dark:hover:text-gray-300
                hover:bg-gray-100 dark:hover:bg-gray-800
                transition-all duration-200
              `}
                            title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
                        >
                            {isCollapsed ? (
                                <ChevronDown className="w-4 h-4" />
                            ) : (
                                <ChevronUp className="w-4 h-4" />
                            )}
                        </button>
                    )}

                    {/* Fullscreen Button */}
                    <button
                        onClick={handleFullscreen}
                        className={`
              p-1.5 rounded-lg
              text-gray-400 dark:text-gray-500
              hover:text-gray-600 dark:hover:text-gray-300
              hover:bg-gray-100 dark:hover:bg-gray-800
              transition-all duration-200
            `}
                        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                    >
                        {isFullscreen ? (
                            <Minimize2 className="w-4 h-4" />
                        ) : (
                            <Maximize2 className="w-4 h-4" />
                        )}
                    </button>

                    {/* More Options */}
                    <div className="relative">
                        <button
                            onClick={() => setShowMenu(!showMenu)}
                            className={`
                p-1.5 rounded-lg
                text-gray-400 dark:text-gray-500
                hover:text-gray-600 dark:hover:text-gray-300
                hover:bg-gray-100 dark:hover:bg-gray-800
                transition-all duration-200
              `}
                        >
                            <MoreHorizontal className="w-4 h-4" />
                        </button>

                        {/* Dropdown Menu */}
                        <AnimatePresence>
                            {showMenu && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute right-0 top-full mt-1 z-50"
                                >
                                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-1 min-w-[140px]">
                                        <button
                                            onClick={() => {
                                                onCollapse?.()
                                                setShowMenu(false)
                                            }}
                                            className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                        >
                                            {isCollapsed ? (
                                                <ChevronDown className="w-4 h-4" />
                                            ) : (
                                                <ChevronUp className="w-4 h-4" />
                                            )}
                                            {isCollapsed ? 'Expand' : 'Collapse'}
                                        </button>
                                        {isClosable && onClose && (
                                            <button
                                                onClick={() => {
                                                    onClose()
                                                    setShowMenu(false)
                                                }}
                                                className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                                            >
                                                <X className="w-4 h-4" />
                                                Close Panel
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Close Button */}
                    {isClosable && onClose && (
                        <button
                            onClick={onClose}
                            className={`
                p-1.5 rounded-lg
                text-gray-400 dark:text-gray-500
                hover:text-red-500 dark:hover:text-red-400
                hover:bg-red-50 dark:hover:bg-red-900/20
                transition-all duration-200
              `}
                            title="Close panel"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Panel Content */}
            <AnimatePresence initial={false}>
                {!isCollapsed && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="flex-1 overflow-hidden"
                    >
                        <div className="h-full overflow-auto p-4">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Collapsed State Indicator */}
            {isCollapsed && (
                <div className="flex-1 flex items-center justify-center py-8">
                    <button
                        onClick={onCollapse}
                        className={`
              flex items-center gap-2 px-4 py-2
              text-sm text-gray-500 dark:text-gray-400
              bg-gray-100 dark:bg-gray-800
              rounded-lg
              hover:bg-gray-200 dark:hover:bg-gray-700
              transition-colors duration-200
            `}
                    >
                        <ChevronDown className="w-4 h-4" />
                        Expand {title}
                    </button>
                </div>
            )}

            {/* Hover Glow Effect */}
            {isHovered && !isCollapsed && (
                <div
                    className={`
            absolute inset-0 -z-10
            rounded-2xl
            opacity-0 pointer-events-none
            transition-opacity duration-300
            ${isHovered ? 'opacity-100' : ''}
          `}
                    style={{
                        boxShadow: `0 0 40px rgba(var(--accent-rgb, 59, 130, 246), 0.1)`,
                    }}
                />
            )}
        </div>
    )
}