/**
 * MobileStudioWorkspace — the studio on a phone, built as a remote control.
 *
 * Top to bottom, in order of how often it's needed during a service:
 *
 *   1. What's live, named ("Amazing Grace · 2 of 3"), and the session chip.
 *   2. The live slide, in the projector's 16:9 frame.
 *   3. What the session's sermon listener just heard (on the desk's computer),
 *      each verse a tap from the screen (HeardVersesStrip).
 *   4. Up next: the next few slides, each a tap away from going live, and
 *      the whole queue in a sheet (MobileQueueSheet). A live song's own
 *      sections come first (mobileLiveNav).
 *   5. For the operator, contributors' suggestions to accept or dismiss.
 *   6. In thumb reach, the one action this person's role allows: Next (and
 *      Prev) for whoever controls the screen, with the previous / next verse
 *      above them while a Bible slide is live (MobileVerseStepper) or the
 *      song's sections while a song is (MobileSongParts), "Suggest
 *      slides" for a contributor in review mode, nothing but a note for
 *      someone watching.
 *
 * Adding slides goes through the bottom nav (Bible, Music, Add). Desktop-only
 * chrome (program output, multi-monitor, NDI) stays in StudioWorkspace.
 */

import { useMemo, useCallback, useEffect, useState } from 'react'
import { BookOpen, Check, ChevronLeft, ChevronRight, Lightbulb, ListOrdered, Music, Play, Search, X } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks/useLiveSession'
import { useUserRole } from '../../hooks/useUserRole'
import { LiveSessionControls } from '../live/LiveSessionControls'
import { SlideView } from '../live/SlideView'
import { useLiveOutputSettings } from '../../hooks/useLiveSync'
import { MobileQueueSheet } from './MobileQueueSheet'
import { HeardVersesStrip } from './HeardVersesStrip'
import { MobileVerseStepper } from './MobileVerseStepper'
import { MobileSongParts } from './MobileSongParts'
import { liveNavigation } from './mobileLiveNav'
import { queueSlidesFor } from '../preview/groupQueueItems'
import { slideText, slideTitle, songSectionOf, songTitleOf } from '../preview/slideLabels'
import type { Slide } from '../../types'

/** Rows shown under "Up next" before the queue sheet takes over. */
const UP_NEXT = 3

/** How long to wait for the session before showing what this device has. */
const RESOLVE_TIMEOUT_MS = 8000

export function MobileStudioWorkspace() {
    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const liveOutputSlidesId = useAppStore((s) => s.liveOutputSlidesId)
    const sharedQueueSlideIds = useAppStore((s) => s.sharedQueueSlideIds)
    const activeScheduleId = useAppStore((s) => s.activeSchedule?._id)
    const scheduleName = useAppStore((s) => s.activeSchedule?.name)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    // The Convex-backed slide actions from the hook — NOT the local-only
    // store setter. This is what makes an operator's slide changes on mobile
    // propagate to every other device, and routes contributor actions through
    // the correct mode-aware path (open → operator deck, moderated → queue).
    const {
        isOperator,
        isContributor,
        isConnected,
        isOpen,
        isStrict,
        setLiveSlide,
        acceptFromQueue,
        removeFromQueue,
        syncSlideContent,
        sessionScheduleId,
        isResolving,
    } = useLiveSession()
    const { currentUser } = useUserRole()
    const churchId = currentUser?.churchId || ''
    const outputSettings = useLiveOutputSettings()
    const [queueOpen, setQueueOpen] = useState(false)

    // Who may push the live slide directly: solo users, the operator, or
    // anyone when the session is in open mode. Mirrors the desktop gating in
    // PreviewContent/LiveOutput.
    const canControlLive = !isConnected || isOperator || isOpen
    // A contributor (not a viewer) in a non-strict session suggests instead.
    const canSuggest = isConnected && isContributor && !isStrict

    const liveOutputSlides = useMemo(() => {
        if (!liveOutputSlidesId) return []
        return liveOutputSlidesId
            .map(id => activeSlides.find(slide => slide.id === id))
            .filter((slide): slide is Slide => slide !== undefined)
    }, [liveOutputSlidesId, activeSlides])

    // The deck being projected: the operator's order when there is one, else
    // everything active, so there's always something to step through.
    const deck = liveOutputSlides.length > 0 ? liveOutputSlides : activeSlides
    const liveSlide = activeSlides.find((s) => s.id === liveSlideId) ?? null
    // A live song steps through its own sections first, then the deck.
    const { songParts, prevSlide, following, place } = useMemo(
        () => liveNavigation(deck, activeSlides, liveSlideId),
        [deck, activeSlides, liveSlideId],
    )
    const upNext = following.slice(0, UP_NEXT)
    const nextSlide = upNext[0] ?? null

    // Opening the page, the session and its slides take a moment to arrive.
    // Showing "Idle · Start session · Nothing queued" meanwhile told people
    // there was no session, then jumped into it. Wait for it (within reason).
    const [gaveUpWaiting, setGaveUpWaiting] = useState(false)
    useEffect(() => {
        if (!isResolving) return
        const timer = setTimeout(() => setGaveUpWaiting(true), RESOLVE_TIMEOUT_MS)
        return () => clearTimeout(timer)
    }, [isResolving])
    const loading = isResolving && !gaveUpWaiting && !liveSlide

    const queuedCount = useMemo(
        () => queueSlidesFor(activeSlides, sessionScheduleId || activeScheduleId).length,
        [activeSlides, sessionScheduleId, activeScheduleId],
    )

    const goLive = useCallback((slide: Slide | null) => {
        if (!slide || !canControlLive) return
        void setLiveSlide(slide.id)
    }, [canControlLive, setLiveSlide])

    // Slides suggested by contributors, awaiting the operator's review.
    const suggestions = useMemo(() => (sharedQueueSlideIds ?? []).map((id, idx) => ({
        key: `${id}-${idx}`,
        slideId: id,
        slide: activeSlides.find((s) => s.id === id) ?? null,
    })), [sharedQueueSlideIds, activeSlides])

    const openSearch = useCallback(() => {
        // The TopBar listens for this and opens the command bar, the unified
        // search/add flow.
        window.dispatchEvent(new Event('selah:focus-quick-actions'))
    }, [])

    if (loading) return <LoadingLive />

    return (
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
            {/* What's live, by name, and the session. */}
            <div className="flex items-center gap-3 pl-4 pr-3 h-14 border-b border-[var(--border-subtle)] flex-shrink-0">
                <LiveCaption slide={liveSlide} place={place} idleText={scheduleName || 'Ready when you are'} />
                {churchId && <LiveSessionControls churchId={churchId} compact />}
            </div>

            {deck.length === 0 ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                    {/* A verse just heard is the obvious first slide. */}
                    <HeardVersesStrip canControlLive={canControlLive} canSuggest={canSuggest} />
                    <EmptyDeck
                        waitingForOperator={isConnected && !isOperator}
                        onSongs={() => setActiveNavSection('music')}
                        onBible={() => setActiveNavSection('bible')}
                        onSearch={openSearch}
                    />
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                    {/* The live slide, in the projector's renderer and frame. */}
                    <div className="px-4 pt-4">
                        {liveSlide ? (
                            <SlideView
                                slide={liveSlide}
                                settings={outputSettings}
                                muted
                                showMissingMedia
                                minTextPx={12}
                                className="w-full aspect-video rounded-xl border border-[var(--border-subtle)] shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
                            />
                        ) : (
                            <div className="w-full aspect-video rounded-xl border border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-1 text-center px-6">
                                <span className="text-sm font-medium text-[var(--text-secondary)]">Nothing on the screen</span>
                                <span className="text-xs text-[var(--text-muted)]">
                                    {canControlLive ? 'Tap a slide below to put it up.' : 'The operator will put the first slide up.'}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* What the listener at the desk just heard. */}
                    <HeardVersesStrip canControlLive={canControlLive} canSuggest={canSuggest} />

                    {/* Up next, and the way into the whole queue. */}
                    <section className="px-4 pt-5" aria-labelledby="mobile-up-next">
                        <div className="flex items-center justify-between mb-2">
                            <h2 id="mobile-up-next" className="mobile-section-label">{liveSlide ? 'Up next' : 'First up'}</h2>
                            <button
                                type="button"
                                onClick={() => setQueueOpen(true)}
                                className="flex items-center gap-1.5 h-9 -mr-2 px-3 rounded-full text-xs font-semibold text-[var(--accent-teal)] active:bg-[var(--accent-teal)]/10"
                            >
                                <ListOrdered className="w-4 h-4" />
                                Queue
                                <span className="tabular-nums text-[var(--text-muted)] font-medium">{queuedCount}</span>
                            </button>
                        </div>
                        {upNext.length === 0 ? (
                            <p className="py-3 text-sm text-[var(--text-muted)]">That’s the last slide in the queue.</p>
                        ) : (
                            <ol className="space-y-1.5">
                                {upNext.map((slide, i) => (
                                    <li key={slide.id}>
                                        <UpNextRow
                                            slide={slide}
                                            emphasis={i === 0}
                                            onGoLive={canControlLive ? () => goLive(slide) : undefined}
                                        />
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>

                    {/* Contributors' suggestions, for the operator to take or leave. */}
                    {isConnected && isOperator && suggestions.length > 0 && (
                        <section className="px-4 pt-5" aria-labelledby="mobile-suggested">
                            <div className="flex items-center justify-between mb-2">
                                <h2 id="mobile-suggested" className="mobile-section-label">Suggested ({suggestions.length})</h2>
                                <button
                                    type="button"
                                    onClick={() => acceptFromQueue(suggestions.map((s) => s.slideId))}
                                    className="h-9 -mr-2 px-3 rounded-full text-xs font-semibold text-[var(--accent-teal)] active:bg-[var(--accent-teal)]/10"
                                >
                                    Accept all
                                </button>
                            </div>
                            <ul className="space-y-1.5">
                                {suggestions.map((entry) => (
                                    <li key={entry.key} className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl bg-blue-500/8 border border-blue-500/15">
                                        <Lightbulb className="w-4 h-4 flex-shrink-0 text-blue-500" />
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-sm text-[var(--text-primary)] truncate">
                                                {entry.slide ? slideTitle(entry.slide) : 'A slide on its way…'}
                                            </span>
                                            {entry.slide && slideText(entry.slide) && slideText(entry.slide) !== slideTitle(entry.slide) && (
                                                <span className="block text-xs text-[var(--text-muted)] truncate">{slideText(entry.slide)}</span>
                                            )}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => removeFromQueue([entry.slideId])}
                                            className="w-11 h-11 flex items-center justify-center rounded-full text-[var(--text-muted)] active:bg-rose-500/10 active:text-rose-500"
                                            aria-label="Dismiss suggestion"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => acceptFromQueue([entry.slideId])}
                                            className="w-11 h-11 flex items-center justify-center rounded-full text-white bg-[var(--accent-teal)] active:scale-95 transition-transform"
                                            aria-label="Accept suggestion"
                                        >
                                            <Check className="w-5 h-5" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <div className="h-4" />
                </div>
            )}

            {/* The action this person's role allows, in thumb reach. */}
            {deck.length > 0 && (
                <div className="flex-shrink-0 px-4 pt-3 pb-3 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]">
                    {canControlLive && songParts.length > 1 && (
                        <MobileSongParts parts={songParts} liveSlideId={liveSlideId} onGoLive={goLive} />
                    )}
                    {canControlLive && liveSlide?.type === 'bible' && (
                        <MobileVerseStepper slide={liveSlide} onSlideChanged={(slide) => void syncSlideContent(slide)} />
                    )}
                    {canControlLive ? (
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => goLive(prevSlide)}
                                disabled={!prevSlide}
                                aria-label="Previous slide"
                                className="h-14 w-16 flex items-center justify-center rounded-2xl text-[var(--text-primary)] bg-[var(--bg-tertiary)] active:scale-[0.97] transition-transform disabled:opacity-35 disabled:active:scale-100"
                            >
                                <ChevronLeft className="w-6 h-6" />
                            </button>
                            <button
                                type="button"
                                onClick={() => goLive(nextSlide)}
                                disabled={!nextSlide}
                                className="flex-1 h-14 flex items-center justify-center gap-2 rounded-2xl text-base font-semibold text-white bg-[var(--accent-teal)] shadow-[0_6px_16px_rgba(13,148,136,0.35)] active:scale-[0.98] transition-transform disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
                            >
                                {liveSlide ? 'Next' : 'Start'}
                                {liveSlide ? <ChevronRight className="w-5 h-5" /> : <Play className="w-4 h-4" />}
                            </button>
                        </div>
                    ) : canSuggest ? (
                        <button
                            type="button"
                            onClick={() => setQueueOpen(true)}
                            className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl text-base font-semibold text-white bg-blue-600 shadow-[0_6px_16px_rgba(37,99,235,0.3)] active:scale-[0.98] transition-transform"
                        >
                            <Lightbulb className="w-5 h-5" />
                            Suggest slides
                        </button>
                    ) : (
                        <p className="h-10 flex items-center justify-center text-sm text-[var(--text-muted)]">
                            The operator is controlling the slides.
                        </p>
                    )}
                </div>
            )}

            <MobileQueueSheet open={queueOpen} onClose={() => setQueueOpen(false)} />
        </div>
    )
}

/** The live view's shape while the session arrives, so nothing jumps. */
function LoadingLive() {
    return (
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]" role="status" aria-label="Joining the service">
            <div className="flex items-center gap-3 pl-4 pr-3 h-14 border-b border-[var(--border-subtle)] flex-shrink-0">
                <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="h-2.5 w-12 rounded bg-[var(--bg-tertiary)] animate-pulse" />
                    <div className="h-3.5 w-40 rounded bg-[var(--bg-tertiary)] animate-pulse" />
                </div>
            </div>
            <div className="px-4 pt-4 space-y-5">
                <div className="w-full aspect-video rounded-xl bg-[var(--bg-secondary)] animate-pulse" />
                <div className="space-y-1.5">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-[52px] rounded-xl bg-[var(--bg-secondary)]/60 animate-pulse" />
                    ))}
                </div>
                <p className="text-center text-xs text-[var(--text-muted)]">Joining the service…</p>
            </div>
        </div>
    )
}

/** "● Live" over the live slide's name and place: "Amazing Grace · Chorus · 2 of 3". */
function LiveCaption({ slide, place, idleText }: { slide: Slide | null; place: string; idleText: string }) {
    const section = slide ? songSectionOf(slide) : null
    if (!slide) place = ''
    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
                <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${slide
                        ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                        : 'bg-[var(--text-muted)]/50'}`}
                />
                <span className={`text-[11px] font-bold uppercase tracking-[0.14em] ${slide ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                    {slide ? 'Live' : 'Idle'}
                </span>
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {slide ? slideTitle(slide) : idleText}
                {section && <span className="text-[var(--text-secondary)]"> · {section}</span>}
                {place && <span className="text-[var(--text-muted)] font-normal tabular-nums"> · {place}</span>}
            </p>
        </div>
    )
}

/** A slide coming up: its words first, then what it's from. */
function UpNextRow({ slide, emphasis, onGoLive }: { slide: Slide; emphasis: boolean; onGoLive?: () => void }) {
    const text = slideText(slide)
    const song = songTitleOf(slide)
    const section = songSectionOf(slide)
    const source = song ? [section, song].filter(Boolean).join(' · ') : (slide.type === 'bible' ? slide.name : null)
    const body = (
        <>
            <span className="flex-1 min-w-0">
                <span className={`block truncate ${emphasis ? 'text-[15px] text-[var(--text-primary)]' : 'text-sm text-[var(--text-secondary)]'}`}>
                    {text || slideTitle(slide)}
                </span>
                {source && <span className="block text-xs text-[var(--text-muted)] truncate">{source}</span>}
            </span>
            {onGoLive && <Play className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />}
        </>
    )
    const className = `w-full min-h-[52px] flex items-center gap-3 px-3.5 py-2 rounded-xl text-left ${emphasis
        ? 'bg-[var(--bg-secondary)] border border-[var(--border-default)]'
        : 'bg-[var(--bg-secondary)]/50 border border-[var(--border-subtle)]'}`
    if (!onGoLive) return <div className={className}>{body}</div>
    return (
        <button type="button" onClick={onGoLive} aria-label={`Go live: ${text || slideTitle(slide)}`} className={`${className} active:scale-[0.99] active:border-[var(--accent-teal)]/50 transition-transform`}>
            {body}
        </button>
    )
}

function EmptyDeck({ waitingForOperator, onSongs, onBible, onSearch }: {
    waitingForOperator: boolean
    onSongs: () => void
    onBible: () => void
    onSearch: () => void
}) {
    return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 px-8 text-center">
            <div className="space-y-1.5">
                <h2 className="text-xl text-[var(--text-primary)]">
                    {waitingForOperator ? 'Waiting for the first slide' : 'Nothing queued yet'}
                </h2>
                <p className="text-sm text-[var(--text-secondary)]">
                    {waitingForOperator
                        ? 'The operator’s slides appear here. You can find songs and readings to suggest meanwhile.'
                        : 'Find a song or a reading to put on the screen.'}
                </p>
            </div>
            <div className="w-full max-w-xs grid grid-cols-2 gap-2">
                <button type="button" onClick={onSongs} className="h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-default)] active:scale-[0.98] transition-transform">
                    <Music className="w-4 h-4 text-[var(--accent-teal)]" />
                    Songs
                </button>
                <button type="button" onClick={onBible} className="h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-default)] active:scale-[0.98] transition-transform">
                    <BookOpen className="w-4 h-4 text-[var(--accent-teal)]" />
                    Bible
                </button>
                <button type="button" onClick={onSearch} aria-label="Search and add slides" className="col-span-2 h-12 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white bg-[var(--accent-teal)] active:scale-[0.98] transition-transform">
                    <Search className="w-4 h-4" />
                    Search everything
                </button>
            </div>
        </div>
    )
}
