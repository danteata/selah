import type { LucideIcon } from 'lucide-react'
import { Activity, Plus, FileText, Music, Users, Settings, MoreVertical, Edit, Trash, Eye, EyeOff, RefreshCw, Play, Pause, SkipForward, ChevronDown, ChevronUp, Heart, Star, Search, X, Check, Clock, Calendar, Image, Video, Volume2, VolumeX } from 'lucide-react'
import clsx from 'clsx'

interface IconWrapperProps {
    name: string
    size?: number | string
    className?: string
    roundedBg?: boolean
    animate?: boolean
    darkText?: boolean
}

// Map icon names to Lucide icons
const iconMap: Record<string, LucideIcon> = {
    'i-bx-plus': Plus,
    'i-bx-file': FileText,
    'i-bx-music': Music,
    'i-bx-users': Users,
    'i-bx-cog': Settings,
    'i-bx-dots-vertical-rounded': MoreVertical,
    'i-bx-edit': Edit,
    'i-tabler-trash': Trash,
    'i-tabler-eye': Eye,
    'i-tabler-eye-off': EyeOff,
    'i-tabler-refresh': RefreshCw,
    'i-tabler-play': Play,
    'i-tabler-pause': Pause,
    'i-tabler-player-skip-forward': SkipForward,
    'i-bx-chevron-down': ChevronDown,
    'i-bx-chevron-up': ChevronUp,
    'i-bxs-heart': Heart,
    'i-bx-star': Star,
    'i-bx-search': Search,
    'i-bx-x': X,
    'i-bx-check': Check,
    'i-bx-time': Clock,
    'i-bx-calendar': Calendar,
    'i-bx-image': Image,
    'i-bx-video': Video,
    'i-tabler-volume': Volume2,
    'i-tabler-volume-off': VolumeX,
    // Add more mappings as needed
}

export function IconWrapper({
    name,
    size = 6,
    className,
    roundedBg = false,
    animate = false,
    darkText = false
}: IconWrapperProps) {
    const IconComponent = iconMap[name] || Activity // Default fallback

    const sizeClass = typeof size === 'string' ? `w-${size} h-${size}` : `w-${size} h-${size}`

    return (
        <div
            className={clsx(
                roundedBg && "icon-bg bg-primary-50 dark:bg-primary-900 rounded-full flex items-center justify-center p-2",
                !roundedBg && "flex",
                className
            )}
        >
            <IconComponent
                className={clsx(
                    sizeClass,
                    animate && "animate-ping",
                    darkText && "dark:text-primary-950"
                )}
            />
        </div>
    )
}
