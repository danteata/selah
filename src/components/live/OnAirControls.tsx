import { ChevronUp, ChevronDown, Lightbulb, Plus } from 'lucide-react'
import type { OnAir } from './useOnAir'

/** What's on air and where it sits in the deck, with previous/next. */
export function OnAirControls({ onAir }: { onAir: OnAir }) {
    const { liveSlide, deck, index, previous, nextUp, canStep, setOnAir, canSuggest, suggestionsAreAdded, suggest } = onAir
    return (
        <div className="flex-shrink-0 rounded-xl p-3 border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/45">
            <div className="flex items-center justify-between mb-2">
                <div className="min-w-0 flex-1">
                    <div className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.16em]">On air</div>
                    <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                        {liveSlide?.name || 'None'}
                    </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                    <div className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.16em]">Pos</div>
                    <div className="text-xs font-mono text-[var(--text-primary)]">
                        {index >= 0 ? `${index + 1}/${deck.length}` : '-/-'}
                    </div>
                </div>
            </div>
            <div className="flex gap-1.5">
                <button
                    onClick={() => previous && setOnAir(previous.id)}
                    disabled={!previous || !canStep}
                    aria-label="Previous slide"
                    className="flex-1 py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] disabled:opacity-25 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs font-medium border border-[var(--border-subtle)]"
                >
                    <ChevronUp className="w-4 h-4 mx-auto" />
                </button>
                {canSuggest && nextUp && (
                    <button
                        onClick={() => void suggest(nextUp.id)}
                        className="flex-1 py-1.5 bg-[var(--accent-teal)]/15 hover:bg-[var(--accent-teal)] text-[var(--accent-teal)] hover:text-white rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-1"
                        title={suggestionsAreAdded ? 'Add this slide to the shared queue' : 'Suggest this slide for the operator to review'}
                    >
                        {suggestionsAreAdded ? (
                            <>
                                <Plus className="w-3 h-3" />
                                Add
                            </>
                        ) : (
                            <>
                                <Lightbulb className="w-3 h-3" />
                                Suggest
                            </>
                        )}
                    </button>
                )}
                <button
                    onClick={() => nextUp && setOnAir(nextUp.id)}
                    disabled={!nextUp || !canStep}
                    aria-label="Next slide"
                    className="flex-1 py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--border-default)] disabled:opacity-25 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs font-medium border border-[var(--border-subtle)]"
                >
                    <ChevronDown className="w-4 h-4 mx-auto" />
                </button>
            </div>
        </div>
    )
}
