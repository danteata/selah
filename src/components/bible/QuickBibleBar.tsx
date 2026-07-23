import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Zap, Plus, X, Loader2, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useScripture, useSlideCreation, useSemanticVerseSearch, useLiveSession, useVerseNavigationShortcuts } from '../../hooks'
import { useAppStore } from '../../store/appStore'
import { bibleBooks, bibleVersionObjects } from '../../types'
import type { Scripture, BibleVerse } from '../../types'
import { parseBibleQuery, normalizeBibleReference, getRankedBookSuggestions, formatReferenceQuery, type ParsedBibleQuery } from '../../utils/bibleReference'
import { BookAutocomplete } from './BookAutocomplete'
import { ReferenceEditor } from './ReferenceEditor'

export function QuickBibleBar() {
    const quickBibleBarOpen = useAppStore((s) => s.quickBibleBarOpen)
    const setQuickBibleBarOpen = useAppStore((s) => s.setQuickBibleBarOpen)
    const appendActiveSlide = useAppStore((s) => s.appendActiveSlide)
    // Same dual-setter pattern as BibleList: route the live update
    // through useLiveSession().setLiveSlide when a live session is
    // connected so contributors' 'Go Live' actions broadcast to
    // every other device in the session, not just their own.
    const setLiveSlideLocal = useAppStore((s) => s.setLiveSlide)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)
    const setContextPanelOpen = useAppStore((s) => s.setContextPanelOpen)
    const setBiblePanelQuery = useAppStore((s) => s.setBiblePanelQuery)
    const defaultBibleVersion = useAppStore((s) => s.settings.defaultBibleVersion)
    const { fetchScripture } = useScripture()
    const { createBibleSlide } = useSlideCreation()
    const {
        setLiveSlide: setLiveSlideShared,
        isConnected,
        isOperator,
        isOpen,
    } = useLiveSession()
    const setLiveSlide = isConnected ? setLiveSlideShared : setLiveSlideLocal

    const [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false)
    const [currentScripture, setCurrentScripture] = useState<Scripture | null>(null)
    const [currentPosition, setCurrentPosition] = useState<{ bookIndex: number; bookName: string; chapter: number; startVerse: number; endVerse: number } | null>(null)
    const [neighboringVerses, setNeighboringVerses] = useState<{ prev: BibleVerse[]; next: BibleVerse[] }>({ prev: [], next: [] })
    const [focusedIndex, setFocusedIndex] = useState(-1)
    const [suggestionIndex, setSuggestionIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)

    const {
        results: semanticResults,
        isSearching: isSemanticSearching,
        hasEmbeddings,
        search: semanticSearch,
        clearResults: clearSemanticResults,
    } = useSemanticVerseSearch({
        threshold: 0.55,
        limit: 5,
        debounceMs: 300,
        minQueryLength: 3,
        version: defaultBibleVersion || undefined,
    })

    useEffect(() => {
        if (quickBibleBarOpen) {
            setTimeout(() => inputRef.current?.focus(), 100)
        } else {
            setQuery('')
            setCurrentScripture(null)
            setCurrentPosition(null)
            setNeighboringVerses({ prev: [], next: [] })
            clearSemanticResults()
        }
    }, [quickBibleBarOpen, clearSemanticResults])

    useEffect(() => {
        const trimmed = query.trim()
        // Normalize first so colon-less refs ("John 3 16") are recognized as
        // references and don't fall through to a semantic search.
        const looksLikeRef = parseBibleQuery(normalizeBibleReference(trimmed)) !== null
        if (trimmed.length >= 3 && !looksLikeRef && hasEmbeddings) {
            semanticSearch(trimmed)
        } else {
            clearSemanticResults()
        }
    }, [query, hasEmbeddings, semanticSearch, clearSemanticResults])

    // Book autocomplete: only while typing the book portion (no digits yet)
    // and before a scripture is shown.
    const bookSuggestions = useMemo(() => {
        if (currentScripture) return []
        const trimmed = query.trim()
        if (!trimmed || /\d/.test(trimmed)) return []
        return getRankedBookSuggestions(trimmed)
    }, [query, currentScripture])
    const suggestionsOpen = bookSuggestions.length > 0 && !currentScripture

    useEffect(() => {
        // Auto-highlight the top result so a meaning search is a single
        // keystroke: type → Enter presents the best match, no arrow/mouse
        // needed first (matches the BibleList panel).
        setFocusedIndex(semanticResults.length > 0 ? 0 : -1)
    }, [semanticResults])

    const fetchAndSetScripture = useCallback(async (parsed: { bookIndex: number; chapter: number; startVerse: number; endVerse: number; bookName: string }) => {
        setLoading(true)
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`
        const result = await fetchScripture(label, defaultBibleVersion || 'KJV')
        if (result) {
            setCurrentScripture(result)
            setCurrentPosition(parsed)
            const prevStart = Math.max(1, parsed.startVerse - 3)
            const prevResult = prevStart < parsed.startVerse
                ? await fetchScripture(`${parsed.bookIndex}:${parsed.chapter}:${prevStart}-${parsed.startVerse - 1}`, defaultBibleVersion || 'KJV')
                : null
            const nextResult = await fetchScripture(`${parsed.bookIndex}:${parsed.chapter}:${parsed.endVerse + 1}-${parsed.endVerse + 3}`, defaultBibleVersion || 'KJV')
            setNeighboringVerses({
                prev: prevResult && Array.isArray(prevResult.content) ? prevResult.content as BibleVerse[] : [],
                next: nextResult && Array.isArray(nextResult.content) ? nextResult.content as BibleVerse[] : []
            })
        }
        setLoading(false)
        return result
    }, [fetchScripture, defaultBibleVersion])

    // Accept a book from the autocomplete: drop in "Book " and keep typing.
    const acceptBookSuggestion = useCallback((bookName: string) => {
        setQuery(bookName + ' ')
        setSuggestionIndex(0)
        clearSemanticResults()
        inputRef.current?.focus()
    }, [clearSemanticResults])

    // Apply a reference produced by the inline stepper chips — keeps the text
    // input in sync and re-fetches through the same path as a typed search.
    const applyEditedReference = useCallback((next: ParsedBibleQuery) => {
        setQuery(formatReferenceQuery(next.bookIndex, next.chapter, next.startVerse, next.endVerse))
        void fetchAndSetScripture(next)
    }, [fetchAndSetScripture])

    // Auto-fetch a valid reference as it's typed so the verse appears
    // instantly — no separate "search" keystroke, and Enter then presents it
    // in one press (mirrors the BibleList panel). Debounced so we don't fetch
    // mid-type. Non-references fall through to the semantic effect above.
    useEffect(() => {
        const trimmed = query.trim()
        if (!trimmed) return
        const parsed = parseBibleQuery(normalizeBibleReference(trimmed))
        if (!parsed) return
        const timer = setTimeout(() => { void fetchAndSetScripture(parsed) }, 300)
        return () => clearTimeout(timer)
    }, [query, fetchAndSetScripture])

    // Highest loaded verse in the current chapter, to clamp the verse stepper.
    const maxVerseInChapter = useMemo(() => {
        if (!currentPosition) return undefined
        const ch = currentPosition.chapter
        const inChapter = (v: BibleVerse) => Number(v.chapter) === ch
        const cur = Array.isArray(currentScripture?.content) ? currentScripture!.content as BibleVerse[] : []
        const nums = [
            ...cur.map(v => Number(v.verse)),
            ...neighboringVerses.prev.filter(inChapter).map(v => Number(v.verse)),
            ...neighboringVerses.next.filter(inChapter).map(v => Number(v.verse)),
        ].filter(n => Number.isFinite(n))
        return nums.length ? Math.max(...nums) : undefined
    }, [currentPosition, currentScripture, neighboringVerses])

    const handleGoLive = useCallback(async (scripture: Scripture) => {
        const slide = createBibleSlide(scripture)
        if (slide) {
            // Gate on collaboration mode: in non-open modes a non-operator
            // cannot push to live (they can only queue via the sibling
            // 'Add' button).
            if (isConnected && !isOperator && !isOpen) return

            appendActiveSlide(slide)
            setLiveSlide(slide.id)
            // Cross-window sync — same event LiveOutput dispatches so the
            // operator/projection windows reflect the change immediately.
            window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: slide }))
        }
        if (currentPosition) {
            setBiblePanelQuery(`${currentPosition.bookName} ${currentPosition.chapter}:${currentPosition.startVerse}`)
        } else if (query) {
            setBiblePanelQuery(query)
        }
        setQuickBibleBarOpen(false)
        setActiveNavSection('bible')
        setContextPanelOpen(true)
    }, [createBibleSlide, appendActiveSlide, setLiveSlide, setQuickBibleBarOpen, setActiveNavSection, setContextPanelOpen, setBiblePanelQuery, currentPosition, query, isConnected, isOperator, isOpen])

    const handleAddToQueue = useCallback(async (scripture: Scripture) => {
        const slide = createBibleSlide(scripture)
        if (slide) {
            appendActiveSlide(slide)
        }
        if (currentPosition) {
            setBiblePanelQuery(`${currentPosition.bookName} ${currentPosition.chapter}:${currentPosition.startVerse}`)
        } else if (query) {
            setBiblePanelQuery(query)
        }
        setQuickBibleBarOpen(false)
        setActiveNavSection('bible')
        setContextPanelOpen(true)
    }, [createBibleSlide, appendActiveSlide, setQuickBibleBarOpen, setActiveNavSection, setContextPanelOpen, setBiblePanelQuery, currentPosition, query])

    // Enter pressed before the debounced auto-fetch has loaded the verse:
    // fetch the reference and immediately act on it (present, or queue on
    // Shift), so a reference is a single keystroke even for fast typers.
    const fetchAndAct = useCallback(async (queue: boolean) => {
        const parsed = parseBibleQuery(normalizeBibleReference(query))
        if (!parsed) return
        const result = await fetchAndSetScripture(parsed)
        if (result) {
            if (queue) handleAddToQueue(result)
            else handleGoLive(result)
        }
    }, [query, fetchAndSetScripture, handleGoLive, handleAddToQueue])

    const navigateVerse = useCallback((direction: 'prev' | 'next') => {
        if (!currentPosition) return
        const range = currentPosition.endVerse - currentPosition.startVerse + 1
        let newStart: number
        let newEnd: number
        if (direction === 'prev') {
            newStart = Math.max(1, currentPosition.startVerse - range)
            newEnd = newStart + range - 1
        } else {
            newStart = currentPosition.endVerse + 1
            newEnd = newStart + range - 1
        }
        const newQuery = `${currentPosition.bookName} ${currentPosition.chapter}:${newStart}${newEnd !== newStart ? `-${newEnd}` : ''}`
        setQuery(newQuery)
        const parsed = parseBibleQuery(newQuery)
        if (parsed) fetchAndSetScripture(parsed)
    }, [currentPosition, fetchAndSetScripture])

    // Verse navigation keyboard shortcuts (N / P / ← / →). Only active when
    // a scripture result is currently displayed in the bar, so it doesn't
    // shadow the search-result keyboard navigation handled in handleKeyDown.
    useVerseNavigationShortcuts(
        () => navigateVerse('next'),
        () => navigateVerse('prev'),
        { enabled: !!currentScripture }
    )

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Book autocomplete takes ↑/↓/Tab/Enter/→ while open.
        if (suggestionsOpen) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestionIndex(i => (i + 1) % bookSuggestions.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestionIndex(i => i <= 0 ? bookSuggestions.length - 1 : i - 1); return }
            if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowRight') {
                const s = bookSuggestions[suggestionIndex] ?? bookSuggestions[0]
                if (s) { e.preventDefault(); acceptBookSuggestion(s.book); return }
            }
        }
        if (e.key === 'Enter') {
            e.preventDefault()
            // Contract: Enter = present now, Shift+Enter = add to queue.
            if (currentScripture) {
                if (e.shiftKey) handleAddToQueue(currentScripture)
                else handleGoLive(currentScripture)
            } else if (focusedIndex >= 0 && semanticResults.length > 0) {
                const r = semanticResults[focusedIndex]
                const label = `${r.bookNumber}:${r.chapter}:${r.verse}`
                // Capture the modifier before the async gap.
                const queue = e.shiftKey
                fetchScripture(label, defaultBibleVersion || 'KJV').then(result => {
                    if (result) {
                        setCurrentScripture(result)
                        setCurrentPosition({ bookIndex: r.bookNumber, bookName: r.reference.split(' ')[0], chapter: r.chapter, startVerse: r.verse, endVerse: r.verse })
                        if (queue) handleAddToQueue(result)
                        else handleGoLive(result)
                    }
                })
            } else {
                // No verse loaded yet (typed a reference and hit Enter before
                // the auto-fetch fired) — fetch and act in one press.
                fetchAndAct(e.shiftKey)
            }
        } else if (e.key === 'ArrowDown') {
            if (semanticResults.length > 0 && !currentScripture) {
                e.preventDefault()
                setFocusedIndex(prev => Math.min(prev + 1, semanticResults.length - 1))
            }
        } else if (e.key === 'ArrowUp') {
            if (semanticResults.length > 0 && !currentScripture) {
                e.preventDefault()
                setFocusedIndex(prev => Math.max(prev - 1, 0))
            }
        } else if (e.key === 'Escape') {
            if (currentScripture) {
                setCurrentScripture(null)
                setCurrentPosition(null)
                setNeighboringVerses({ prev: [], next: [] })
            } else {
                setQuickBibleBarOpen(false)
            }
        }
    }, [currentScripture, focusedIndex, semanticResults, handleGoLive, handleAddToQueue, fetchAndAct, fetchScripture, defaultBibleVersion, setQuickBibleBarOpen, suggestionsOpen, bookSuggestions, suggestionIndex, acceptBookSuggestion])

    const handleSelectSemantic = useCallback(async (bookNumber: number, chapter: number, verse: number) => {
        const label = `${bookNumber}:${chapter}:${verse}`
        const result = await fetchScripture(label, defaultBibleVersion || 'KJV')
        if (result) {
            setCurrentScripture(result)
            setCurrentPosition({ bookIndex: bookNumber, bookName: result.label?.split(' ')[0] || '', chapter, startVerse: verse, endVerse: verse })
        }
    }, [fetchScripture, defaultBibleVersion])

    if (!quickBibleBarOpen) return null

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
            >
                <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setQuickBibleBarOpen(false)} />
                <motion.div
                    className="relative w-full max-w-lg"
                    initial={{ y: -20, opacity: 0, scale: 0.98 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: -10, opacity: 0, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                >
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden">
                        {/* Search input */}
                        <div className="flex items-center gap-2 p-3 border-b border-[var(--border-subtle)]">
                            <BookOpen className="w-4 h-4 text-[var(--accent-teal)] shrink-0" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value)
                                    setSuggestionIndex(0)
                                    setCurrentScripture(null)
                                    setCurrentPosition(null)
                                }}
                                onKeyDown={handleKeyDown}
                                placeholder="Quick verse... (Enter = Present, Shift+Enter = Add to queue, Esc = back)"
                                className="flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none text-sm"
                            />
                            {query && (
                                <button onClick={() => { setQuery(''); setCurrentScripture(null); setCurrentPosition(null); setNeighboringVerses({ prev: [], next: [] }) }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                            {loading && <Loader2 className="w-4 h-4 text-[var(--accent-teal)] animate-spin shrink-0" />}
                        </div>

                        {/* Book autocomplete — rendered in-flow so the card's
                            overflow-hidden doesn't clip it. */}
                        {suggestionsOpen && (
                            <div className="p-2 border-b border-[var(--border-subtle)]">
                                <BookAutocomplete
                                    suggestions={bookSuggestions}
                                    activeIndex={suggestionIndex}
                                    onSelect={(_bi, bookName) => acceptBookSuggestion(bookName)}
                                    onHoverIndex={setSuggestionIndex}
                                />
                            </div>
                        )}

                        {/* Scripture result with verse navigation */}
                        {currentScripture && currentPosition && (
                            <div className="p-3 border-b border-[var(--border-subtle)]">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <button
                                            onClick={() => navigateVerse('prev')}
                                            title="Previous verses"
                                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-tertiary)]"
                                        >
                                            <ChevronLeft className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => navigateVerse('next')}
                                            title="Next verses"
                                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-tertiary)]"
                                        >
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </button>
                                        <ReferenceEditor
                                            bookIndex={currentPosition.bookIndex}
                                            chapter={currentPosition.chapter}
                                            startVerse={currentPosition.startVerse}
                                            endVerse={currentPosition.endVerse}
                                            maxVerse={maxVerseInChapter}
                                            onChange={applyEditedReference}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
                                    {(currentScripture.content as BibleVerse[])?.map((v, i) => (
                                        <p key={i} className="text-xs text-[var(--text-primary)] leading-relaxed">
                                            <sup className="text-[var(--accent-teal)] font-semibold mr-1 text-[0.6em]">{v.verse}</sup>
                                            {v.scripture}
                                        </p>
                                    ))}
                                </div>

                                {(neighboringVerses.prev.length > 0 || neighboringVerses.next.length > 0) && (
                                    <div className="mb-2">
                                        <div className="flex flex-wrap gap-1">
                                            {neighboringVerses.prev.map(v => (
                                                <button
                                                    key={v.verse}
                                                    onClick={async () => {
                                                        const ref = `${currentPosition.bookName} ${currentPosition.chapter}:${v.verse}`
                                                        setQuery(ref)
                                                        const parsed = parseBibleQuery(ref)
                                                        if (parsed) await fetchAndSetScripture(parsed)
                                                    }}
                                                    className="px-1.5 py-0.5 text-[10px] bg-[var(--bg-tertiary)] hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)] rounded transition-colors"
                                                >
                                                    {v.verse}
                                                </button>
                                            ))}
                                            {(currentScripture.content as BibleVerse[])?.map(v => (
                                                <span key={v.verse} className="px-1.5 py-0.5 text-[10px] bg-[var(--accent-teal)] text-white rounded font-medium">{v.verse}</span>
                                            ))}
                                            {neighboringVerses.next.map(v => (
                                                <button
                                                    key={v.verse}
                                                    onClick={async () => {
                                                        const ref = `${currentPosition.bookName} ${currentPosition.chapter}:${v.verse}`
                                                        setQuery(ref)
                                                        const parsed = parseBibleQuery(ref)
                                                        if (parsed) await fetchAndSetScripture(parsed)
                                                    }}
                                                    className="px-1.5 py-0.5 text-[10px] bg-[var(--bg-tertiary)] hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)] rounded transition-colors"
                                                >
                                                    {v.verse}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleAddToQueue(currentScripture)}
                                        className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--accent-teal)]/10 text-xs font-medium border border-[var(--border-default)] transition-colors"
                                    >
                                        <Plus className="w-3 h-3" /> Add
                                    </button>
                                    <button
                                        onClick={() => handleGoLive(currentScripture)}
                                        className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 text-xs font-medium transition-all"
                                    >
                                        <Zap className="w-3 h-3" /> Live
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Semantic search results */}
                        {!currentScripture && (semanticResults.length > 0) && (
                            <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                                {semanticResults.map((verse, i) => (
                                    <button
                                        key={verse._id}
                                        onClick={() => handleSelectSemantic(verse.bookNumber, verse.chapter, verse.verse)}
                                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${focusedIndex === i
                                            ? 'bg-[var(--accent-teal)]/10 border border-[var(--accent-teal)]/30'
                                            : 'hover:bg-[var(--accent-teal)]/5 border border-transparent'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium text-[var(--text-primary)]">{verse.reference}</span>
                                            <span className="text-[10px] text-[var(--accent-teal)]">{Math.round(verse.score * 100)}%</span>
                                        </div>
                                        <p className="text-xs text-[var(--text-tertiary)] line-clamp-1 mt-0.5">{verse.text}</p>
                                    </button>
                                ))}
                            </div>
                        )}

                        {isSemanticSearching && (
                            <div className="flex items-center justify-center gap-2 py-3 text-xs text-[var(--text-muted)]">
                                <Loader2 className="w-3 h-3 animate-spin text-[var(--accent-teal)]" />
                                Searching...
                            </div>
                        )}

                        {!currentScripture && semanticResults.length === 0 && !isSemanticSearching && !loading && query && (
                            parseBibleQuery(normalizeBibleReference(query.trim()))
                                ? (
                                    <div className="px-4 py-3 text-xs text-[var(--text-muted)] text-center">
                                        No verse found for &ldquo;{query.trim()}&rdquo;. Check the chapter and verse.
                                    </div>
                                ) : (
                                    <div className="px-4 py-3 text-xs text-[var(--text-muted)] text-center">
                                        Type a verse reference like &quot;John 3:16&quot; or search by meaning
                                    </div>
                                )
                        )}
                    </div>
                    <div className="text-center mt-2 text-[10px] text-white/30">
                        <kbd className="px-1 py-0.5 bg-white/10 rounded text-[9px]">Ctrl+B</kbd> to toggle &middot; <kbd className="px-1 py-0.5 bg-white/10 rounded text-[9px]">↑↓</kbd> navigate
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}