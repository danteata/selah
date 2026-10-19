/**
 * The slide queue on a phone, as a sheet over the mobile workspace.
 *
 * Mobile had no queue: it was left out as desktop chrome. But a contributor's
 * job is the queue — a song or reading added on their phone landed in it and
 * then had no way to reach the operator, since mobile could only suggest the
 * slide after the live one, already on the operator's deck.
 *
 * Same slides and the same rules as the desktop queue (PreviewContent): go
 * live where the session allows it, suggest to the operator (or add straight
 * to their deck in open mode) as a contributor. Every action is a visible
 * button, since there's no hover on a phone. Reordering stays on desktop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ChevronRight, Lightbulb, Play, Trash2, X } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks/useLiveSession'
import { groupQueueItems, queueSlidesFor, type QueueItem } from '../preview/groupQueueItems'
import { slideText, slideTitle, songSectionOf } from '../preview/slideLabels'
import type { Slide } from '../../types'

interface MobileQueueSheetProps {
    open: boolean
    onClose: () => void
}

export function MobileQueueSheet({ open, onClose }: MobileQueueSheetProps) {
    // The sheet's state lives in its content, mounted only while open, so
    // each opening starts with nothing marked as sent.
    return <AnimatePresence>{open && <QueueSheet key="queue" onClose={onClose} />}</AnimatePresence>
}

function QueueSheet({ onClose }: { onClose: () => void }) {
    const activeSlides = useAppStore((s) => s.activeSlides)
    const activeScheduleId = useAppStore((s) => s.activeSchedule?._id)
    const liveSlideId = useAppStore((s) => s.liveSlideId)
    const removeActiveSlide = useAppStore((s) => s.removeActiveSlide)
    const deckIds = useAppStore((s) => s.liveOutputSlidesId)
    const suggestedIds = useAppStore((s) => s.sharedQueueSlideIds)
    const {
        isConnected,
        isOperator,
        isContributor,
        isOpen,
        isStrict,
        addToQueue,
        setLiveSlide,
        sessionScheduleId,
    } = useLiveSession()

    // The desktop queue's rules (PreviewContent).
    const canGoLive = !isConnected || isOperator || (isContributor && isOpen)
    const canSuggest = isConnected && isContributor && !isStrict
    const suggestLabel = isOpen ? 'Add to deck' : 'Suggest'

    const items = useMemo(
        () => groupQueueItems(queueSlidesFor(activeSlides, sessionScheduleId || activeScheduleId)),
        [activeSlides, sessionScheduleId, activeScheduleId],
    )

    // Rows sent to the operator this time the sheet is open, so a tap shows
    // it went through.
    const [sent, setSent] = useState<Set<string>>(new Set())
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const liveRowRef = useRef<HTMLLIElement>(null)

    // Start where the service is.
    useEffect(() => {
        const frame = requestAnimationFrame(() => liveRowRef.current?.scrollIntoView?.({ block: 'center' }))
        return () => cancelAnimationFrame(frame)
    }, [])

    const goLive = useCallback((slide: Slide) => {
        if (!canGoLive) return
        void setLiveSlide(slide.id)
        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
    }, [canGoLive, setLiveSlide])

    const suggest = useCallback((key: string, slides: Slide[]) => {
        void addToQueue(slides.map((s) => s.id))
        setSent((prev) => new Set(prev).add(key))
    }, [addToQueue])

    const toggle = useCallback((key: string) => {
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }, [])

    // Already on the operator's deck, or already suggested: nothing to send.
    // Every row offered Add, the deck's own slides included.
    const shared = useMemo(() => new Set([...(deckIds ?? []), ...(suggestedIds ?? [])]), [deckIds, suggestedIds])

    const renderActions = (key: string, slides: Slide[], label: string) => (
        <div className="flex items-center gap-1 flex-shrink-0">
            {canSuggest && (sent.has(key) || !slides.every((s) => shared.has(s.id))) && (
                sent.has(key) ? (
                    <span className="flex items-center gap-1 h-9 px-2 text-xs font-medium text-blue-500">
                        <Check className="w-3.5 h-3.5" />
                        {isOpen ? 'Added' : 'Suggested'}
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={() => suggest(key, slides)}
                        className="flex items-center gap-1 h-9 px-3 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 active:scale-95 transition-transform"
                        aria-label={`${suggestLabel}: ${label}`}
                    >
                        <Lightbulb className="w-3.5 h-3.5" />
                        {/* Beside a Live button there's room for one word. */}
                        {canGoLive ? 'Add' : suggestLabel}
                    </button>
                )
            )}
            {canGoLive && !slides.some((s) => s.id === liveSlideId) && (
                <button
                    type="button"
                    onClick={() => goLive(slides[0])}
                    className="flex items-center gap-1 h-9 px-3 rounded-full text-xs font-semibold text-white bg-red-500 active:scale-95 transition-transform"
                    aria-label={`Go live: ${label}`}
                >
                    <Play className="w-3.5 h-3.5" />
                    Live
                </button>
            )}
            <button
                type="button"
                onClick={() => slides.forEach((s) => removeActiveSlide(s))}
                className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--text-muted)] active:text-rose-500 active:bg-rose-500/10"
                aria-label={`Remove: ${label}`}
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    )

    const renderItem = (item: QueueItem) => {
        if (item.type === 'single') {
            const isLive = item.slide.id === liveSlideId
            const label = slideTitle(item.slide)
            return (
                <li key={item.slide.id} ref={isLive ? liveRowRef : undefined} className={rowClass(isLive)}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                        <LiveDot live={isLive} />
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm text-[var(--text-primary)] truncate">{label}</span>
                            {slideText(item.slide) && slideText(item.slide) !== label && (
                                <span className="block text-xs text-[var(--text-muted)] truncate">{slideText(item.slide)}</span>
                            )}
                        </span>
                        {renderActions(item.slide.id, [item.slide], label)}
                    </div>
                </li>
            )
        }
        const slides = item.verses.map((v) => v.slide)
        const isLive = slides.some((s) => s.id === liveSlideId)
        const isExpanded = expanded.has(item.key)
        return (
            <li key={item.key} ref={isLive ? liveRowRef : undefined} className={rowClass(isLive)}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                    <LiveDot live={isLive} />
                    <button
                        type="button"
                        onClick={() => toggle(item.key)}
                        className="flex-1 min-w-0 flex items-center gap-1 text-left"
                        aria-expanded={isExpanded}
                    >
                        {isExpanded
                            ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />
                            : <ChevronRight className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />}
                        <span className="min-w-0">
                            <span className="block text-sm text-[var(--text-primary)] truncate">{item.songTitle}</span>
                            <span className="block text-[11px] text-[var(--text-muted)]">{slides.length} slides</span>
                        </span>
                    </button>
                    {renderActions(item.key, slides, item.songTitle)}
                </div>
                {/* A song's own slides, to put a particular verse up. */}
                {isExpanded && (
                    <ul className="pb-1.5">
                        {slides.map((slide) => {
                            const verseLive = slide.id === liveSlideId
                            return (
                                <li key={slide.id} className="flex items-center gap-2 pl-9 pr-3 py-1">
                                    <LiveDot live={verseLive} />
                                    <span className="flex-1 min-w-0 text-xs text-[var(--text-secondary)] truncate">
                                        {songSectionOf(slide) && (
                                            <span className="font-semibold text-[var(--text-primary)]">{songSectionOf(slide)} · </span>
                                        )}
                                        {slideText(slide) || slideTitle(slide)}
                                    </span>
                                    {canGoLive && !verseLive && (
                                        <button
                                            type="button"
                                            onClick={() => goLive(slide)}
                                            className="w-9 h-9 flex items-center justify-center rounded-full text-red-500 bg-red-500/10 active:scale-95"
                                            aria-label={`Go live: ${slideTitle(slide)}`}
                                        >
                                            <Play className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </li>
        )
    }

    return (
        <>
            <motion.div
                className="md:hidden fixed inset-0 bg-black/50 z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            />
            <motion.div
                role="dialog"
                aria-label="Slide queue"
                className="md:hidden fixed bottom-0 left-0 right-0 z-50 max-h-[75vh] flex flex-col bg-[var(--bg-elevated)] border-t border-[var(--border-default)] rounded-t-2xl shadow-2xl"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            >
                <div className="flex items-center justify-between pl-4 pr-4 py-2 border-b border-[var(--border-subtle)] flex-shrink-0">
                    <div>
                        <h2 className="text-[17px] text-[var(--text-primary)]">Queue</h2>
                        {canSuggest && (
                            <p className="text-[11px] text-[var(--text-muted)]">
                                {isOpen
                                    ? 'Add slides straight to the operator’s deck.'
                                    : 'Suggest slides for the operator to approve.'}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="w-11 h-11 -mr-2.5 flex items-center justify-center rounded-full text-[var(--text-muted)] active:bg-[var(--bg-tertiary)]" aria-label="Close">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                {items.length === 0 ? (
                    <p className="p-8 text-center text-sm text-[var(--text-muted)]">
                        Nothing queued yet. Add a song, a reading or a slide to see it here.
                    </p>
                ) : (
                    <ul className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
                        {items.map(renderItem)}
                    </ul>
                )}
                <div className="h-14 flex-shrink-0" /> {/* Spacer so the bottom
                    nav doesn't overlap the last row. */}
            </motion.div>
        </>
    )
}

function rowClass(live: boolean): string {
    return `rounded-lg border ${live
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60'}`
}

function LiveDot({ live }: { live: boolean }) {
    return (
        <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${live ? 'bg-red-500 animate-pulse' : 'bg-transparent'}`}
            aria-label={live ? 'Live' : undefined}
        />
    )
}
