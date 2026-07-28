/**
 * MobileStudioWorkspace — a focused, single-purpose mobile layout.
 *
 * The desktop StudioWorkspace shows the slide queue, the program-output
 * sidecar, the next-slide preview, the operator badge, and the live
 * output all at once. On a phone that becomes a wall of cramped panels.
 * This layout collapses everything down to three things a presenter
 * actually needs on mobile:
 *
 *   1. The current live slide — large, tappable to push live.
 *   2. A compact next-up preview so they know what's coming.
 *   3. Prev / Next / Add buttons.
 *
 * Desktop-only chrome (program output, multi-monitor, contributor
 * queue, NDI) stays in the desktop StudioWorkspace — the operator
 * running the booth on a phone doesn't need it. The Sermon Listener is
 * also desktop-only, hidden on mobile via the MobileBottomNav.
 */

import { useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Plus, Play, Mic, FileText, Lightbulb, Check, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../../store/appStore'
import { slideCaptionHtml } from '../../utils/slideCaption'
import { useLiveSession } from '../../hooks/useLiveSession'
import { useUserRole } from '../../hooks/useUserRole'
import { AutoFitText } from '../live/AutoFitText'
import { LiveSessionControls } from '../live/LiveSessionControls'
import { PresenceAvatars } from '../live/PresenceAvatars'
import type { Slide } from '../../types'

const SLIDE_PREVIEW_BG = 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)'

export function MobileStudioWorkspace() {
    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const liveOutputSlidesId = useAppStore((s) => s.liveOutputSlidesId)
    const sharedQueueSlideIds = useAppStore((s) => s.sharedQueueSlideIds)
    const openModal = useAppStore((s) => s.openModal)
    const workspaceMode = useAppStore((s) => s.workspaceMode)
    // The Convex-backed slide actions from the hook — NOT the local-only
    // store setter. This is what makes an operator's slide changes on mobile
    // propagate to every other device, and routes contributor actions through
    // the correct mode-aware path (open → operator deck, moderated → queue).
    const {
        isOperator,
        isConnected,
        isOpen,
        isStrict,
        setLiveSlide,
        addToQueue,
        acceptFromQueue,
        removeFromQueue,
    } = useLiveSession()
    const { currentUser } = useUserRole()
    const churchId = currentUser?.churchId || ''

    // Who may push the live slide directly: solo users, the operator, or
    // anyone when the session is in open mode. Connected non-operators in
    // strict/moderated mode cannot — they suggest instead. Mirrors the
    // desktop gating in PreviewContent/LiveOutput.
    const canControlLive = !isConnected || isOperator || isOpen
    // A connected non-operator in a non-strict mode can suggest slides.
    const canSuggest = isConnected && !isOperator && !isStrict

    const liveOutputSlides = useMemo(() => {
        if (!liveOutputSlidesId) return []
        return liveOutputSlidesId
            .map(id => activeSlides.find(slide => slide.id === id))
            .filter((slide): slide is Slide => slide !== undefined)
    }, [liveOutputSlidesId, activeSlides])

    const currentIndex = liveOutputSlides.findIndex(slide => slide.id === liveSlideId)
    const liveSlide = currentIndex >= 0 ? liveOutputSlides[currentIndex] : activeSlides.find(s => s.id === liveSlideId) ?? null
    const nextSlide = liveOutputSlides[currentIndex + 1] ?? null
    const prevSlide = liveOutputSlides[currentIndex - 1] ?? null

    // The active queue is everything the operator wants to project. If no
    // queue has been pushed yet, we fall back to all active slides so the
    // mobile view still has something to navigate.
    const queue = liveOutputSlides.length > 0 ? liveOutputSlides : activeSlides
    const fallbackIndex = queue.findIndex(slide => slide.id === liveSlideId)
    const effectiveIndex = currentIndex >= 0 ? currentIndex : fallbackIndex
    const effectiveLiveSlide = liveSlide ?? (effectiveIndex >= 0 ? queue[effectiveIndex] : null)
    const effectiveNextSlide = queue[effectiveIndex + 1] ?? null
    const effectivePrevSlide = queue[effectiveIndex - 1] ?? null

    const goPrev = useCallback(() => {
        if (!effectivePrevSlide) return
        if (!canControlLive) return
        void setLiveSlide(effectivePrevSlide.id)
    }, [effectivePrevSlide, canControlLive, setLiveSlide])

    const goNext = useCallback(() => {
        if (!effectiveNextSlide) return
        if (!canControlLive) return
        void setLiveSlide(effectiveNextSlide.id)
    }, [effectiveNextSlide, canControlLive, setLiveSlide])

    // Contributor suggestion: push the next-up (or current) slide into the
    // shared queue. In open mode this lands directly on the operator's deck;
    // in moderated mode it awaits operator approval — the hook's addToQueue
    // branches on mode, so we don't decide that here.
    const suggestTarget = effectiveNextSlide ?? effectiveLiveSlide
    const handleSuggest = useCallback(() => {
        if (!suggestTarget) return
        void addToQueue([suggestTarget.id])
    }, [suggestTarget, addToQueue])

    // Slides suggested by contributors, awaiting the operator's review.
    const sharedQueueSlides = useMemo(() => {
        if (!sharedQueueSlideIds || sharedQueueSlideIds.length === 0) return []
        return sharedQueueSlideIds.map((id, idx) => ({
            queueKey: `${id}-${idx}`,
            slideId: id,
            slide: activeSlides.find((s) => s.id === id) ?? null,
        }))
    }, [sharedQueueSlideIds, activeSlides])

    const openSearch = useCallback(() => {
        // The TopBar listens for this and opens the command bar, which
        // is the unified search/add flow on mobile too.
        window.dispatchEvent(new Event('selah:focus-quick-actions'))
    }, [])

    const openAddModal = useCallback((kind: 'bible' | 'song' | 'hymn' | 'template') => {
        // Bible / Song / Hymn lists and the template browser are all
        // reached through the quick actions sidebar (top-bar /command+/).
        // On mobile, dispatching `selah:focus-quick-actions` opens it
        // just the same, so the same code path works across viewports.
        // The template browser is the only one with a dedicated modal.
        if (kind === 'template') {
            openModal('templateBrowser')
        } else {
            window.dispatchEvent(new Event('selah:focus-quick-actions'))
        }
    }, [openModal])

    const liveBodyHtml = effectiveLiveSlide?.contents[0] ?? ''
    const liveRefHtml = slideCaptionHtml(effectiveLiveSlide)
    const nextBodyHtml = effectiveNextSlide?.contents[0] ?? ''
    const nextRefHtml = slideCaptionHtml(effectiveNextSlide)

    const liveBg = effectiveLiveSlide?.background || SLIDE_PREVIEW_BG
    const isLiveVideo = effectiveLiveSlide?.backgroundType === 'video'

    return (
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-[var(--bg-primary)]">
            {/* Compact live indicator strip */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <span
                        className={`w-2 h-2 rounded-full ${effectiveLiveSlide
                            ? 'bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.6)]'
                            : 'bg-[var(--text-muted)]/50'}`}
                    />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                        {effectiveLiveSlide ? 'Live' : 'Idle'}
                    </span>
                    {workspaceMode === 'studio' && isConnected && isOperator && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            Op
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                    {/* Collaboration controls — surfaced here for mobile,
                        which never renders the desktop TopBar's collab block. */}
                    {churchId && (
                        <>
                            <PresenceAvatars churchId={churchId} maxVisible={3} />
                            <LiveSessionControls churchId={churchId} />
                        </>
                    )}
                    <button
                        onClick={openSearch}
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-teal)] hover:bg-[var(--bg-tertiary)] transition-colors flex-shrink-0"
                        aria-label="Search and add slides"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Main live slide — fills available space, scrolls if text overflows. */}
            <div className="flex-1 min-h-0 px-3 py-3 overflow-hidden">
                {effectiveLiveSlide ? (
                    <div
                        className="w-full h-full rounded-xl border border-[var(--border-subtle)] shadow-lg overflow-hidden flex flex-col"
                        style={{ background: liveBg, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    >
                        {isLiveVideo ? (
                            <video
                                src={liveBg}
                                className="w-full h-full object-cover"
                                autoPlay
                                loop
                                muted
                            />
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center overflow-hidden">
                                <AutoFitText
                                    html={liveBodyHtml}
                                    minPx={14}
                                    maxPx={64}
                                    className="font-bold leading-tight w-full"
                                    style={{
                                        color: '#fff',
                                        textShadow: '0 2px 8px rgba(0,0,0,0.5)',
                                    }}
                                />
                                {liveRefHtml && (
                                    <div
                                        className="mt-3 text-sm opacity-80"
                                        style={{ color: '#fff' }}
                                        dangerouslySetInnerHTML={{ __html: liveRefHtml }}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <button
                        onClick={openSearch}
                        className="w-full h-full rounded-xl border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-3 text-[var(--text-muted)] hover:border-[var(--accent-teal)] hover:text-[var(--accent-teal)] transition-colors"
                    >
                        <Plus className="w-8 h-8" />
                        <span className="text-sm font-medium">Add your first slide</span>
                        <span className="text-xs opacity-60">Tap to search or browse</span>
                    </button>
                )}
            </div>

            {/* Next-up preview + transport controls. The strip is fixed-height
                so the live area above always gets the lion's share of
                the screen. */}
            <div className="flex-shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30">
                {/* Transport row */}
                <div className="flex items-center justify-between px-2 py-2">
                    <button
                        type="button"
                        onClick={goPrev}
                        disabled={!effectivePrevSlide || !canControlLive}
                        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--bg-tertiary)] active:scale-95 transition-all"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Prev
                    </button>

                    {effectiveNextSlide ? (
                        <button
                            type="button"
                            onClick={goNext}
                            className="flex-1 mx-2 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)]/70 border border-[var(--border-subtle)] hover:border-[var(--accent-teal)]/40 active:scale-[0.98] transition-all min-h-0 overflow-hidden"
                        >
                            <div className="flex-shrink-0 w-1 self-stretch rounded-full bg-[var(--accent-teal)]/40" />
                            <div className="min-w-0 flex-1 text-left">
                                <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Next up</div>
                                <div className="text-xs text-[var(--text-primary)] truncate">
                                    {effectiveNextSlide.contents[0]?.replace(/<[^>]+>/g, '') || 'Untitled'}
                                </div>
                            </div>
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={openSearch}
                            className="flex-1 mx-2 min-w-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)]/40 border border-dashed border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--accent-teal)] hover:text-[var(--accent-teal)] transition-colors min-h-0"
                        >
                            <Plus className="w-4 h-4 flex-shrink-0" />
                            <span className="text-xs">Add next slide</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={goNext}
                        disabled={!effectiveNextSlide || !canControlLive}
                        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--bg-tertiary)] active:scale-95 transition-all"
                    >
                        Next
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {/* Contributor suggest bar — shown to connected non-operators in
                    a non-strict mode, who can't push live directly. In open
                    mode this adds straight to the operator's deck; in review
                    mode it awaits approval. */}
                {canSuggest && (
                    <div className="px-2 pb-2">
                        <button
                            type="button"
                            onClick={handleSuggest}
                            disabled={!suggestTarget}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20 hover:bg-blue-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <Lightbulb className="w-3.5 h-3.5" />
                            {isOpen ? 'Add next to deck' : 'Suggest next slide'}
                        </button>
                    </div>
                )}

                {/* Operator review panel — suggestions from contributors, with
                    accept/reject. Lets an operator run the whole session from a
                    phone (desktop parity with the LiveOutput "Suggested" strip). */}
                {isConnected && isOperator && sharedQueueSlides.length > 0 && (
                    <div className="px-2 pb-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                                Suggested ({sharedQueueSlides.length})
                            </span>
                            <button
                                type="button"
                                onClick={() => acceptFromQueue(sharedQueueSlides.map((s) => s.slideId))}
                                className="text-[10px] font-medium text-[var(--accent-teal)] hover:text-[var(--accent-teal)]/80 transition-colors"
                            >
                                Accept all
                            </button>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {sharedQueueSlides.map((entry) => (
                                <div
                                    key={entry.queueKey}
                                    className="flex-shrink-0 w-32 rounded-lg p-2 bg-[var(--bg-tertiary)]/60 border border-blue-500/20"
                                >
                                    <div className="text-[10px] text-[var(--text-secondary)] truncate">
                                        {entry.slide?.name ?? 'Pending slide'}
                                    </div>
                                    <div className="flex items-center justify-end gap-1 mt-1.5">
                                        <button
                                            type="button"
                                            onClick={() => acceptFromQueue([entry.slideId])}
                                            className="p-1 rounded bg-[var(--accent-teal)]/20 text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/30"
                                            aria-label="Accept suggestion"
                                        >
                                            <Check className="w-3 h-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeFromQueue([entry.slideId])}
                                            className="p-1 rounded bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                                            aria-label="Dismiss suggestion"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Quick-add row: Bible / Songs / Hymns / Templates. Keeps the
                    most common actions one tap from the live screen. */}
                <div className="grid grid-cols-4 gap-1 px-2 pb-2">
                    <button
                        type="button"
                        onClick={() => openAddModal('bible')}
                        className="flex flex-col items-center gap-0.5 py-2 rounded-lg text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-teal)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Bible
                    </button>
                    <button
                        type="button"
                        onClick={() => openAddModal('song')}
                        className="flex flex-col items-center gap-0.5 py-2 rounded-lg text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-teal)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                        <Mic className="w-4 h-4" />
                        Songs
                    </button>
                    <button
                        type="button"
                        onClick={() => openAddModal('hymn')}
                        className="flex flex-col items-center gap-0.5 py-2 rounded-lg text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-teal)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                        <FileText className="w-4 h-4" />
                        Hymns
                    </button>
                    <button
                        type="button"
                        onClick={openSearch}
                        className="flex flex-col items-center gap-0.5 py-2 rounded-lg text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-teal)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                        <Play className="w-4 h-4" />
                        Search
                    </button>
                </div>
            </div>
        </div>
    )
}
