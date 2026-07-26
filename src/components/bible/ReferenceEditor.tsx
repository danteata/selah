import { useState, useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { bibleBooks } from '../../types'
import {
    stepChapter,
    clampVerse,
    getRankedBookSuggestions,
    type ParsedBibleQuery,
} from '../../utils/bibleReference'
import { BOOK_MAX_CHAPTER, BOOK_MAX_VERSES } from '../../services/sermon-listener/verseDetection'
import { BookAutocomplete } from './BookAutocomplete'

interface ReferenceEditorProps {
    bookIndex: number
    chapter: number
    startVerse: number
    endVerse: number
    /** Highest verse known to exist in the current chapter (from loaded verses). */
    maxVerse?: number
    /** Emits the new reference whenever any segment changes. On Enter (submit)
     *  the parent presents the verse live; on Shift+Enter (submit + queue) it
     *  adds it to the queue instead — mirroring the search box. A plain edit
     *  just loads it into the view. */
    onChange: (next: ParsedBibleQuery, opts?: { submit?: boolean; queue?: boolean }) => void
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
function Stepper({ label, value, onStep, onSet, focusRef }: { label: string; value: number; onStep: (delta: number) => void; onSet: (absolute: number, submit: boolean, queue: boolean) => void; focusRef?: React.MutableRefObject<HTMLInputElement | null> }) {
    // null = not currently being edited; the input just mirrors `value`.
    // Non-null while focused/typing, holding the in-progress digit string
    // (so an intermediate empty string while backspacing doesn't misparse).
    const [editText, setEditText] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // `submit` = Enter was pressed → commit AND ask the parent to present the
    // reference (live, or queue when `queue` — Shift+Enter). Fires even when the
    // value is unchanged, so Enter always presents.
    const commit = useCallback((submit = false, queue = false) => {
        setEditText((current) => {
            if (current !== null && current !== '') {
                const parsed = parseInt(current, 10)
                // Set the typed value ABSOLUTELY. (The old delta approach —
                // onStep(parsed - value) — silently produced the wrong verse
                // whenever `value` was even a step stale, e.g. typing 16 landing
                // on 4.) onSet clamps the same way a chevron step would.
                if (Number.isFinite(parsed) && (parsed !== value || submit)) onSet(parsed, submit, queue)
            } else if (submit) {
                onSet(value, true, queue)
            }
            return null
        })
    }, [value, onSet])

    return (
        <div
            className="flex items-center gap-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-default)] pl-1 pr-1 py-0.5 focus-within:ring-2 focus-within:ring-[var(--accent-teal)]/40"
            title={`${label} (type a number, or ↑/↓ to change)`}
        >
            <input
                ref={(el) => { inputRef.current = el; if (focusRef) focusRef.current = el }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={editText ?? String(value)}
                onFocus={(e) => { setEditText(String(value)); e.target.select() }}
                onChange={(e) => setEditText(e.target.value.replace(/\D/g, ''))}
                onBlur={() => commit(false)}
                onKeyDown={(e) => {
                    // Enter = present live; Shift+Enter = add to queue; Escape cancels.
                    if (e.key === 'Enter') { e.preventDefault(); commit(true, e.shiftKey); inputRef.current?.blur() }
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
                    tabIndex={-1}
                    onClick={() => onStep(1)}
                    aria-label={`Increase ${label}`}
                    className="text-[var(--text-muted)] hover:text-[var(--accent-teal)] leading-none"
                >
                    <ChevronUp className="w-3 h-3" />
                </button>
                <button
                    type="button"
                    tabIndex={-1}
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
export interface ReferenceEditorHandle {
    /** Focus the book field — the fast keyboard entry point (then Tab moves on). */
    focus: () => void
    /** Advance focus to the next segment (book → chapter → verse → book). */
    cycle: () => void
    /** Whether `node` is inside this editor (so a shortcut can tell). */
    contains: (node: Node | null) => boolean
}

export const ReferenceEditor = forwardRef<ReferenceEditorHandle, ReferenceEditorProps>(function ReferenceEditor({ bookIndex, chapter, startVerse, endVerse, maxVerse, onChange }, ref) {
    const [bookOpen, setBookOpen] = useState(false)
    const [bookQuery, setBookQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const bookInputRef = useRef<HTMLInputElement>(null)
    const chapterInputRef = useRef<HTMLInputElement | null>(null)
    const verseInputRef = useRef<HTMLInputElement | null>(null)
    const bookBtnRef = useRef<HTMLButtonElement>(null)

    const focusSegment = useCallback((seg: 'book' | 'chapter' | 'verse') => {
        if (seg === 'book') bookBtnRef.current?.focus()
        else if (seg === 'chapter') { chapterInputRef.current?.focus(); chapterInputRef.current?.select() }
        else { verseInputRef.current?.focus(); verseInputRef.current?.select() }
    }, [])

    useImperativeHandle(ref, () => ({
        focus: () => focusSegment('book'),
        cycle: () => {
            const a = document.activeElement
            if (a === bookBtnRef.current) focusSegment('chapter')
            else if (a === chapterInputRef.current) focusSegment('verse')
            else focusSegment('book')
        },
        contains: (node: Node | null) => !!(node && containerRef.current?.contains(node)),
    }), [focusSegment])

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

    // Absolute setters — used when the operator types a number into a segment.
    // These jump straight to the value (clamped), independent of the current
    // one, so a typed "16" always lands on 16 regardless of what was showing.
    const setChapterAbsolute = useCallback((n: number, submit = false, queue = false) => {
        const max = BOOK_MAX_CHAPTER[bookName] ?? Infinity
        const next = Math.min(max, Math.max(1, Math.floor(n)))
        if (next === chapter && !submit) return
        onChange(makeRef(bookIndex, next, 1, 1), { submit, queue })
    }, [bookIndex, bookName, chapter, onChange])

    const setVerseAbsolute = useCallback((n: number, submit = false, queue = false) => {
        // Clamp to the chapter's TRUE verse count — not `maxVerse`, which only
        // reflects verses already fetched into the panel (often just a handful),
        // and would wrongly snap a typed "16" down to e.g. 4. Fall back to no
        // upper bound if we don't have a count for this chapter.
        const chapterMax = BOOK_MAX_VERSES[bookName]?.[chapter - 1]
        const next = clampVerse(n, chapterMax ? [chapterMax] : undefined)
        if (next === startVerse && next === endVerse && !submit) return
        onChange(makeRef(bookIndex, chapter, next, next), { submit, queue })
    }, [bookIndex, bookName, chapter, startVerse, endVerse, onChange])

    const onBookInputKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter' || e.key === 'Tab' || e.key === '`') {
            // A pure number typed on the book field means "chapter N" — keep the
            // current book, jump to that chapter, and flow to the verse. (Numbered
            // books like "1 John" are disambiguated by the letters: "1john" picks
            // the book, "1" alone is chapter 1.)
            const digits = bookQuery.trim()
            if (/^\d+$/.test(digits)) {
                e.preventDefault(); e.stopPropagation()
                setChapterAbsolute(parseInt(digits, 10))
                setBookOpen(false)
                setTimeout(() => focusSegment('verse'), 0)
                return
            }
            // Otherwise accept the highlighted book and flow straight to the
            // chapter — so "` r o m `" lands you on Romans' chapter field, no
            // re-cycling from the book. The ` is swallowed here (stopPropagation)
            // so the global shortcut doesn't also fire and bounce focus back.
            const s = suggestions[activeIndex]
            if (s) {
                e.preventDefault(); e.stopPropagation()
                pickBook(s.bookIndex)
                setTimeout(() => focusSegment('chapter'), 0)
            } else if (e.key === '`') {
                e.preventDefault(); e.stopPropagation()
            }
        } else if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation(); setBookOpen(false)
        }
    }, [bookQuery, suggestions, activeIndex, pickBook, setChapterAbsolute, focusSegment])

    return (
        <div ref={containerRef} className="relative flex items-center gap-1.5">
            {/* Book chip */}
            <button
                ref={bookBtnRef}
                type="button"
                onClick={() => (bookOpen ? setBookOpen(false) : openBookPicker())}
                onKeyDown={(e) => {
                    // Type-to-search: when the book chip is focused (e.g. via the
                    // ` shortcut), a letter/digit opens the picker seeded with it —
                    // so the operator just starts typing, no Enter first.
                    if (!bookOpen && e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
                        e.preventDefault()
                        setBookQuery(e.key)
                        setActiveIndex(0)
                        setBookOpen(true)
                        setTimeout(() => bookInputRef.current?.focus(), 0)
                    }
                }}
                aria-haspopup="listbox"
                aria-expanded={bookOpen}
                className="flex items-center gap-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-default)] px-2 py-1 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent-teal)]/40 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-teal)]/40 transition-colors"
                title="Change book"
            >
                {bookName}
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
            </button>

            <Stepper label="Chapter" value={chapter} onStep={stepChapterBy} onSet={setChapterAbsolute} focusRef={chapterInputRef} />
            <Stepper label="Verse" value={startVerse} onStep={stepVerseBy} onSet={setVerseAbsolute} focusRef={verseInputRef} />
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
                    {/^\d+$/.test(bookQuery.trim()) ? (
                        <div className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-secondary)]">
                            Go to <span className="font-semibold text-[var(--text-primary)]">{bookName} {bookQuery.trim()}</span>
                            <span className="text-[var(--text-muted)]"> — Enter / `</span>
                        </div>
                    ) : (
                        <BookAutocomplete
                            suggestions={suggestions}
                            activeIndex={activeIndex}
                            onSelect={(bi) => pickBook(bi)}
                            onHoverIndex={setActiveIndex}
                        />
                    )}
                </div>
            )}
        </div>
    )
})
