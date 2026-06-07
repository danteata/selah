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
import { ChevronLeft, ChevronRight, Plus, Play, Mic, FileText } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks/useLiveSession'
import { AutoFitText } from '../live/AutoFitText'
import type { Slide } from '../../types'

const SLIDE_PREVIEW_BG = 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)'

export function MobileStudioWorkspace() {
    const activeSlides = useAppStore((s) => s.activeSlides)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const setLiveSlide = useAppStore((s) => s.setLiveSlide)
    const liveOutputSlidesId = useAppStore((s) => s.liveOutputSlidesId)
    const openModal = useAppStore((s) => s.openModal)
    const workspaceMode = useAppStore((s) => s.workspaceMode)
    const { isOperator, isConnected } = useLiveSession()

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
        if (isConnected && !isOperator) return
        setLiveSlide(effectivePrevSlide.id)
    }, [effectivePrevSlide, isConnected, isOperator, setLiveSlide])

    const goNext = useCallback(() => {
        if (!effectiveNextSlide) return
        if (isConnected && !isOperator) return
        setLiveSlide(effectiveNextSlide.id)
    }, [effectiveNextSlide, isConnected, isOperator, setLiveSlide])

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
    const liveRefHtml = effectiveLiveSlide?.type === 'bible' ? (effectiveLiveSlide.contents[1] ?? '') : ''
    const nextBodyHtml = effectiveNextSlide?.contents[0] ?? ''
    const nextRefHtml = effectiveNextSlide?.type === 'bible' ? (effectiveNextSlide.contents[1] ?? '') : ''

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
                <button
                    onClick={openSearch}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-teal)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    aria-label="Search and add slides"
                >
                    <Plus className="w-4 h-4" />
                </button>
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
                        disabled={!effectivePrevSlide || (isConnected && !isOperator)}
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
                        disabled={!effectiveNextSlide || (isConnected && !isOperator)}
                        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--bg-tertiary)] active:scale-95 transition-all"
                    >
                        Next
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

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
