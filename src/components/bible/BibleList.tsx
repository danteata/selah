import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search, ChevronLeft, ChevronRight, BookOpen, Zap, Plus, X, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useScripture, useSlideCreation, useSemanticVerseSearch } from '../../hooks'
import { useAppStore } from '../../store/appStore'
import { useTemplates } from '../../hooks/useTemplates'
import type { Scripture, BibleVerse } from '../../types'
import type { TemplateItem } from '../../hooks/useTemplates'
import { bibleBooks, bibleVersionObjects } from '../../types'

const bookAbbreviations: Record<string, string> = {
    'gen': 'Genesis', 'ex': 'Exodus', 'exod': 'Exodus', 'lev': 'Leviticus',
    'num': 'Numbers', 'deut': 'Deuteronomy', 'dt': 'Deuteronomy',
    'josh': 'Joshua', 'judg': 'Judges', 'ruth': 'Ruth',
    '1sam': '1 Samuel', '1sa': '1 Samuel', '2sam': '2 Samuel', '2sa': '2 Samuel',
    '1kgs': '1 Kings', '1ki': '1 Kings', '2kgs': '2 Kings', '2ki': '2 Kings',
    '1chr': '1 Chronicles', '1ch': '1 Chronicles', '2chr': '2 Chronicles', '2ch': '2 Chronicles',
    'ezra': 'Ezra', 'neh': 'Nehemiah', 'esth': 'Esther', 'est': 'Esther',
    'job': 'Job', 'ps': 'Psalms', 'psa': 'Psalms', 'psalm': 'Psalms',
    'prov': 'Proverbs', 'pr': 'Proverbs', 'eccl': 'Ecclesiastes', 'ec': 'Ecclesiastes',
    'song': 'Song of Solomon', 'sos': 'Song of Solomon', 'isa': 'Isaiah',
    'jer': 'Jeremiah', 'lam': 'Lamentations', 'ezek': 'Ezekiel', 'dan': 'Daniel',
    'hos': 'Hosea', 'joel': 'Joel', 'amos': 'Amos', 'obad': 'Obadiah', 'ob': 'Obadiah',
    'jon': 'Jonah', 'mic': 'Micah', 'nah': 'Nahum', 'hab': 'Habakkuk',
    'zeph': 'Zephaniah', 'hag': 'Haggai', 'zech': 'Zechariah', 'zec': 'Zechariah',
    'mal': 'Malachi',
    'mt': 'Matthew', 'matt': 'Matthew', 'mk': 'Mark', 'mrk': 'Mark',
    'lk': 'Luke', 'luk': 'Luke', 'jn': 'John', 'joh': 'John',
    'acts': 'Acts', 'act': 'Acts', 'rom': 'Romans', 'ro': 'Romans',
    '1cor': '1 Corinthians', '1co': '1 Corinthians', '2cor': '2 Corinthians', '2co': '2 Corinthians',
    'gal': 'Galatians', 'ga': 'Galatians', 'eph': 'Ephesians', 'ep': 'Ephesians',
    'phil': 'Philippians', 'php': 'Philippians', 'col': 'Colossians',
    '1thess': '1 Thessalonians', '1th': '1 Thessalonians', '2thess': '2 Thessalonians', '2th': '2 Thessalonians',
    '1tim': '1 Timothy', '1ti': '1 Timothy', '2tim': '2 Timothy', '2ti': '2 Timothy',
    'tit': 'Titus', 'titus': 'Titus', 'phlm': 'Philemon', 'philem': 'Philemon',
    'heb': 'Hebrews', 'jas': 'James', 'jam': 'James', 'james': 'James',
    '1pet': '1 Peter', '1pe': '1 Peter', '1pt': '1 Peter', '2pet': '2 Peter', '2pe': '2 Peter', '2pt': '2 Peter',
    '1jn': '1 John', '1joh': '1 John', '1john': '1 John', '2jn': '2 John', '2joh': '2 John', '2john': '2 John',
    '3jn': '3 John', '3joh': '3 John', '3john': '3 John', 'jude': 'Jude', 'rev': 'Revelation',
    'revelations': 'Revelation', 'revelation': 'Revelation',
}

const RECENT_VERSES_KEY = 'selah-recent-verses'
const MAX_RECENT = 5

interface BibleListProps {
    initialQuery?: string
    onClose: () => void
    isInline?: boolean
}

interface VerseRow {
    bookIndex: number
    chapter: number
    verse: number
    scripture: string
    reference: string
    isCurrent: boolean
    source: 'reference' | 'semantic' | 'neighbor'
    score?: number
}

export function BibleList({ initialQuery = '', onClose, isInline = false }: BibleListProps) {
    const biblePanelQuery = useAppStore((state) => state.biblePanelQuery)
    const setBiblePanelQuery = useAppStore((state) => state.setBiblePanelQuery)
    const [query, setQuery] = useState(initialQuery || biblePanelQuery || '')
    const [loading, setLoading] = useState(false)
    const [selectedVersion, setSelectedVersion] = useState<string>('')
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [currentBookIndex, setCurrentBookIndex] = useState<number | null>(null)
    const [currentChapter, setCurrentChapter] = useState<number | null>(null)
    const [currentStartVerse, setCurrentStartVerse] = useState<number | null>(null)
    const [currentEndVerse, setCurrentEndVerse] = useState<number | null>(null)
    const [currentVerses, setCurrentVerses] = useState<BibleVerse[]>([])
    const [neighborVerses, setNeighborVerses] = useState<{ prev: BibleVerse[]; next: BibleVerse[] }>({ prev: [], next: [] })
    const [hasSearched, setHasSearched] = useState(false)
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)
    const [focusedIndex, setFocusedIndex] = useState(-1)
    const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [recentVerses, setRecentVerses] = useState<string[]>(() => {
        try {
            const stored = localStorage.getItem(RECENT_VERSES_KEY)
            return stored ? JSON.parse(stored) : []
        } catch { return [] }
    })

    const inputRef = useRef<HTMLInputElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    const { fetchScripture } = useScripture()
    const { createBibleSlide } = useSlideCreation()
    const appendActiveSlide = useAppStore((s) => s.appendActiveSlide)
    const setLiveSlide = useAppStore((s) => s.setLiveSlide)
    const defaultBibleVersion = useAppStore((s) => s.settings.defaultBibleVersion)
    const { templates } = useTemplates()

    const {
        results: semanticResults,
        isSearching: isSemanticSearching,
        hasEmbeddings,
        isEmbedderReady,
        search: semanticSearch,
        clearResults: clearSemanticResults,
        initEmbedder,
    } = useSemanticVerseSearch({
        threshold: 0.55,
        limit: 5,
        debounceMs: 400,
        minQueryLength: 3,
        version: selectedVersion || undefined,
    })

    useEffect(() => {
        if (!selectedVersion) setSelectedVersion(defaultBibleVersion || 'KJV')
    }, [defaultBibleVersion, selectedVersion])

    useEffect(() => {
        if (hasEmbeddings && !isEmbedderReady) initEmbedder()
    }, [hasEmbeddings, isEmbedderReady, initEmbedder])

    useEffect(() => { inputRef.current?.focus() }, [])

    useEffect(() => {
        if (biblePanelQuery) { setQuery(biblePanelQuery); setBiblePanelQuery('') }
    }, [biblePanelQuery, setBiblePanelQuery])

    useEffect(() => { setFocusedIndex(-1) }, [semanticResults, currentVerses, neighborVerses])
    useEffect(() => {
        const rows = buildVerseRows()
        if (rows.length > 0 && focusedIndex === -1 && hasSearched) setFocusedIndex(0)
    })

    const bookSuggestions = useMemo(() => {
        if (!query || query.includes(':')) return []
        const lq = query.toLowerCase().trim()
        const am = bookAbbreviations[lq]
        if (am) return [am]
        return bibleBooks.filter(b => b.toLowerCase().startsWith(lq) || b.toLowerCase().includes(lq)).slice(0, 5)
    }, [query])

    const parseQuery = useCallback((q: string) => {
        const trimmed = q.trim()
        if (!trimmed) return null
        const fullPattern = /^((?:\d\s?)?[a-z]+)\s+(\d+):(\d+)(?:-(\d+))?$/i
        const match = trimmed.match(fullPattern)
        if (match) {
            const bookInput = match[1].toLowerCase()
            const chapter = parseInt(match[2])
            const startVerse = parseInt(match[3])
            const endVerse = match[4] ? parseInt(match[4]) : startVerse
            let bookName: string | undefined = bookAbbreviations[bookInput]
            if (!bookName) {
                const found = bibleBooks.find(b => b.toLowerCase() === bookInput || b.toLowerCase().startsWith(bookInput))
                bookName = found
            }
            if (bookName) {
                const bookIndex = bibleBooks.indexOf(bookName as typeof bibleBooks[number]) + 1
                return { bookIndex, bookName, chapter, startVerse, endVerse }
            }
        }
        const numericPattern = /^(\d+):(\d+):(\d+)(?:-(\d+))?$/
        const numMatch = trimmed.match(numericPattern)
        if (numMatch) {
            const bookIndex = parseInt(numMatch[1])
            const bookName = bibleBooks[bookIndex - 1]
            return { bookIndex, bookName, chapter: parseInt(numMatch[2]), startVerse: parseInt(numMatch[3]), endVerse: numMatch[4] ? parseInt(numMatch[4]) : parseInt(numMatch[3]) }
        }
        return null
    }, [])

    const addRecentVerse = useCallback((ref: string) => {
        setRecentVerses(prev => {
            const next = [ref, ...prev.filter(v => v !== ref)].slice(0, MAX_RECENT)
            try { localStorage.setItem(RECENT_VERSES_KEY, JSON.stringify(next)) } catch {}
            return next
        })
    }, [])

    const goLiveWithScripture = useCallback(async (bookIndex: number, chapter: number, verse: number) => {
        const label = `${bookIndex}:${chapter}:${verse}`
        const result = await fetchScripture(label, selectedVersion)
        if (result) {
            const slide = createBibleSlide(result, { template: selectedTemplate })
            if (slide) {
                appendActiveSlide(slide)
                setLiveSlide(slide.id)
                addRecentVerse(result.label || '')
            }
        }
    }, [fetchScripture, selectedVersion, createBibleSlide, selectedTemplate, appendActiveSlide, setLiveSlide, addRecentVerse])

    const addToQueue = useCallback(async (bookIndex: number, chapter: number, verse: number) => {
        const label = `${bookIndex}:${chapter}:${verse}`
        const result = await fetchScripture(label, selectedVersion)
        if (result) {
            const slide = createBibleSlide(result, { template: selectedTemplate })
            if (slide) {
                appendActiveSlide(slide)
                addRecentVerse(result.label || '')
            }
        }
    }, [fetchScripture, selectedVersion, createBibleSlide, selectedTemplate, appendActiveSlide, addRecentVerse])

    const handleSearch = useCallback(async () => {
        const parsed = parseQuery(query)
        if (!parsed) return
        if (hasSearched && currentBookIndex === parsed.bookIndex && currentChapter === parsed.chapter && currentStartVerse === parsed.startVerse && currentEndVerse === parsed.endVerse) return
        setLoading(true)
        setHasSearched(true)
        setNeighborVerses({ prev: [], next: [] })
        setFocusedIndex(-1)
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`
        const result = await fetchScripture(label, selectedVersion)
        if (result && Array.isArray(result.content)) {
            setCurrentVerses(result.content as BibleVerse[])
            setCurrentBookIndex(parsed.bookIndex)
            setCurrentChapter(parsed.chapter)
            setCurrentStartVerse(parsed.startVerse)
            setCurrentEndVerse(parsed.endVerse)
        }
        setLoading(false)
        const { bookIndex, chapter, startVerse, endVerse } = parsed
        const prevStart = Math.max(1, startVerse - 3)
        const prevPromise = prevStart < startVerse
            ? fetchScripture(`${bookIndex}:${chapter}:${prevStart}-${startVerse - 1}`, selectedVersion)
            : Promise.resolve(null)
        const nextPromise = fetchScripture(`${bookIndex}:${chapter}:${endVerse + 1}-${endVerse + 3}`, selectedVersion)
        Promise.all([prevPromise, nextPromise]).then(([prevResult, nextResult]) => {
            setNeighborVerses({
                prev: prevResult && Array.isArray(prevResult.content) ? prevResult.content as BibleVerse[] : [],
                next: nextResult && Array.isArray(nextResult.content) ? nextResult.content as BibleVerse[] : [],
            })
        })
        setShowSuggestions(false)
    }, [query, parseQuery, fetchScripture, selectedVersion, hasSearched, currentBookIndex, currentChapter, currentStartVerse, currentEndVerse])

    // Auto-search: reference queries trigger after 500ms debounce, semantic queries use their own debounce
    useEffect(() => {
        const trimmed = query.trim()
        if (!trimmed || !selectedVersion) return

        if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current)

        const parsed = parseQuery(trimmed)
        if (parsed) {
            autoSearchTimerRef.current = setTimeout(() => {
                handleSearch()
            }, 500)
            clearSemanticResults()
        } else if (trimmed.length >= 3 && hasEmbeddings) {
            semanticSearch(trimmed)
        } else {
            clearSemanticResults()
        }

        return () => { if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current) }
    }, [query, selectedVersion, hasEmbeddings, semanticSearch, clearSemanticResults, parseQuery, handleSearch])

    const navigateVerse = useCallback((direction: 'prev' | 'next') => {
        if (!currentBookIndex || !currentChapter || !currentStartVerse) return
        const range = (currentEndVerse || currentStartVerse) - currentStartVerse + 1
        let newStart: number, newEnd: number
        if (direction === 'prev') {
            newStart = Math.max(1, currentStartVerse - range)
            newEnd = newStart + range - 1
        } else {
            newStart = (currentEndVerse || currentStartVerse) + 1
            newEnd = newStart + range - 1
        }
        const bookName = bibleBooks[currentBookIndex - 1]
        setQuery(`${bookName} ${currentChapter}:${newStart}${newEnd !== newStart ? `-${newEnd}` : ''}`)
        setHasSearched(false)
        setCurrentVerses([])
        setNeighborVerses({ prev: [], next: [] })
        // Auto-trigger search after navigation
        const parsed = parseQuery(`${bookName} ${currentChapter}:${newStart}${newEnd !== newStart ? `-${newEnd}` : ''}`)
        if (!parsed) return
        setLoading(true)
        setHasSearched(true)
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`
        fetchScripture(label, selectedVersion).then(result => {
            if (result && Array.isArray(result.content)) {
                setCurrentVerses(result.content as BibleVerse[])
                setCurrentBookIndex(parsed.bookIndex)
                setCurrentChapter(parsed.chapter)
                setCurrentStartVerse(parsed.startVerse)
                setCurrentEndVerse(parsed.endVerse)
            }
            setLoading(false)
        })
        // Neighbors in parallel
        const prevStart = Math.max(1, parsed.startVerse - 3)
        const prevP = prevStart < parsed.startVerse ? fetchScripture(`${parsed.bookIndex}:${parsed.chapter}:${prevStart}-${parsed.startVerse - 1}`, selectedVersion) : Promise.resolve(null)
        const nextP = fetchScripture(`${parsed.bookIndex}:${parsed.chapter}:${parsed.endVerse + 1}-${parsed.endVerse + 3}`, selectedVersion)
        Promise.all([prevP, nextP]).then(([pr, nr]) => {
            setNeighborVerses({
                prev: pr && Array.isArray(pr.content) ? pr.content as BibleVerse[] : [],
                next: nr && Array.isArray(nr.content) ? nr.content as BibleVerse[] : [],
            })
        })
    }, [currentBookIndex, currentChapter, currentStartVerse, currentEndVerse, parseQuery, fetchScripture, selectedVersion])

    const changeVersion = useCallback((newVersion: string) => {
        setSelectedVersion(newVersion)
        if (hasSearched) setTimeout(() => handleSearch(), 0)
    }, [hasSearched, handleSearch])

    const buildVerseRows = useCallback((): VerseRow[] => {
        const rows: VerseRow[] = []
        if (hasSearched && currentBookIndex && currentChapter) {
            for (const nv of neighborVerses.prev) {
                rows.push({ bookIndex: currentBookIndex, chapter: currentChapter, verse: nv.verse, scripture: nv.scripture, reference: `${bibleBooks[currentBookIndex - 1]} ${currentChapter}:${nv.verse}`, isCurrent: false, source: 'neighbor' })
            }
            for (const cv of currentVerses) {
                rows.push({ bookIndex: currentBookIndex!, chapter: currentChapter!, verse: cv.verse, scripture: cv.scripture, reference: `${bibleBooks[currentBookIndex! - 1]} ${currentChapter}:${cv.verse}`, isCurrent: true, source: 'reference' })
            }
            for (const nv of neighborVerses.next) {
                rows.push({ bookIndex: currentBookIndex, chapter: currentChapter, verse: nv.verse, scripture: nv.scripture, reference: `${bibleBooks[currentBookIndex - 1]} ${currentChapter}:${nv.verse}`, isCurrent: false, source: 'neighbor' })
            }
        }
        if (!hasSearched) {
            for (const sr of semanticResults) {
                rows.push({ bookIndex: sr.bookNumber, chapter: sr.chapter, verse: sr.verse, scripture: sr.text, reference: sr.reference, isCurrent: false, source: 'semantic', score: sr.score })
            }
        }
        return rows
    }, [hasSearched, currentBookIndex, currentChapter, currentVerses, neighborVerses, semanticResults])

    const verseRows = useMemo(() => buildVerseRows(), [buildVerseRows])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (focusedIndex >= 0 && verseRows.length > 0) {
                const row = verseRows[focusedIndex]
                if (e.shiftKey) goLiveWithScripture(row.bookIndex, row.chapter, row.verse)
                else addToQueue(row.bookIndex, row.chapter, row.verse)
            } else if (!hasSearched) {
                handleSearch()
            }
        } else if (e.key === 'ArrowDown') {
            if (verseRows.length > 0) {
                e.preventDefault()
                setFocusedIndex(prev => (prev + 1) % verseRows.length)
            }
        } else if (e.key === 'ArrowUp') {
            if (verseRows.length > 0) {
                e.preventDefault()
                setFocusedIndex(prev => prev <= 0 ? verseRows.length - 1 : prev - 1)
            }
        } else if (e.key === 'Escape') {
            if (hasSearched) {
                setHasSearched(false)
                setCurrentVerses([])
                setNeighborVerses({ prev: [], next: [] })
                setFocusedIndex(-1)
            } else {
                onClose()
            }
        } else if (e.key === 'Tab') {
            e.preventDefault()
            const ci = bibleVersionObjects.findIndex(v => v.id === selectedVersion)
            setSelectedVersion(bibleVersionObjects[(ci + 1) % bibleVersionObjects.length].id)
        }
    }, [focusedIndex, verseRows, hasSearched, handleSearch, goLiveWithScripture, addToQueue, onClose, selectedVersion])

    const handleRecentVerseClick = useCallback((ref: string) => {
        setQuery(ref)
        setHasSearched(false)
        setCurrentVerses([])
        setNeighborVerses({ prev: [], next: [] })
        setTimeout(() => handleSearch(), 0)
    }, [handleSearch])

    const handleRecentVerseGoLive = useCallback(async (ref: string) => {
        const parsed = parseQuery(ref)
        if (!parsed) return
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`
        const result = await fetchScripture(label, selectedVersion)
        if (result) {
            const slide = createBibleSlide(result, { template: null })
            if (slide) { appendActiveSlide(slide); setLiveSlide(slide.id); addRecentVerse(ref) }
        }
    }, [parseQuery, fetchScripture, selectedVersion, createBibleSlide, appendActiveSlide, setLiveSlide, addRecentVerse])

    const downloadedVersions = useMemo(() => bibleVersionObjects.filter(v => v.isDownloaded), [])

    return (
        <div className="h-full flex flex-col bg-[var(--bg-secondary)] rounded-lg">
            {!isInline && (
                <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)]"><ChevronLeft className="w-5 h-5" /></button>
                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Display Bible</h2>
                    </div>
                </div>
            )}

            {/* Recent Verses Strip */}
            {recentVerses.length > 0 && (
                <div className="px-3 pt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] shrink-0">Recent</span>
                    {recentVerses.map((ref) => (
                        <button key={ref} onClick={() => handleRecentVerseClick(ref)} className="group relative px-2 py-0.5 text-xs font-medium bg-[var(--bg-tertiary)] hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)] rounded-full border border-[var(--border-default)] transition-colors">
                            {ref}
                            <span onClick={(e) => { e.stopPropagation(); handleRecentVerseGoLive(ref) }} className="ml-1 text-[var(--accent-teal)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" title="Go Live">⚡</span>
                        </button>
                    ))}
                    <button onClick={() => { setRecentVerses([]); try { localStorage.removeItem(RECENT_VERSES_KEY) } catch {} }} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">clear</button>
                </div>
            )}

            {/* Search bar — always visible */}
            <div className="p-4 border-b border-[var(--border-subtle)]">
                <div className="relative flex items-center gap-2">
                    <select value={selectedVersion} onChange={(e) => changeVersion(e.target.value)} className="shrink-0 px-2 py-2.5 text-xs font-medium rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--accent-teal)]/30 outline-none appearance-none cursor-pointer">
                        {bibleVersionObjects.map((v) => (<option key={v.id} value={v.id}>{v.id}</option>))}
                    </select>
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)] w-4 h-4" />
                        <input ref={inputRef} type="text" value={query} onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); if (hasSearched) { setHasSearched(false); setCurrentVerses([]); setNeighborVerses({ prev: [], next: [] }) } }} onKeyDown={handleKeyDown} onFocus={() => setShowSuggestions(true)} placeholder="e.g. John 3:16 or &quot;God so loved&quot;" className="w-full pl-9 pr-4 py-2.5 border border-[var(--border-default)] rounded-lg focus:ring-2 focus:ring-[var(--accent-teal)]/30 outline-none bg-[var(--bg-tertiary)] text-[var(--text-primary)] transition-all placeholder:text-[var(--text-muted)]" />
                        {query && <button onClick={() => { setQuery(''); setHasSearched(false); setCurrentVerses([]); setNeighborVerses({ prev: [], next: [] }) }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="w-3.5 h-3.5" /></button>}
                    </div>
                </div>

                {showSuggestions && bookSuggestions.length > 0 && !hasSearched && (
                    <div className="relative mt-2">
                        <div className="absolute top-0 left-0 right-0 bg-[var(--bg-elevated)] rounded-lg shadow-lg border border-[var(--border-default)] z-10">
                            {bookSuggestions.map((book) => (<button key={book} onClick={() => { setQuery(book + ' '); inputRef.current?.focus() }} className="w-full text-left px-4 py-2 hover:bg-[var(--accent-teal)]/5 text-[var(--text-primary)] text-sm">{book}</button>))}
                        </div>
                    </div>
                )}

                {/* Nav controls when verse is loaded */}
                {hasSearched && currentBookIndex && currentChapter && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-subtle)]">
                        <div className="flex items-center gap-1">
                            <button onClick={() => navigateVerse('prev')} className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                            <button onClick={() => navigateVerse('next')} className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] transition-colors"><ChevronRight className="w-4 h-4" /></button>
                            <span className="text-xs font-semibold text-[var(--text-primary)] ml-1">{bibleBooks[currentBookIndex - 1]} {currentChapter}:{currentStartVerse}{currentEndVerse !== currentStartVerse ? `-${currentEndVerse}` : ''}</span>
                            <span className="text-[10px] text-[var(--accent-teal)] ml-1">{selectedVersion}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            {downloadedVersions.slice(0, 4).map((v) => (<button key={v.id} onClick={() => changeVersion(v.id)} className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${selectedVersion === v.id ? 'bg-[var(--accent-teal)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--accent-teal)]/10'}`}>{v.id}</button>))}
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--text-muted)]">
                    <span>Auto-searches as you type</span>
                    <span className="text-[var(--border-emphasis)]">|</span>
                    <span>Enter = Add</span>
                    <span className="text-[var(--border-emphasis)]">|</span>
                    <span>Shift+Enter = Live</span>
                    <span className="text-[var(--border-emphasis)]">|</span>
                    <span>↑↓ Navigate</span>
                </div>
            </div>

            {/* Results list — unified for both reference search and semantic search */}
            <div className="flex-1 min-h-0 overflow-y-auto" ref={scrollRef}>
                {loading && (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--text-muted)]">
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-teal)]" /> Loading...
                    </div>
                )}

                {verseRows.length > 0 && !loading && (
                    <div className="p-2 space-y-1">
                        {hasSearched && (
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-teal)] px-1 mb-1">
                                {bibleBooks[currentBookIndex! - 1]} {currentChapter}
                            </div>
                        )}
                        {!hasSearched && (
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-teal)] px-1 mb-1">Search Results</div>
                        )}
                        {verseRows.map((row, index) => (
                            <motion.div
                                key={`${row.bookIndex}:${row.chapter}:${row.verse}`}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                className={`group rounded-lg border transition-colors cursor-pointer ${row.isCurrent
                                    ? 'bg-[var(--accent-teal)]/8 border-[var(--accent-teal)]/20'
                                    : focusedIndex === index
                                        ? 'bg-[var(--accent-teal)]/10 border-[var(--accent-teal)]/30 ring-1 ring-[var(--accent-teal)]/20'
                                        : 'border-transparent hover:bg-[var(--accent-teal)]/5'
                                }`}
                                onClick={() => addToQueue(row.bookIndex, row.chapter, row.verse)}
                                onMouseEnter={() => setFocusedIndex(index)}
                            >
                                <div className="flex items-start gap-2 px-3 py-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-sm font-semibold ${row.isCurrent ? 'text-[var(--accent-teal)]' : 'text-[var(--text-primary)]'}`}>
                                                {row.isCurrent ? `${row.verse}` : row.reference}
                                            </span>
                                            {row.source === 'semantic' && row.score !== undefined && (
                                                <span className="text-[10px] text-[var(--accent-teal)]">{Math.round(row.score * 100)}%</span>
                                            )}
                                            {row.isCurrent && (
                                                <span className="text-[9px] px-1.5 py-0.5 bg-[var(--accent-teal)]/15 text-[var(--accent-teal)] rounded font-medium">CURRENT</span>
                                            )}
                                        </div>
                                        <p className={`text-xs mt-0.5 leading-relaxed ${row.isCurrent ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                                            {row.scripture}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); addToQueue(row.bookIndex, row.chapter, row.verse) }}
                                            className="flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-medium bg-[var(--bg-tertiary)] hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)] rounded transition-colors"
                                        >
                                            <Plus className="w-3 h-3" /> Add
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); goLiveWithScripture(row.bookIndex, row.chapter, row.verse) }}
                                            className="flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-medium bg-[var(--accent-teal)] text-white rounded hover:brightness-110 transition-all"
                                        >
                                            <Zap className="w-3 h-3" /> Live
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        ))}

                        {/* Template Selector */}
                        {templates && templates.length > 0 && (
                            <div className="pt-3 mt-3 border-t border-[var(--border-subtle)]">
                                <div className="flex flex-wrap gap-2">
                                    {templates.slice(0, 5).map(template => (
                                        <button key={template._id} onClick={() => setSelectedTemplate(selectedTemplate?._id === template._id ? null : template)} className={`px-3 py-1 text-xs rounded-full transition-colors ${selectedTemplate?._id === template._id ? 'bg-[var(--accent-teal)] text-white' : 'bg-[var(--bg-tertiary)] hover:bg-[var(--accent-teal)]/10 text-[var(--text-secondary)]'}`}>{template.name}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {isSemanticSearching && !loading && (
                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-[var(--text-muted)]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent-teal)]" /> Searching verses...
                    </div>
                )}

                {verseRows.length === 0 && !loading && !isSemanticSearching && (
                    <div className="p-4 text-center text-[var(--text-tertiary)]">
                        <BookOpen className="w-12 h-12 mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
                        <p className="font-medium text-[var(--text-secondary)]">Quick Bible Search</p>
                        <p className="text-sm mt-1 text-[var(--text-muted)]">Type a verse reference above to get started</p>
                        <div className="mt-4 text-xs text-[var(--text-muted)] space-y-0.5">
                            <p>Examples: John 3:16, Jn 3:16-18, Ps 23:1</p>
                            {hasEmbeddings && <p className="text-[var(--accent-teal)] mt-2">Or search by meaning, e.g. &quot;God so loved the world&quot;</p>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}