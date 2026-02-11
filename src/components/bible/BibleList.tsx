import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, X, ChevronLeft, BookOpen } from 'lucide-react'
import { useScripture } from '../../hooks'
import { useGlobalEmit } from '../../hooks/useEmitter'
import type { Scripture, BibleVerse } from '../../types'
import { appWideActions, bibleBooks } from '../../types'

interface BibleListProps {
    initialQuery?: string
    onClose: () => void
}

export function BibleList({ initialQuery = '', onClose }: BibleListProps) {
    const [query, setQuery] = useState(initialQuery)
    const [selectedBook, setSelectedBook] = useState<number | null>(null)
    const [selectedChapter, setSelectedChapter] = useState<number>(1)
    const [verses, setVerses] = useState<BibleVerse[]>([])
    const [scripture, setScripture] = useState<Scripture | null>(null)
    const [loading, setLoading] = useState(false)

    const { fetchScripture } = useScripture()
    const globalEmit = useGlobalEmit()

    // Parse query like "Genesis 1:1-5" or "Gen 1:1"
    const parseQuery = useCallback((q: string) => {
        const trimmed = q.trim()
        if (!trimmed) return null

        // Try to match patterns like "Genesis 1:1" or "Gen 1:1-5" or "1:1:1" (book:chapter:verse)
        const patterns = [
            // Book name Chapter:Verse or Book Chapter:Verse-Verse
            /^([\w\s]+)\s+(\d+):(\d+)(?:-(\d+))?$/i,
            // Book:Chapter:Verse (numeric format)
            /^(\d+):(\d+):(\d+)(?:-(\d+))?$/,
        ]

        for (const pattern of patterns) {
            const match = trimmed.match(pattern)
            if (match) {
                if (match[1].match(/^\d+$/)) {
                    // Numeric format: bookIndex:chapter:verse
                    return {
                        bookIndex: parseInt(match[1]),
                        chapter: parseInt(match[2]),
                        startVerse: parseInt(match[3]),
                        endVerse: match[4] ? parseInt(match[4]) : parseInt(match[3])
                    }
                } else {
                    // Named format: Book Name Chapter:Verse
                    const bookName = match[1].trim()
                    const bookIndex = bibleBooks.findIndex(b =>
                        b.toLowerCase().startsWith(bookName.toLowerCase())
                    ) + 1

                    if (bookIndex > 0) {
                        return {
                            bookIndex,
                            chapter: parseInt(match[2]),
                            startVerse: parseInt(match[3]),
                            endVerse: match[4] ? parseInt(match[4]) : parseInt(match[3])
                        }
                    }
                }
            }
        }

        return null
    }, [])

    const handleSearch = useCallback(async () => {
        const parsed = parseQuery(query)
        if (!parsed) return

        setLoading(true)
        const label = `${parsed.bookIndex}:${parsed.chapter}:${parsed.startVerse}${parsed.endVerse !== parsed.startVerse ? `-${parsed.endVerse}` : ''
            }`

        const result = await fetchScripture(label)
        if (result) {
            setScripture(result)
            if (Array.isArray(result.content)) {
                setVerses(result.content as BibleVerse[])
            }
        }
        setLoading(false)
    }, [query, parseQuery, fetchScripture])

    const handleCreateSlide = useCallback(() => {
        if (scripture) {
            globalEmit(appWideActions.newBible, {
                bookIndex: selectedBook,
                chapter: selectedChapter,
                scripture
            })
            onClose()
        }
    }, [scripture, selectedBook, selectedChapter, globalEmit, onClose])

    // Generate chapters for selected book
    const chapters = useMemo(() => {
        if (selectedBook === null) return []
        // Simplified: most books have up to 50 chapters
        return Array.from({ length: 50 }, (_, i) => i + 1)
    }, [selectedBook])

    return (
        <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg">
            {/* Header */}
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

            {/* Search */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder="e.g., Genesis 1:1 or 1:1:1"
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 dark:bg-gray-800 dark:text-white"
                        />
                    </div>
                    <button
                        onClick={handleSearch}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading ? '...' : 'Search'}
                    </button>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                    Format: Book Chapter:Verse (e.g., Genesis 1:1 or John 3:16-18)
                </p>
            </div>

            {/* Book/Chapter Selector */}
            {!scripture && (
                <div className="flex-1 overflow-hidden flex">
                    {/* Books */}
                    <div className="w-1/2 border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
                        <div className="p-2 text-xs font-medium text-gray-500 uppercase">Books</div>
                        {bibleBooks.map((book, index) => (
                            <button
                                key={book}
                                onClick={() => setSelectedBook(index + 1)}
                                className={`
                  w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800
                  ${selectedBook === index + 1 ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20' : ''}
                `}
                            >
                                {book}
                            </button>
                        ))}
                    </div>

                    {/* Chapters */}
                    <div className="w-1/2 overflow-y-auto">
                        <div className="p-2 text-xs font-medium text-gray-500 uppercase">Chapters</div>
                        {selectedBook ? (
                            <div className="grid grid-cols-5 gap-1 p-2">
                                {chapters.map((chapter) => (
                                    <button
                                        key={chapter}
                                        onClick={() => {
                                            setSelectedChapter(chapter)
                                            setQuery(`${bibleBooks[selectedBook - 1]} ${chapter}:1`)
                                        }}
                                        className={`
                      p-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800
                      ${selectedChapter === chapter ? 'bg-primary-100 text-primary-600' : ''}
                    `}
                                    >
                                        {chapter}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="p-4 text-center text-gray-500">
                                Select a book
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Scripture Display */}
            {scripture && (
                <div className="flex-1 overflow-y-auto p-4">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                        <h3 className="font-semibold text-lg mb-3">{scripture.label}</h3>
                        <div className="space-y-2">
                            {verses.map((verse, index) => (
                                <p key={index} className="text-gray-700 dark:text-gray-300">
                                    <sup className="text-primary-500 font-medium mr-1">{verse.verse}</sup>
                                    {verse.scripture}
                                </p>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-4">
                        <button
                            onClick={() => {
                                setScripture(null)
                                setVerses([])
                            }}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                        >
                            Back
                        </button>
                        <button
                            onClick={handleCreateSlide}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Create Slide
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
