import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, BookOpen, ArrowLeft, ArrowRight, RefreshCw, LayoutTemplate, X, Sparkles, Loader2 } from 'lucide-react'
import { useScripture, useSlideCreation, useSemanticVerseSearch } from '../../hooks'
import { useAppStore } from '../../store/appStore'
import { useTemplates } from '../../hooks/useTemplates'
import type { Scripture, BibleVerse } from '../../types'
import type { TemplateItem } from '../../hooks/useTemplates'
import { bibleBooks, bibleVersionObjects } from '../../types'

// Book abbreviations map for smart parsing
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

// Chapter counts per book (approximate)
const chapterCounts: Record<string, number> = {
    'Genesis': 50, 'Exodus': 40, 'Leviticus': 27, 'Numbers': 36, 'Deuteronomy': 34,
    'Joshua': 24, 'Judges': 21, 'Ruth': 4, '1 Samuel': 31, '2 Samuel': 24,
    '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36, 'Ezra': 10,
    'Nehemiah': 13, 'Esther': 10, 'Job': 42, 'Psalms': 150, 'Proverbs': 31,
    'Ecclesiastes': 12, 'Song of Solomon': 8, 'Isaiah': 66, 'Jeremiah': 52, 'Lamentations': 5,
    'Ezekiel': 48, 'Daniel': 12, 'Hosea': 14, 'Joel': 3, 'Amos': 9,
    'Obadiah': 1, 'Jonah': 4, 'Micah': 7, 'Nahum': 3, 'Habakkuk': 3,
    'Zephaniah': 3, 'Haggai': 2, 'Zechariah': 14, 'Malachi': 4,
    'Matthew': 28, 'Mark': 16, 'Luke': 24, 'John': 21, 'Acts': 28,
    'Romans': 16, '1 Corinthians': 16, '2 Corinthians': 13, 'Galatians': 6, 'Ephesians': 6,
    'Philippians': 4, 'Colossians': 4, '1 Thessalonians': 5, '2 Thessalonians': 3, '1 Timothy': 6,
    '2 Timothy': 4, 'Titus': 3, 'Philemon': 1, 'Hebrews': 13, 'James': 5,
    '1 Peter': 5, '2 Peter': 3, '1 John': 5, '2 John': 1, '3 John': 1,
    'Jude': 1, 'Revelation': 22,
}

interface BibleListProps {
    initialQuery?: string
    onClose: () => void
    isInline?: boolean
}

export function BibleList({ initialQuery = '', onClose, isInline = false }: BibleListProps) {
    const [query, setQuery] = useState(initialQuery)
    const [scripture, setScripture] = useState<Scripture | null>(null)
    const [verses, setVerses] = useState<BibleVerse[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedVersion, setSelectedVersion] = useState<string>('')
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [suggestionType, setSuggestionType] = useState<'book' | 'chapter' | 'verse' | null>(null)
    const [currentBookIndex, setCurrentBookIndex] = useState<number | null>(null)
    const [currentChapter, setCurrentChapter] = useState<number | null>(null)
    const [currentStartVerse, setCurrentStartVerse] = useState<number | null>(null)
    const [currentEndVerse, setCurrentEndVerse] = useState<number | null>(null)
    const [neighboringVerses, setNeighboringVerses] = useState<{ prev: BibleVerse[]; next: BibleVerse[] }>({ prev: [], next: [] })
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null)

    const inputRef = useRef<HTMLInputElement>(null)

    const { fetchScripture } = useScripture()
    const { createBibleSlide } = useSlideCreation()
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)
    const { templates } = useTemplates()

    // Semantic verse search
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

    // Initialize selected version with default
    useEffect(() => {
        if (!selectedVersion) {
            setSelectedVersion(defaultBibleVersion || 'KJV')
        }
    }, [defaultBibleVersion, selectedVersion])

    // Pre-warm embedder when panel opens and embeddings are available
    useEffect(() => {
        if (hasEmbeddings && !isEmbedderReady) {
            initEmbedder()
        }
    }, [hasEmbeddings, isEmbedderReady, initEmbedder])

    // Trigger semantic search when query doesn't look like a reference
    useEffect(() => {
        const trimmed = query.trim()
        const looksLikeReference =
            /^((?:\d\s?)?[a-z]+)\s+(\d+):(\d+)/i.test(trimmed) ||
            /^(\d+):(\d+):(\d+)/.test(trimmed)

        if (trimmed.length >= 3 && !looksLikeReference && hasEmbeddings) {
            semanticSearch(trimmed)
        } else {
            clearSemanticResults()
        }
    }, [query, hasEmbeddings, semanticSearch, clearSemanticResults])

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    // Smart book suggestions based on input
    const bookSuggestions = useMemo(() => {
        if (!query || query.includes(':')) return []
        const lowerQuery = query.toLowerCase().trim()

        // Check if it matches an abbreviation
        const abbrevMatch = bookAbbreviations[lowerQuery]
        if (abbrevMatch) {
            return [abbrevMatch]
        }

        // Filter books that start with or contain the query
        return bibleBooks.filter(book =>
            book.toLowerCase().startsWith(lowerQuery) ||
            book.toLowerCase().includes(lowerQuery)
        ).slice(0, 5)
    }, [query])

    // Parse query intelligently
    const parseQuery = useCallback((q: string) => {
        const trimmed = q.trim()
        if (!trimmed) return null

        // Pattern: Book Chapter:Verse or Book Chapter:Verse-Verse
        // Handles: "John 3:16", "Jn 3:16", "jn 3:16-18", "1 John 2:1"
        const fullPattern = /^((?:\d\s?)?[a-z]+)\s+(\d+):(\d+)(?:-(\d+))?$/i
        const match = trimmed.match(fullPattern)

        if (match) {
            const bookInput = match[1].toLowerCase()
            const chapter = parseInt(match[2])
            const startVerse = parseInt(match[3])
            const endVerse = match[4] ? parseInt(match[4]) : startVerse

            // Find book - check abbreviations first
            let bookName: string | undefined = bookAbbreviations[bookInput]

            // If not found, search by name
            if (!bookName) {
                const found = bibleBooks.find(b =>
                    b.toLowerCase() === bookInput ||
                    b.toLowerCase().startsWith(bookInput)
                )
                bookName = found
            }

            if (bookName) {
                const bookIndex = bibleBooks.indexOf(bookName as typeof bibleBooks[number]) + 1
                return { bookIndex, bookName, chapter, startVerse, endVerse }
            }
        }

        // Numeric format: BookIndex:Chapter:Verse
        const numericPattern = /^(\d+):(\d+):(\d+)(?:-(\d+))?$/
        const numMatch = trimmed.match(numericPattern)

        if (numMatch) {
            const bookIndex = parseInt(numMatch[1])
            const bookName = bibleBooks[bookIndex - 1]
            return {
                bookIndex,
                bookName,
                chapter: parseInt(numMatch[2]),
                startVerse: parseInt(numMatch[3]),
                endVerse: numMatch[4] ? parseInt(numMatch[4]) : parseInt(numMatch[3])
            }
        }

        return null
    }, [])

    // Fetch scripture with version
    const fetchScriptureWithVersion = useCallback(async (version: string) => {
        const parsed = parseQuery(query)
        if (!parsed) return

        setLoading(true)
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`

        const result = await fetchScripture(label, version)
        if (result) {
            setScripture(result)
            if (Array.isArray(result.content)) {
                setVerses(result.content as BibleVerse[])
            }

            // Store current position for navigation
            setCurrentBookIndex(parsed.bookIndex)
            setCurrentChapter(parsed.chapter)
            setCurrentStartVerse(parsed.startVerse)
            setCurrentEndVerse(parsed.endVerse)

            // Fetch neighboring verses
            await fetchNeighboringVerses(parsed, version)
        }
        setLoading(false)
    }, [query, parseQuery, fetchScripture])

    // Fetch neighboring verses for navigation
    const fetchNeighboringVerses = useCallback(async (parsed: ReturnType<typeof parseQuery>, version: string) => {
        if (!parsed) return

        const { bookIndex, chapter, startVerse, endVerse } = parsed

        // Fetch previous verses (3 before)
        const prevStart = Math.max(1, startVerse - 3)
        if (prevStart < startVerse) {
            const prevLabel = `${bookIndex}:${chapter}:${prevStart}-${startVerse - 1}`
            const prevResult = await fetchScripture(prevLabel, version)
            if (prevResult && Array.isArray(prevResult.content)) {
                setNeighboringVerses(prev => ({ ...prev, prev: prevResult.content as BibleVerse[] }))
            }
        }

        // Fetch next verses (3 after)
        const nextEnd = endVerse + 3
        const nextLabel = `${bookIndex}:${chapter}:${endVerse + 1}-${nextEnd}`
        const nextResult = await fetchScripture(nextLabel, version)
        if (nextResult && Array.isArray(nextResult.content)) {
            setNeighboringVerses(prev => ({ ...prev, next: nextResult.content as BibleVerse[] }))
        }
    }, [fetchScripture])

    // Auto-search when initialQuery is provided (e.g. from sermon listener verse bridge)
    useEffect(() => {
        if (!initialQuery || !selectedVersion) return
        const parsed = parseQuery(initialQuery)
        if (!parsed) return
        setLoading(true)
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''}`
        fetchScripture(label, selectedVersion).then((result) => {
            if (result) {
                setScripture(result)
                if (Array.isArray(result.content)) {
                    setVerses(result.content as BibleVerse[])
                }
                setCurrentBookIndex(parsed.bookIndex)
                setCurrentChapter(parsed.chapter)
                setCurrentStartVerse(parsed.startVerse)
                setCurrentEndVerse(parsed.endVerse)
            }
            setLoading(false)
        })
    }, [initialQuery, selectedVersion, parseQuery, fetchScripture])

    // Handle search
    const handleSearch = useCallback(() => {
        fetchScriptureWithVersion(selectedVersion)
        setShowSuggestions(false)
    }, [fetchScriptureWithVersion, selectedVersion])

    // Handle key press
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleSearch()
        } else if (e.key === 'Escape') {
            setShowSuggestions(false)
        }
    }, [handleSearch])

    // Navigate to adjacent verse
    const navigateVerse = useCallback((direction: 'prev' | 'next', count: number = 1) => {
        if (!currentBookIndex || !currentChapter || !currentStartVerse) return

        let newStartVerse: number
        let newEndVerse: number

        if (direction === 'prev') {
            newStartVerse = Math.max(1, currentStartVerse - count)
            newEndVerse = newStartVerse + (currentEndVerse! - currentStartVerse)
        } else {
            newStartVerse = currentStartVerse + count
            newEndVerse = newStartVerse + (currentEndVerse! - currentStartVerse)
        }

        // Update query and fetch
        const bookName = bibleBooks[currentBookIndex - 1]
        setQuery(`${bookName} ${currentChapter}:${newStartVerse}${newEndVerse !== newStartVerse ? `-${newEndVerse}` : ''}`)
    }, [currentBookIndex, currentChapter, currentStartVerse, currentEndVerse])

    // Quick verse selection from neighbors
    const selectVerse = useCallback((verse: BibleVerse) => {
        if (!currentBookIndex || !currentChapter) return

        const bookName = bibleBooks[currentBookIndex - 1]
        setQuery(`${bookName} ${currentChapter}:${verse.verse}`)
    }, [currentBookIndex, currentChapter])

    // Change version and refresh
    const changeVersion = useCallback((newVersion: string) => {
        setSelectedVersion(newVersion)
        if (query) {
            // Re-fetch with new version
            setTimeout(() => {
                fetchScriptureWithVersion(newVersion)
            }, 0)
        }
    }, [query, fetchScriptureWithVersion])

    // Select a semantic search result
    const selectSemanticResult = useCallback(async (bookNumber: number, chapter: number, verse: number) => {
        const label = `${bookNumber}:${chapter}:${verse}`
        setLoading(true)
        const result = await fetchScripture(label, selectedVersion)
        if (result) {
            setScripture(result)
            if (Array.isArray(result.content)) {
                setVerses(result.content as BibleVerse[])
            }
            setCurrentBookIndex(bookNumber)
            setCurrentChapter(chapter)
            setCurrentStartVerse(verse)
            setCurrentEndVerse(verse)
            setShowSuggestions(false)
            clearSemanticResults()
        }
        setLoading(false)
    }, [fetchScripture, selectedVersion, clearSemanticResults])

    // Create slide with optional template
    const handleCreateSlide = useCallback((template?: TemplateItem | null) => {
        if (scripture) {
            const slide = createBibleSlide(scripture, { template })
            if (slide) {
                appendActiveSlide(slide)
            }
            onClose()
        }
    }, [scripture, createBibleSlide, appendActiveSlide, onClose])

    // Get downloaded versions for quick switch
    const downloadedVersions = useMemo(() =>
        bibleVersionObjects.filter(v => v.isDownloaded),
        []
    )

    return (
        <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg">
            {/* Header - Hidden when inline in Studio sidebar */}
            {!isInline && (
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <h2 className="text-lg font-semibold">Display Bible</h2>
                    </div>
                </div>
            )}

            {/* Smart Search */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                {/* Search Input - Full width */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value)
                            setShowSuggestions(true)
                        }}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setShowSuggestions(true)}
                        placeholder="e.g., John 3:16 or Jn 3:16-18"
                        className="w-full pl-10 pr-4 py-2.5 border border-[var(--border-default)] rounded-lg focus:ring-2 focus:ring-[var(--accent-teal)]/30 outline-none bg-[var(--bg-tertiary)] dark:text-white transition-all"
                    />

                    {/* Book Suggestions Dropdown */}
                    {showSuggestions && bookSuggestions.length > 0 && !scripture && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                            {bookSuggestions.map((book) => (
                                <button
                                    key={book}
                                    onClick={() => {
                                        setQuery(book + ' ')
                                        inputRef.current?.focus()
                                    }}
                                    className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    {book}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Version Selector and Action Button - Second row */}
                <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Version:</span>
                        <select
                            value={selectedVersion}
                            onChange={(e) => changeVersion(e.target.value)}
                            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500"
                        >
                            {bibleVersionObjects.map((v) => (
                                <option key={v.id} value={v.id}>{v.id}</option>
                            ))}
                        </select>
                    </div>

                    <button
                        onClick={handleSearch}
                        disabled={loading}
                        className="px-5 py-1.5 bg-[var(--accent-teal)] text-white text-sm font-medium rounded-lg hover:brightness-110 disabled:opacity-50 transition-all shadow-sm"
                    >
                        {loading ? 'Searching...' : 'Search'}
                    </button>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Type book name (or abbreviation like "Jn" for John), chapter:verse
                </p>
            </div>

            {/* Scripture Display with Navigation */}
            {scripture && (
                <div className="flex-1 overflow-hidden flex flex-col">
                    {/* Navigation Controls */}
                    <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => navigateVerse('prev', 1)}
                                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                title="Previous verse"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                                onClick={() => navigateVerse('next', 1)}
                                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                title="Next verse"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Quick Version Switch */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Version:</span>
                            <div className="flex gap-1">
                                {downloadedVersions.slice(0, 4).map((v) => (
                                    <button
                                        key={v.id}
                                        onClick={() => changeVersion(v.id)}
                                        className={`px-2 py-1 text-xs rounded ${selectedVersion === v.id
                                            ? 'bg-primary-500 text-white'
                                            : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                                            }`}
                                    >
                                        {v.id}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-lg">{scripture.label}</h3>
                                <span className="text-sm text-primary-600 dark:text-primary-400 font-medium">
                                    {scripture.version}
                                </span>
                            </div>
                            <div className="space-y-2">
                                {verses.map((verse, index) => (
                                    <p key={index} className="text-gray-700 dark:text-gray-300">
                                        <sup className="text-primary-500 font-medium mr-1">{verse.verse}</sup>
                                        {verse.scripture}
                                    </p>
                                ))}
                            </div>
                        </div>

                        {/* Neighboring Verses Quick Select */}
                        {(neighboringVerses.prev.length > 0 || neighboringVerses.next.length > 0) && (
                            <div className="mt-4">
                                <div className="text-xs font-medium text-gray-500 mb-2">Nearby Verses</div>
                                <div className="flex flex-wrap gap-1">
                                    {neighboringVerses.prev.map((v) => (
                                        <button
                                            key={v.verse}
                                            onClick={() => selectVerse(v)}
                                            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded"
                                        >
                                            {v.verse}
                                        </button>
                                    ))}
                                    {verses.map((v) => (
                                        <span
                                            key={v.verse}
                                            className="px-2 py-1 text-xs bg-primary-500 text-white rounded"
                                        >
                                            {v.verse}
                                        </span>
                                    ))}
                                    {neighboringVerses.next.map((v) => (
                                        <button
                                            key={v.verse}
                                            onClick={() => selectVerse(v)}
                                            className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded"
                                        >
                                            {v.verse}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex justify-end gap-2 mt-4">
                            <button
                                onClick={() => {
                                    setScripture(null)
                                    setVerses([])
                                    setNeighboringVerses({ prev: [], next: [] })
                                }}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                            >
                                New Search
                            </button>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleCreateSlide(selectedTemplate)}
                                    className="px-4 py-2 bg-[var(--accent-teal)] text-white rounded-lg hover:brightness-110 transition-all shadow-sm font-medium"
                                >
                                    Create Slide
                                </button>
                                <div className="relative">
                                    <button
                                        onClick={() => setSelectedTemplate(null)}
                                        className={`p-2 rounded-lg border ${selectedTemplate
                                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-600'
                                            : 'border-gray-300 dark:border-gray-600 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                                            }`}
                                        title={selectedTemplate ? `Using: ${selectedTemplate.name}` : 'Use template'}
                                    >
                                        <LayoutTemplate className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Template Selector */}
                        {templates && templates.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
                                    Quick select template:
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {templates.slice(0, 5).map(template => (
                                        <button
                                            key={template._id}
                                            onClick={() => setSelectedTemplate(selectedTemplate?._id === template._id ? null : template)}
                                            className={`px-3 py-1 text-xs rounded-full transition-colors ${selectedTemplate?._id === template._id
                                                ? 'bg-primary-500 text-white'
                                                : 'bg-gray-100 dark:bg-gray-700 hover:bg-primary-100 dark:hover:bg-primary-900/30 text-gray-700 dark:text-gray-300'
                                                }`}
                                        >
                                            {template.name}
                                        </button>
                                    ))}
                                    {templates.length > 5 && (
                                        <span className="px-3 py-1 text-xs text-gray-400 dark:text-gray-500">
                                            +{templates.length - 5} more
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Book/Chapter Selector (when no scripture) */}
            {!scripture && (
                <div className="flex-1 overflow-y-auto">
                    {/* Semantic Search Results */}
                    {semanticResults.length > 0 && (
                        <div className="px-4 pt-4">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-medium text-[var(--accent-teal)] dark:text-[var(--accent-teal)]">
                                    Search Results
                                </span>
                            </div>
                            <div className="space-y-1">
                                {semanticResults.map((verse) => (
                                    <button
                                        key={verse._id}
                                        onClick={() => selectSemanticResult(verse.bookNumber, verse.chapter, verse.verse)}
                                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--accent-teal)]/5 dark:hover:bg-[var(--accent-teal)]/10 transition-colors group"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                                {verse.reference}
                                            </span>
                                            <span className="text-[10px] text-[var(--accent-teal)] dark:text-[var(--accent-teal)]">
                                                {Math.round(verse.score * 100)}% match
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                                            {verse.text}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Loading Indicator */}
                    {isSemanticSearching && (
                        <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent-teal)]" />
                            Searching verses...
                        </div>
                    )}

                    {/* Empty State */}
                    {semanticResults.length === 0 && !isSemanticSearching && (
                        <div className="p-4 text-center text-gray-500">
                            <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p className="font-medium">Quick Bible Search</p>
                            <p className="text-sm mt-1">Type a verse reference above</p>
                            <div className="mt-4 text-xs text-gray-400 space-y-0.5">
                                <p>Examples:</p>
                                <p>• John 3:16</p>
                                <p>• Jn 3:16-18</p>
                                <p>• Genesis 1:1-5</p>
                                <p>• Ps 23:1-6</p>
                                {hasEmbeddings && (
                                    <p className="text-[var(--accent-teal)] mt-2">
                                        Or search by meaning, e.g. &quot;God so loved the world&quot;
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
