import { Music, Lock, Unlock, Mic } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

/**
 * Operator control + live readout for predictive song-lyric auto-advance
 * (Phase 3 safety UI). Provides:
 *  - explicit opt-in (Auto-advance) + a lock to freeze it,
 *  - a confidence meter and phase readout,
 *  - clickable arrangement chips (click-to-jump): choosing a section sets it
 *    live, and the tracker re-seats itself there (see useSongTracker).
 *
 * Only shown while a structured song is on the live output.
 */
export function SongTrackingControl() {
    const enabled = useAppStore((s) => s.songTracking.enabled)
    const locked = useAppStore((s) => s.songTracking.locked)
    const status = useAppStore((s) => s.songTracking.status)
    const setEnabled = useAppStore((s) => s.setSongTrackingEnabled)
    const setLocked = useAppStore((s) => s.setSongTrackingLocked)
    const setLiveSlide = useAppStore((s) => s.setLiveSlide)

    if (!status.songId) return null

    const confidencePct = Math.round(status.confidence * 100)
    const meterColor =
        status.phase === 'tracking'
            ? 'bg-emerald-500'
            : status.phase === 'searching'
              ? 'bg-amber-500'
              : status.phase === 'lost'
                ? 'bg-red-500'
                : 'bg-gray-400'
    const phaseColor =
        status.phase === 'tracking'
            ? 'text-emerald-500'
            : status.phase === 'searching'
              ? 'text-amber-500'
              : status.phase === 'lost'
                ? 'text-red-500'
                : 'text-gray-400'

    return (
        <div className="flex flex-col gap-2 p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs">
            {/* Row 1: controls + phase/confidence */}
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setEnabled(!enabled)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md font-medium transition-all ${
                        enabled
                            ? 'bg-[var(--accent-teal)] text-white'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title="Automatically advance the lyrics slide from the live audio"
                >
                    <Music className="w-3 h-3" />
                    Auto-advance {enabled ? 'On' : 'Off'}
                </button>

                {enabled && (
                    <button
                        onClick={() => setLocked(!locked)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-all ${
                            locked
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                        title={locked ? 'Auto-advance is frozen' : 'Freeze auto-advance without losing position'}
                    >
                        {locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        {locked ? 'Locked' : 'Live'}
                    </button>
                )}

                {/* Confidence meter inline — saves the separate row; the bar is
                    self-explanatory so the "Confidence" label is dropped. */}
                <div className="flex-1 min-w-[40px] h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden" title="Tracking confidence">
                    <div
                        className={`h-full rounded-full transition-[width] duration-200 ${meterColor}`}
                        style={{ width: `${confidencePct}%` }}
                    />
                </div>
                <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400 w-8 text-right flex-shrink-0">
                    {confidencePct}%
                </span>
                <span className={`font-medium capitalize flex-shrink-0 ${phaseColor}`}>{status.phase}</span>
            </div>

            {/* Arrangement chips (click-to-jump) */}
            {status.arrangement.length > 0 && (
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {status.arrangement.map((step) => {
                        // Compare by step, falling back to section id only for a
                        // status published before step indices existed. Matching
                        // on section id alone lights up every repeat of a
                        // section at once — both choruses of `V1 C V2 C`.
                        const isLive =
                            status.displayStepIndex !== null
                                ? step.stepIndex === status.displayStepIndex
                                : step.sectionId === status.displaySectionId
                        const isSinger =
                            status.singerStepIndex !== null
                                ? step.stepIndex === status.singerStepIndex
                                : step.sectionId === status.singerSectionId
                        const jumpable = !!step.slideId
                        return (
                            <button
                                key={step.stepIndex}
                                onClick={() => step.slideId && setLiveSlide(step.slideId)}
                                disabled={!jumpable}
                                title={jumpable ? `Jump to ${step.label}` : step.label}
                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${
                                    isLive
                                        ? 'bg-[var(--accent-teal)] text-white'
                                        : isSinger
                                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/40'
                                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                } ${jumpable ? 'hover:brightness-110 cursor-pointer' : 'opacity-60 cursor-default'}`}
                            >
                                {isSinger && <Mic className="w-2.5 h-2.5" />}
                                {step.label}
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
