import { useState, useCallback, useRef, useEffect } from 'react'
import { Zap, Plus, X, Loader2, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useScripture, useSlideCreation, useSemanticVerseSearch, useLiveSession, useVerseNavigationShortcuts } from '../../hooks'
import { useAppStore } from '../../store/appStore'
import { bibleBooks, bibleVersionObjects } from '../../types'
import type { Scripture, BibleVerse } from '../../types'
import { parseBibleQuery } from '../../utils/bibleReference'

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
        const looksLikeRef = /^((?:\d\s?)?[a-z]+)\s+(\d+):(\d+)/i.test(trimmed) || /^(\d+):(\d+):(\d+)/.test(trimmed)
        if (trimmed.length >= 3 && !looksLikeRef && hasEmbeddings) {
            semanticSearch(trimmed)
        } else {
            clearSemanticResults()
        }
    }, [query, hasEmbeddings, semanticSearch, clearSemanticResults])

    useEffect(() => {
        setFocusedIndex(-1)
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

    const handleSearch = useCallback(async () => {
        const parsed = parseBibleQuery(query)
        if (!parsed) return
        await fetchAndSetScripture(parsed)
    }, [query, fetchAndSetScripture])

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
        if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey && currentScripture) {
                handleGoLive(currentScripture)
            } else if (currentScripture) {
                handleGoLive(currentScripture)
            } else if (focusedIndex >= 0 && semanticResults.length > 0) {
                const r = semanticResults[focusedIndex]
                const label = `${r.bookNumber}:${r.chapter}:${r.verse}`
                fetchScripture(label, defaultBibleVersion || 'KJV').then(result => {
                    if (result) {
                        setCurrentScripture(result)
                        setCurrentPosition({ bookIndex: r.bookNumber, bookName: r.reference.split(' ')[0], chapter: r.chapter, startVerse: r.verse, endVerse: r.verse })
                        if (e.shiftKey) handleGoLive(result)
                    }
                })
            } else {
                handleSearch()
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
    }, [currentScripture, focusedIndex, semanticResults, handleGoLive, handleSearch, fetchScripture, defaultBibleVersion, setQuickBibleBarOpen])

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

                        {/* Scripture result with verse navigation */}
                        {currentScripture && currentPosition && (
                            <div className="p-3 border-b border-[var(--border-subtle)]">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">{currentScripture.label}</h4>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => navigateVerse('prev')}
                                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-tertiary)]"
                                        >
                                            <ChevronLeft className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => navigateVerse('next')}
                                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-tertiary)]"
                                        >
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </button>
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

                        {!currentScripture && semanticResults.length === 0 && !isSemanticSearching && query && (
                            <div className="px-4 py-3 text-xs text-[var(--text-muted)] text-center">
                                Type a verse reference like &quot;John 3:16&quot; or search by meaning
                            </div>
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