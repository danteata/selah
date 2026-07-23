import type { RankedBookSuggestion } from '../../utils/bibleReference'

interface BookAutocompleteProps {
    /**
     * Ranked suggestions to show. The PARENT owns this list (via
     * `getRankedBookSuggestions`) so its keyboard handler and this render
     * agree on ordering and bounds — the input's ↑/↓/Tab/Enter drive
     * `activeIndex`, and this component only paints + reports clicks/hover.
     */
    suggestions: RankedBookSuggestion[]
    activeIndex: number
    onSelect: (bookIndex: number, bookName: string) => void
    onHoverIndex?: (index: number) => void
    /** Positioning / layout override for the container. */
    className?: string
}

function Highlighted({ text, indexes }: { text: string; indexes?: number[] }) {
    if (!indexes || indexes.length === 0) return <>{text}</>
    const set = new Set(indexes)
    return (
        <>
            {text.split('').map((ch, i) =>
                set.has(i)
                    ? <span key={i} className="text-[var(--accent-teal)] font-semibold">{ch}</span>
                    : <span key={i}>{ch}</span>
            )}
        </>
    )
}

/**
 * Ranked, keyboard-driven book-name autocomplete. Shared by the docked
 * BibleList panel and the QuickBibleBar modal so the "type a book" flow is
 * identical in both. Rendering is controlled by the host input's key handler
 * via `activeIndex`; clicks/hover report back through the callbacks.
 */
export function BookAutocomplete({ suggestions, activeIndex, onSelect, onHoverIndex, className }: BookAutocompleteProps) {
    if (suggestions.length === 0) return null

    return (
        <div
            role="listbox"
            className={
                className ??
                'bg-[var(--bg-elevated)] rounded-lg shadow-lg border border-[var(--border-default)] overflow-hidden py-1'
            }
        >
            {suggestions.map((s, i) => {
                const isActive = i === activeIndex
                return (
                    <button
                        key={s.bookIndex}
                        role="option"
                        aria-selected={isActive}
                        // mousedown (not click) so selection fires before the
                        // input's blur would tear the dropdown down.
                        onMouseDown={(e) => { e.preventDefault(); onSelect(s.bookIndex, s.book) }}
                        onMouseEnter={() => onHoverIndex?.(i)}
                        className={`w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 text-sm transition-colors ${
                            isActive
                                ? 'bg-[var(--accent-teal)]/10 text-[var(--text-primary)]'
                                : 'text-[var(--text-primary)] hover:bg-[var(--accent-teal)]/5'
                        }`}
                    >
                        <span className="truncate">
                            <Highlighted text={s.book} indexes={s.matchIndexes} />
                        </span>
                        {s.abbrev && (
                            <span className="shrink-0 text-[10px] font-medium text-[var(--text-muted)] tabular-nums">
                                {s.abbrev}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}
