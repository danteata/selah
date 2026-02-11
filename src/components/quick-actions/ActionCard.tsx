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
        w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all
        ${isFocused
                    ? 'bg-primary-50 dark:bg-primary-900 ring-2 ring-primary-500'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                }
      `}
        >
            <div className={`
        flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center
        ${action.tier === 'teams'
                    ? 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300'
                    : 'bg-primary-100 text-primary-600 dark:bg-primary-900 dark:text-primary-300'
                }
      `}>
                <Icon className="w-5 h-5" />
            </div>

            <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 dark:text-white truncate">
                    {action.name}
                    {action.tier === 'teams' && (
                        <span className="ml-2 text-xs px-2 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 rounded-full">
                            Teams
                        </span>
                    )}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {action.desc}
                </p>
            </div>
        </button>
    )
}
