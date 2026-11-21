import { useMemo } from 'react'
import { Check, X } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks'

/**
 * Slides contributors have offered in a live session. The operator accepts or
 * dismisses them; everyone else sees what's waiting.
 *
 * An entry is kept even when its slide isn't in `activeSlides` yet, so the
 * operator sees a contributor's offer straight away — including a slide the
 * contributor just made that hasn't round-tripped through Convex. Dropping
 * those is what made the queue look stuck on the operator's side.
 */
export function SuggestedQueue() {
    const sharedQueueSlideIds = useAppStore((state) => state.sharedQueueSlideIds)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const { isConnected, isOperator, acceptFromQueue, removeFromQueue } = useLiveSession()

    const entries = useMemo(() => {
        if (!sharedQueueSlideIds || sharedQueueSlideIds.length === 0) return []
        return sharedQueueSlideIds.map((id, idx) => ({
            queueKey: `${id}-${idx}`,
            slideId: id,
            slide: activeSlides.find((s) => s.id === id) ?? null,
        }))
    }, [sharedQueueSlideIds, activeSlides])

    if (!isConnected || entries.length === 0) return null

    return (
        <div className="flex-shrink-0 space-y-1.5">
            <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Suggested ({entries.length})
                </div>
                {isOperator && (
                    <button
                        onClick={() => acceptFromQueue(entries.map((e) => e.slideId))}
                        className="text-[10px] font-medium text-[var(--accent-teal)] hover:text-[var(--accent-teal)]/80 transition-colors"
                    >
                        Accept All
                    </button>
                )}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
                {entries.map((entry) => (
                    <div
                        key={entry.queueKey}
                        className="flex-shrink-0 w-32 bg-gray-800/50 border border-blue-500/20 rounded-lg p-2 group relative"
                    >
                        {entry.slide ? (
                            <>
                                <div className="text-[10px] text-white/70 truncate">{entry.slide.name}</div>
                                <div className="text-[8px] text-blue-400 mt-0.5">
                                    {entry.slide.type === 'bible' ? 'Bible' : entry.slide.type === 'song' ? 'Song' : entry.slide.type === 'hymn' ? 'Hymn' : entry.slide.type === 'dictionary' ? 'Definition' : 'Slide'}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="text-[10px] text-white/40 truncate italic">Pending slide</div>
                                <div className="text-[8px] text-blue-400/60 mt-0.5">Syncing…</div>
                            </>
                        )}
                        {isOperator && (
                            <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => acceptFromQueue([entry.slideId])}
                                    className="p-0.5 bg-[var(--accent-teal)]/20 text-[var(--accent-teal)] rounded hover:bg-[var(--accent-teal)]/30"
                                    title="Accept slide"
                                >
                                    <Check className="w-2.5 h-2.5" />
                                </button>
                                <button
                                    onClick={() => removeFromQueue([entry.slideId])}
                                    className="p-0.5 bg-rose-500/20 text-rose-400 rounded hover:bg-rose-500/30"
                                    title="Dismiss slide"
                                >
                                    <X className="w-2.5 h-2.5" />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
