import { Image, Film } from 'lucide-react'

interface LocalMediaPlaceholderProps {
    backgroundType?: string
    className?: string
}

/**
 * Shown in place of a media slide's thumbnail when this device can't
 * resolve it — no `backgroundStorageId` (not cloud-synced) and no local
 * copy here either. Most commonly: a collaborator viewing another
 * operator's locally-stored (free-tier) media. The slide is still fully
 * usable — selectable, queueable, promotable to live — this only replaces
 * the preview so it's clear there's content here that just isn't visible
 * on this device, rather than looking like an empty/broken slide.
 */
export function LocalMediaPlaceholder({ backgroundType, className = '' }: LocalMediaPlaceholderProps) {
    const Icon = backgroundType === 'video' ? Film : Image

    return (
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gray-800/60 text-gray-400 ${className}`}>
            <Icon className="w-5 h-5 opacity-60" />
            <span className="text-[9px] font-medium uppercase tracking-wide opacity-75">Local media</span>
        </div>
    )
}
