import { Trash2, Copy, Eye, GripVertical } from 'lucide-react'
import type { Slide } from '../../types'
import { SlideChip } from './SlideChip'

interface SlideCardProps {
    slide: Slide
    isActive?: boolean
    isLive?: boolean
    isSelected?: boolean
    selectable?: boolean
    onClick: () => void
    onDuplicate: () => void
    onDelete: () => void
}

export function SlideCard({
    slide,
    isActive = false,
    isLive = false,
    isSelected = false,
    selectable = false,
    onClick,
    onDuplicate,
    onDelete,
}: SlideCardProps) {
    return (
        <div
            onClick={onClick}
            className={`
        relative group cursor-pointer rounded-lg border-2 transition-all overflow-hidden
        ${isLive
                    ? 'border-red-500 ring-2 ring-red-200 dark:ring-red-900'
                    : isActive
                        ? 'border-primary-500 ring-2 ring-primary-200 dark:ring-primary-900'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }
        ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-white dark:bg-gray-800'}
      `}
        >
            {/* Live indicator */}
            {isLive && (
                <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded-full">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    LIVE
                </div>
            )}

            {/* Slide preview */}
            <div
                className="aspect-video relative overflow-hidden"
                style={{
                    backgroundImage: slide.background ? `url(${slide.background})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundColor: !slide.background ? '#1f2937' : undefined,
                }}
            >
                {slide.contents[0] && (
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div
                            className="text-white text-xs text-center line-clamp-3 drop-shadow-lg tiptap-preview"
                            dangerouslySetInnerHTML={{ __html: slide.contents[0] }}
                        />
                    </div>
                )}

                {/* Hover actions */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                        className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                        title="Duplicate"
                    >
                        <Copy className="w-4 h-4 text-gray-700" />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="p-2 bg-white rounded-full hover:bg-red-50 transition-colors"
                        title="Delete"
                    >
                        <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                </div>
            </div>

            {/* Slide info */}
            <div className="p-3">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm text-gray-900 dark:text-white truncate">
                        {slide.name}
                    </h4>
                    {selectable && (
                        <div className={`
              w-5 h-5 rounded border-2 flex items-center justify-center
              ${isSelected
                                ? 'bg-primary-500 border-primary-500'
                                : 'border-gray-300 dark:border-gray-600'
                            }
            `}>
                            {isSelected && <span className="text-white text-xs">✓</span>}
                        </div>
                    )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                    <SlideChip slideType={slide.type} />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                        #{slide.index + 1}
                    </span>
                </div>
            </div>
        </div>
    )
}
