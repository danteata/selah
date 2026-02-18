import { BookOpen, Music, Church, FileText, Image, Clock, PanelBottom, type LucideIcon } from 'lucide-react'

interface SlideChipProps {
    slideType: string
    className?: string
}

const typeConfig: Record<string, { label: string; icon: LucideIcon; color: string }> = {
    bible: {
        label: 'Bible',
        icon: BookOpen,
        color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    },
    hymn: {
        label: 'Hymn',
        icon: Church,
        color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    },
    song: {
        label: 'Song',
        icon: Music,
        color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    },
    text: {
        label: 'Text',
        icon: FileText,
        color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    },
    media: {
        label: 'Media',
        icon: Image,
        color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    },
    countdown: {
        label: 'Timer',
        icon: Clock,
        color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    },
    'lower-third': {
        label: 'Lower Third',
        icon: PanelBottom,
        color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
    },
}

export function SlideChip({ slideType, className = '' }: SlideChipProps) {
    const config = typeConfig[slideType] || typeConfig.text
    const Icon = config.icon

    return (
        <span className={`
      inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full
      ${config.color}
      ${className}
    `}>
            <Icon className="w-3 h-3" />
            {config.label}
        </span>
    )
}
