import { X, Music, Zap } from 'lucide-react'
import type { SongVerseBrowserEntry } from '../preview/groupQueueItems'

interface SongVerseBrowserProps {
    songTitle: string
    artist?: string
    verses: SongVerseBrowserEntry[]
    liveSlideId: string | null
    onSelectVerse: (slideId: string) => void
    onClose: () => void
}

/**
 * Chapter-style browsing panel for a song already sitting in the slide
 * queue — modeled on BibleList's "load the whole chapter, click a verse to
 * go live" interaction, but simpler: every verse here is already a fully
 * materialized Slide (createSongSlides built one per verse up front), so
 * there's no fetch/search step — a click is just `setLiveSlide` on an
 * existing id, no slide construction needed.
 *
 * Exists so the operator can jump to any verse of a song WITHOUT that song's
 * N verse-slides needing to be visible (and cluttering) the main queue list —
 * see the collapsed song group row in PreviewContent.tsx, which opens this.
 */
export function SongVerseBrowser({ songTitle, artist, verses, liveSlideId, onSelectVerse, onClose }: SongVerseBrowserProps) {
    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl shadow-2xl w-full max-w-md max-h-[85%] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-2 min-w-0">
                        <Music className="w-4 h-4 text-[var(--accent-teal)] flex-shrink-0" />
                        <div className="min-w-0">
                            <h3 className="font-semibold text-sm text-[var(--text-primary)] truncate">{songTitle}</h3>
                            {artist && <p className="text-xs text-[var(--text-muted)] truncate">{artist}</p>}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors flex-shrink-0"
                        title="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 custom-scrollbar">
                    {verses.map(({ slide }) => {
                        const isLive = liveSlideId === slide.id
                        return (
                            <button
                                key={slide.id}
                                onClick={() => onSelectVerse(slide.id)}
                                className={`text-left p-2.5 rounded-lg border transition-colors ${isLive
                                    ? 'border-red-500/40 bg-red-500/10'
                                    : 'border-transparent hover:bg-[var(--bg-tertiary)]/70'
                                    }`}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-semibold ${isLive ? 'text-red-500' : 'text-[var(--accent-teal)]'}`}>
                                        {slide.verseLabel || `Verse ${(slide.verseIndex ?? 0) + 1}`}
                                    </span>
                                    {isLive && (
                                        <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-500">
                                            <Zap className="w-2.5 h-2.5" />
                                            LIVE
                                        </span>
                                    )}
                                </div>
                                <div
                                    className="text-xs text-[var(--text-secondary)] line-clamp-2 [&_*]:!text-xs [&_*]:!leading-snug"
                                    dangerouslySetInnerHTML={{ __html: slide.contents[0] || '' }}
                                />
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
