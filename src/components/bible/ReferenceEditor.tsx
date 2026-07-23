import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { bibleBooks } from '../../types'
import {
    stepChapter,
    clampVerse,
    getRankedBookSuggestions,
    type ParsedBibleQuery,
} from '../../utils/bibleReference'
import { BookAutocomplete } from './BookAutocomplete'

interface ReferenceEditorProps {
    bookIndex: number
    chapter: number
    startVerse: number
    endVerse: number
    /** Highest verse known to exist in the current chapter (from loaded verses). */
    maxVerse?: number
    /** Emits the new reference whenever any segment changes. */
    onChange: (next: ParsedBibleQuery) => void
}

const makeRef = (bookIndex: number, chapter: number, startVerse: number, endVerse: number): ParsedBibleQuery => ({
    bookIndex,
    bookName: bibleBooks[bookIndex - 1] ?? '',
    chapter,
    startVerse,
    endVerse,
})

/** A number segment (chapter or verse) — click/tab in and type a number
 *  directly, use the stacked chevrons, or Up/Down arrow keys while focused.
 *  Typed values are converted to a delta and run back through `onStep`, so
 *  they get exactly the same clamping/book-rollover behavior as a chevron
 *  click (see stepChapterBy/stepVerseBy in ReferenceEditor) — no separate
 *  "set absolute value" path to keep in sync. */
function Stepper({ label, value, onStep }: { label: string; value: number; onStep: (delta: number) => void }) {
    // null = not currently being edited; the input just mirrors `value`.
    // Non-null while focused/typing, holding the in-progress digit string
    // (so an intermediate empty string while backspacing doesn't misparse).
    const [editText, setEditText] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const commit = useCallback(() => {
        setEditText((current) => {
            if (current !== null && current !== '') {
                const parsed = parseInt(current, 10)
                if (Number.isFinite(parsed) && parsed !== value) onStep(parsed - value)
            }
            return null
        })
    }, [value, onStep])

    return (
        <div
            className="flex items-center gap-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-default)] pl-1 pr-1 py-0.5 focus-within:ring-2 focus-within:ring-[var(--accent-teal)]/40"
            title={`${label} (type a number, or ↑/↓ to change)`}
        >
            <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={editText ?? String(value)}
                onFocus={(e) => { setEditText(String(value)); e.target.select() }}
                onChange={(e) => setEditText(e.target.value.replace(/\D/g, ''))}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); inputRef.current?.blur() }
                    else if (e.key === 'Escape') { e.preventDefault(); setEditText(null); inputRef.current?.blur() }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setEditText(null); onStep(1) }
                    else if (e.key === 'ArrowDown') { e.preventDefault(); setEditText(null); onStep(-1) }
                }}
                aria-label={`${label} ${value}`}
                className="text-xs font-semibold text-[var(--text-primary)] tabular-nums w-7 text-center bg-transparent outline-none"
            />
            <div className="flex flex-col -my-0.5">
                <button
                    type="button"
                    onClick={() => onStep(1)}
                    aria-label={`Increase ${label}`}
                    className="text-[var(--text-muted)] hover:text-[var(--accent-teal)] leading-none"
                >
                    <ChevronUp className="w-3 h-3" />
                </button>
                <button
                    type="button"
                    onClick={() => onStep(-1)}
                    aria-label={`Decrease ${label}`}
                    className="text-[var(--text-muted)] hover:text-[var(--accent-teal)] leading-none"
                >
                    <ChevronDown className="w-3 h-3" />
                </button>
            </div>
        </div>
    )
}

/**
 * Inline "stepper chips" for a just-searched reference: Book · Chapter · Verse.
 * Lets the operator nudge or jump any segment without retyping the query.
 * Chapter steps roll across book boundaries; the book chip opens a fuzzy
 * autocomplete popover. Shared by BibleList and QuickBibleBar so the editing
 * flow is identical in both surfaces.
 */
export function ReferenceEditor({ bookIndex, chapter, startVerse, endVerse, maxVerse, onChange }: ReferenceEditorProps) {
    const [bookOpen, setBookOpen] = useState(false)
    const [bookQuery, setBookQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const bookInputRef = useRef<HTMLInputElement>(null)

    const bookName = bibleBooks[bookIndex - 1] ?? ''

    const suggestions = useMemo(
        () => (bookOpen ? getRankedBookSuggestions(bookQuery) : []),
        [bookOpen, bookQuery],
    )

    // Close the book popover on outside click.
    useEffect(() => {
        if (!bookOpen) return
        const onDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setBookOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
    }, [bookOpen])

    const openBookPicker = useCallback(() => {
        setBookQuery('')
        setActiveIndex(0)
        setBookOpen(true)
        setTimeout(() => bookInputRef.current?.focus(), 0)
    }, [])

    const pickBook = useCallback((nextBookIndex: number) => {
        setBookOpen(false)
        // A new book invalidates the chapter/verse — reset to 1:1.
        onChange(makeRef(nextBookIndex, 1, 1, 1))
    }, [onChange])

    const stepChapterBy = useCallback((delta: number) => {
        const next = stepChapter(bookIndex, chapter, delta)
        if (next.bookIndex === bookIndex && next.chapter === chapter) return
        // Changing chapter invalidates the verse range — reset to verse 1.
        onChange(makeRef(next.bookIndex, next.chapter, 1, 1))
    }, [bookIndex, chapter, onChange])

    const stepVerseBy = useCallback((delta: number) => {
        const next = clampVerse(startVerse + delta, maxVerse ? [maxVerse] : undefined)
        if (next === startVerse && next === endVerse) return
        // Verse stepping collapses any range to a single verse.
        onChange(makeRef(bookIndex, chapter, next, next))
    }, [bookIndex, chapter, startVerse, endVerse, maxVerse, onChange])

    const onBookInputKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter' || e.key === 'Tab') {
            const s = suggestions[activeIndex]
            if (s) { e.preventDefault(); pickBook(s.bookIndex) }
        } else if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation(); setBookOpen(false)
        }
    }, [suggestions, activeIndex, pickBook])

    return (
        <div ref={containerRef} className="relative flex items-center gap-1.5">
            {/* Book chip */}
            <button
                type="button"
                onClick={() => (bookOpen ? setBookOpen(false) : openBookPicker())}
                aria-haspopup="listbox"
                aria-expanded={bookOpen}
                className="flex items-center gap-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-default)] px-2 py-1 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent-teal)]/40 transition-colors"
                title="Change book"
            >
                {bookName}
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
            </button>

            <Stepper label="Chapter" value={chapter} onStep={stepChapterBy} />
            <Stepper label="Verse" value={startVerse} onStep={stepVerseBy} />
            {endVerse !== startVerse && (
                <span className="text-[10px] text-[var(--text-muted)] tabular-nums">–{endVerse}</span>
            )}

            {bookOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 z-30">
                    <input
                        ref={bookInputRef}
                        value={bookQuery}
                        onChange={(e) => { setBookQuery(e.target.value); setActiveIndex(0) }}
                        onKeyDown={onBookInputKeyDown}
                        placeholder="Jump to book…"
                        className="w-full mb-1 px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent-teal)]/30 placeholder:text-[var(--text-muted)]"
                    />
                    <BookAutocomplete
                        suggestions={suggestions}
                        activeIndex={activeIndex}
                        onSelect={(bi) => pickBook(bi)}
                        onHoverIndex={setActiveIndex}
                    />
                </div>
            )}
        </div>
    )
}
