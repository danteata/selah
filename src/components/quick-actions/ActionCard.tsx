import { BookOpen, Music, Church, Image, Bell, Clock, FileText, Library, Plus, Search, Settings, Users, Keyboard, Moon, Trash2 } from 'lucide-react'
import type { QuickAction } from '../../types'

interface ActionCardProps {
    action: QuickAction & { bibleChapterAndVerse?: string }
    dataActionIndex: number
    isFocused: boolean
    onClick: () => void
}

// Map icon names to Lucide components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    'i-bx-bible': BookOpen,
    'i-bx-search': Search,
    'i-bx-church': Church,
    'i-lucide-music-2': Music,
    'i-bx-library': Library,
    'i-bx-music': Music,
    'i-bx-text': FileText,
    'i-bx-image': Image,
    'i-bx-slideshow': FileText,
    'i-bx-bell': Bell,
    'i-bx-trash': Trash2,
    'i-bx-time': Clock,
    'i-mdi-youtube': PlayIcon,
    'i-mdi-vimeo': PlayIcon,
    'i-bx-cog': Settings,
    'i-bx-calendar-plus': Plus,
    'i-bx-moon': Moon,
    'i-bx-user-plus': Users,
    'i-bxs-keyboard': Keyboard,
}

function PlayIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
        </svg>
    )
}

export function ActionCard({ action, dataActionIndex, isFocused, onClick }: ActionCardProps) {
    const Icon = iconMap[action.icon] || FileText

    return (
        <button
            data-action-index={dataActionIndex}
            onClick={onClick}
            className={`
                w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left
                transition-all duration-150 group
                ${isFocused
                    ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-400/40'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                }
            `}
        >
            <div className={`
                flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
                transition-colors duration-150
                ${action.tier === 'teams'
                    ? 'bg-amber-100/80 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-blue-100/80 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400'
                }
            `}>
                <Icon className="w-3.5 h-3.5" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                        {action.name}
                    </span>
                    {action.tier === 'teams' && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 rounded-full font-semibold uppercase tracking-wider flex-shrink-0">
                            Pro
                        </span>
                    )}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate leading-tight">
                    {action.desc}
                </p>
            </div>
        </button>
    )
}
