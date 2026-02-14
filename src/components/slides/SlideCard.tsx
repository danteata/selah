import { Trash2, Copy, Bookmark, Pencil } from 'lucide-react'
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
    onEdit?: () => void
    onSaveToLibrary?: () => void
    isSaved?: boolean
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
    onEdit,
    onSaveToLibrary,
    isSaved = false,
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

            {/* Saved indicator */}
            {isSaved && (
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 bg-primary-500 text-white text-xs font-medium rounded-full">
                    <Bookmark className="w-3 h-3" />
                    Saved
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
                {slide.contents[0] && slide.contents[0] !== '<p></p>' && slide.contents[0] !== '' && (
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div
                            className="text-white text-xs text-center line-clamp-3 drop-shadow-lg tiptap-preview"
                            dangerouslySetInnerHTML={{ __html: slide.contents[0] }}
                        />
                    </div>
                )}
            </div>

            {/* Slide info and actions */}
            <div className="p-3">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm text-gray-900 dark:text-white truncate flex-1">
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
                <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <SlideChip slideType={slide.type} />
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            #{slide.index + 1}
                        </span>
                    </div>

                    {/* Action buttons - always visible in the info section */}
                    <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {onEdit && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                                title="Edit"
                            >
                                <Pencil className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            </button>
                        )}
                        {onSaveToLibrary && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onSaveToLibrary(); }}
                                className="p-1.5 rounded hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
                                title={isSaved ? 'Already in Library' : 'Save to Library'}
                            >
                                <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400'}`} />
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            title="Duplicate"
                        >
                            <Copy className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                            title="Delete"
                        >
                            <Trash2 className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
