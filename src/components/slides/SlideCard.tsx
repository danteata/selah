import { forwardRef } from 'react'
import { Trash2, Copy, Bookmark, Pencil, Zap, Lightbulb, Layers } from 'lucide-react'
import type { Slide } from '../../types'
import { SlideChip } from './SlideChip'
import { LocalMediaPlaceholder } from './LocalMediaPlaceholder'
import { VideoThumbnail } from '../media/VideoThumbnail'
import { useFileUrl } from '../../hooks/useTemplates'
import { useLocalBackground } from '../../hooks/useLocalBackground'
import { useLocalMediaBlobUrl } from '../../hooks/useLocalMediaBlobUrl'
import { getObjectFit, getBackgroundSize } from '../../utils/mediaFit'
import { slideCaptionHtml } from '../../utils/slideCaption'
import { useAppStore } from '../../store/appStore'

interface SlideCardProps {
    slide: Slide
    isActive?: boolean
    isLive?: boolean
    isSelected?: boolean
    selectable?: boolean
    isStickyActive?: boolean
    onClick: () => void
    onDuplicate: () => void
    onDelete: () => void
    onEdit?: () => void
    onSaveToLibrary?: () => void
    isSaved?: boolean
    onGoLive?: () => void
    onSuggestToQueue?: () => void
    /** Put this slide on the alternate output. Offered only while that output
     *  carries its own content rather than following the live one. */
    onSendToAlternate?: () => void
    /** This slide is the one currently on the alternate output. */
    isOnAlternate?: boolean
    lockedBy?: string
}

export const SlideCard = forwardRef<HTMLDivElement, SlideCardProps>(({
    slide,
    isActive = false,
    isLive = false,
    isSelected = false,
    selectable = false,
    isStickyActive = false,
    onClick,
    onDuplicate,
    onDelete,
    onEdit,
    onSaveToLibrary,
    isSaved = false,
    onGoLive,
    onSuggestToQueue,
    onSendToAlternate,
    isOnAlternate,
    lockedBy,
}: SlideCardProps, ref) => {
    // Get file URL if slide has a backgroundStorageId
    const fileUrl = useFileUrl(slide.backgroundStorageId || null)

    // Resolve local file paths on desktop
    const localBg = useLocalBackground(slide.background, slide.localFilePath)

    // Resolve a local IndexedDB-backed media library item on web
    const localMediaBlobUrl = useLocalMediaBlobUrl(slide.localMediaId)

    // Determine the background to use
    const backgroundUrl = fileUrl || localBg || localMediaBlobUrl
    const isUnresolvedLocalMedia = slide.type === 'media' && !backgroundUrl

    // Media slides (the actual picture/video, not a decorative backdrop
    // behind text) respect the operator's fit/crop/stretch choice; every
    // other slide type keeps the deliberate "always cover" backdrop fill.
    const isMediaSlide = slide.type === 'media'
    const fillType = slide.slideStyle?.backgroundFillType

    // Per-slide font, falling back to the user's global default so the
    // queue preview actually reflects the font they'll see on stage.
    const defaultFont = useAppStore((state) => state.settings.defaultFont)
    const slideFont = slide.slideStyle?.font || defaultFont || 'Inter'

    // Check if this is a video background
    const isVideoBackground = slide.backgroundType === 'video' && backgroundUrl

    // Bible and dictionary slides have a separate caption (contents[1]) that can sit above or below the body.
    const previewRefHtml = slideCaptionHtml(slide)
    const hasCaption = !!previewRefHtml
    const globalVerseRefPosition = useAppStore((state) => state.settings.slideStyles?.verseRefPosition)
    const effectiveRefPos = slide.slideStyle?.verseRefPosition ?? globalVerseRefPosition ?? 'bottom'
    const refOnTop = hasCaption && effectiveRefPos === 'top'

    const previewBodyHtml = slide.contents[0] || ''

    const cardFontSize = (() => {
        const measuringText = previewBodyHtml + previewRefHtml
        const len = measuringText?.length || 0
        if (len === 0) return '0.75rem'
        if (len < 100) return '0.75rem'
        if (len < 200) return '0.7rem'
        if (len < 400) return '0.6rem'
        if (len < 700) return '0.5rem'
        return '0.45rem'
    })()

    return (
        <div
            ref={ref}
            onClick={onClick}
            className={`
        relative group flex-shrink-0 cursor-pointer rounded-xl border transition-all overflow-hidden
        ${isStickyActive ? 'sticky top-0 z-10 bg-[var(--bg-secondary)]' : ''}
        ${isLive
                    ? 'border-red-500/45 bg-red-500/[0.03] shadow-lg shadow-red-500/10'
                    : isActive
                        ? 'border-[var(--accent-teal)]/45 bg-[var(--accent-teal)]/[0.04] shadow-lg shadow-[var(--accent-teal)]/10'
                        : 'border-[var(--border-subtle)] hover:border-[var(--border-emphasis)] bg-[var(--bg-secondary)]/70 hover:bg-[var(--bg-secondary)]'
                }
        ${isSelected ? 'ring-1 ring-[var(--accent-teal)]/35' : ''}
      `}
        >
            {(isLive || isActive) && (
                <div className={`absolute inset-y-0 left-0 z-20 w-1 ${isLive ? 'bg-red-500' : 'bg-[var(--accent-teal)]'}`} />
            )}

            {/* Live indicator */}
            {isLive && (
                <div className="absolute top-2 left-2 z-30 flex items-center gap-1 px-2 py-0.5 bg-red-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-lg shadow-red-500/20">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    LIVE
                </div>
            )}

            {/* Locked indicator */}
            {lockedBy && (
                <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 bg-amber-500 text-white text-xs font-medium rounded-full"
                    title={`This slide is being edited by another user`}
                >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Editing
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
                    backgroundImage: !isVideoBackground && backgroundUrl ? `url(${backgroundUrl})` : undefined,
                    backgroundSize: isMediaSlide ? getBackgroundSize(fillType) : 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    backgroundColor: !backgroundUrl ? '#1f2937' : undefined,
                }}
            >
                {isUnresolvedLocalMedia && (
                    <LocalMediaPlaceholder backgroundType={slide.backgroundType} />
                )}

                {/* Video thumbnail — a static first frame, not a playing video (dozens of
                    autoplaying loops in a long queue is both distracting and wasteful) */}
                {isVideoBackground && (
                    <VideoThumbnail
                        src={backgroundUrl}
                        className="absolute inset-0 w-full h-full"
                        style={{ objectFit: isMediaSlide ? getObjectFit(fillType) : 'cover' }}
                    />
                )}
                {slide.contents[0] && slide.contents[0] !== '<p></p>' && slide.contents[0] !== '' && (
                    slide.layout === 'lower-third' ? (
                        <div className="absolute inset-x-0 bottom-0" style={{ height: '30%' }}>
                            <div
                                className="w-full h-full flex flex-col justify-center px-3 py-1.5"
                                style={{
                                    gap: '2px',
                                    background: slide.slideStyle?.lowerThirdStyle === 'minimalist' ? 'transparent'
                                        : slide.slideStyle?.lowerThirdStyle === 'gradient-bar'
                                            ? `linear-gradient(135deg, ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}ee, ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}88)`
                                            : 'rgba(0,0,0,0.75)',
                                    borderLeft: slide.slideStyle?.lowerThirdStyle === 'accent-bar'
                                        ? `3px solid ${slide.slideStyle?.lowerThirdAccentColor || '#0d9488'}`
                                        : undefined,
                                    textAlign: (slide.slideStyle?.lowerThirdPosition as 'left' | 'center' | 'right') || 'left',
                                }}
                            >
                                <div
                                    className="text-white text-[10px] font-semibold line-clamp-2 drop-shadow-lg tiptap-preview"
                                    style={{ lineHeight: 1.2, fontFamily: slideFont }}
                                    dangerouslySetInnerHTML={{ __html: previewBodyHtml }}
                                />
                                {previewRefHtml && (
                                    <div
                                        className="text-white/80 text-[8px] line-clamp-1 drop-shadow-lg tiptap-preview"
                                        style={{ fontFamily: slideFont }}
                                        dangerouslySetInnerHTML={{ __html: previewRefHtml }}
                                    />
                                )}
                                {!previewRefHtml && slide.slideStyle?.lowerThirdSubtitle && (
                                    <div className="text-white/70 text-[8px] line-clamp-1">
                                        {slide.slideStyle.lowerThirdSubtitle}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-2 gap-1">
                            {refOnTop && previewRefHtml && (
                                <div
                                    className="text-white/80 text-center drop-shadow-lg tiptap-preview line-clamp-1 font-semibold"
                                    style={{ fontSize: `calc(${cardFontSize} * 0.85)`, fontFamily: slideFont }}
                                    dangerouslySetInnerHTML={{ __html: previewRefHtml }}
                                />
                            )}
                            <div
                                className="text-white text-center drop-shadow-lg tiptap-preview"
                                style={{ fontSize: cardFontSize, fontFamily: slideFont }}
                                dangerouslySetInnerHTML={{ __html: previewBodyHtml }}
                            />
                            {!refOnTop && previewRefHtml && (
                                <div
                                    className="text-white/80 text-center drop-shadow-lg tiptap-preview line-clamp-1 font-semibold"
                                    style={{ fontSize: `calc(${cardFontSize} * 0.85)`, fontFamily: slideFont }}
                                    dangerouslySetInnerHTML={{ __html: previewRefHtml }}
                                />
                            )}
                        </div>
                    )
                )}

                {/* Quick Present button. Always visible on the active/selected
                    card (so it's discoverable and works on touch, where there's
                    no hover); hover-revealed on the others. */}
                {onGoLive && !isLive && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onGoLive(); }}
                        className={`absolute top-2 right-2 z-10 p-2 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-lg transition-all transform ${
                            isActive
                                ? 'opacity-100 scale-100'
                                : 'opacity-0 group-hover:opacity-100 focus:opacity-100 scale-90 group-hover:scale-100'
                        }`}
                        title="Send to Live"
                    >
                        <Zap className="w-4 h-4" />
                    </button>
                )}
                {onSendToAlternate && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onSendToAlternate(); }}
                        className={`absolute bottom-2 right-2 z-10 p-2 rounded-full shadow-lg transition-all transform ${
                            isOnAlternate
                                ? 'bg-[var(--accent-indigo)] text-white opacity-100 scale-100'
                                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--accent-indigo)] opacity-0 group-hover:opacity-100 focus:opacity-100 scale-90 group-hover:scale-100'
                        }`}
                        title={isOnAlternate ? 'On the alternate output — click to remove' : 'Send to the alternate output'}
                    >
                        <Layers className="w-4 h-4" />
                    </button>
                )}
                {onSuggestToQueue && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onSuggestToQueue(); }}
                        className="absolute top-2 left-2 z-10 p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all transform scale-90 group-hover:scale-100"
                        title="Suggest to queue"
                    >
                        <Lightbulb className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Slide info and actions */}
            <div className="p-3">
                <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm text-[var(--text-primary)] truncate flex-1">
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
                        {/* Show verse indicator for song/hymn slides */}
                        {slide.verseLabel && slide.totalVerses && (
                            <span className="text-xs text-primary-600 dark:text-primary-400 font-medium">
                                {slide.verseLabel} {slide.totalVerses > 1 && `(${slide.verseIndex! + 1}/${slide.totalVerses})`}
                            </span>
                        )}
                        <span className="text-xs text-[var(--text-muted)] tabular-nums">
                            #{slide.index + 1}
                        </span>
                    </div>

                    {/* Slide actions — always visible for discoverability */}
                    <div className="flex items-center gap-1">
                        {onEdit && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                                title="Edit"
                            >
                                <Pencil className="w-3.5 h-3.5 text-[var(--text-tertiary)] hover:text-[var(--accent-teal)]" />
                            </button>
                        )}
                        {onSaveToLibrary && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onSaveToLibrary(); }}
                                className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                                title={isSaved ? 'Already in Library' : 'Save to Library'}
                            >
                                <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'text-[var(--accent-teal)]' : 'text-[var(--text-tertiary)]'}`} />
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                            title="Duplicate"
                        >
                            <Copy className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                            className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
                            title="Delete"
                        >
                            <Trash2 className="w-3.5 h-3.5 text-red-500/75" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
})
SlideCard.displayName = 'SlideCard'
