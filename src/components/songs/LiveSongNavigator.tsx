import { useMemo, useRef, useEffect } from 'react'
import { Music, Zap } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks/useLiveSession'
import type { Slide, Song } from '../../types'

/**
 * When a song is live, this sits at the top of the music panel and lets the
 * operator jump between that song's verses — the song analogue of BibleList's
 * neighbouring-verse navigation. Every verse is already a materialized slide
 * (createSongSlides builds one per verse), so selecting one is just
 * setLiveSlide on an existing id — no fetch, no slide construction.
 *
 * Renders nothing unless a song slide is currently live.
 */
export function LiveSongNavigator() {
    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const setLiveLocal = useAppStore((s) => s.setLiveSlide)
    const { isConnected, setLiveSlide: setLiveShared } = useLiveSession()

    const liveSlide = useMemo(
        () => activeSlides.find((s) => s.id === liveSlideId) ?? null,
        [activeSlides, liveSlideId],
    )
    const songIsLive = liveSlide?.type === 'song'

    // The live song's sibling verse slides, in queue (verse) order.
    const verses = useMemo(() => {
        if (!songIsLive || !liveSlide) return [] as Slide[]
        const songKey = liveSlide.songId ?? null
        return activeSlides.filter((s) => s.type === 'song' && (s.songId ?? null) === songKey)
    }, [activeSlides, liveSlide, songIsLive])

    const song = liveSlide?.data as Song | undefined
    const title = song?.title || 'Current song'
    const artist = song?.artist

    // Keep the live verse visible within this list (block:'nearest' so it
    // scrolls the inner list only, never the whole panel).
    const liveVerseRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        liveVerseRef.current?.scrollIntoView({ block: 'nearest' })
    }, [liveSlideId])

    if (!songIsLive || verses.length < 2) return null

    const goLive = (slideId: string) => {
        setLiveLocal(slideId)
        if (isConnected) void setLiveShared(slideId)
    }

    return (
        <div className="border-b border-[var(--border-subtle)] bg-red-500/[0.03]">
            <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-500">
                    <Zap className="w-3 h-3" /> Live
                </span>
                <Music className="w-3.5 h-3.5 text-[var(--accent-teal)] flex-shrink-0" />
                <div className="min-w-0">
                    <span className="block text-xs font-medium text-[var(--text-primary)] truncate">{title}</span>
                    {artist && <span className="block text-[10px] text-[var(--text-muted)] truncate">{artist}</span>}
                </div>
            </div>
            <div className="max-h-80 overflow-y-auto px-2 pb-2 flex flex-col gap-1 custom-scrollbar">
                {verses.map((slide) => {
                    const isLive = liveSlideId === slide.id
                    return (
                        <button
                            key={slide.id}
                            ref={isLive ? liveVerseRef : undefined}
                            onClick={() => goLive(slide.id)}
                            className={`text-left p-2 rounded-lg border transition-colors ${isLive
                                ? 'border-red-500/40 bg-red-500/10'
                                : 'border-transparent hover:bg-[var(--bg-tertiary)]/70'
                                }`}
                        >
                            <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[11px] font-semibold ${isLive ? 'text-red-500' : 'text-[var(--accent-teal)]'}`}>
                                    {slide.verseLabel || `Verse ${(slide.verseIndex ?? 0) + 1}`}
                                </span>
                                {isLive && (
                                    <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-500">
                                        <Zap className="w-2.5 h-2.5" /> LIVE
                                    </span>
                                )}
                            </div>
                            <div
                                className="text-[11px] text-[var(--text-secondary)] line-clamp-2 [&_*]:!text-[11px] [&_*]:!leading-snug"
                                dangerouslySetInnerHTML={{ __html: slide.contents[0] || '' }}
                            />
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
