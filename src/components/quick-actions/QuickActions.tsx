import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import fuzzysort from 'fuzzysort'
import { useEmitter, useHymn, useGlobalEmit } from '../../hooks'
import {
    appWideActions,
    slideTypes,
    quickActionsArr,
    bibleBooks,
    type QuickAction,
    type Slide
} from '../../types'
import { ActionCard } from './ActionCard'
import { SlideChip } from '../slides/SlideChip'
import { BibleList } from '../bible/BibleList'
import { HymnList } from '../hymns/HymnList'
import { SongList } from '../songs/SongList'

export function QuickActions() {
    const [searchInput, setSearchInput] = useState('')
    const [page, setPage] = useState('') // 'bible', 'hymn', 'song', etc.
    const [focusedActionIndex, setFocusedActionIndex] = useState(0)
    const [actions, setActions] = useState<QuickAction[]>([])

    const searchInputRef = useRef<HTMLInputElement>(null)
    const actionsContainerRef = useRef<HTMLDivElement>(null)
    const { getAllHymns } = useHymn()
    const { on } = useEmitter()
    const globalEmit = useGlobalEmit()

    // Initialize actions with hymns
    useEffect(() => {
        const initHymns = async () => {
            const allHymns = await getAllHymns()

            const bibleBookActions = bibleBooks.map((book, index) => ({
                icon: 'i-bx-bible',
                name: book,
                desc: `Open the book of ${book}`,
                action: appWideActions.newBible,
                meta: `${book} 0:0 1:1 2:2 3:3 4:4 5:5 6:6 7:7 8:8 9:9 10:10 -`,
                searchableOnly: true,
                bibleBookIndex: `${index + 1}`,
                type: slideTypes.bible,
            }))

            const hymnActions = allHymns.map((hymn) => ({
                icon: 'i-bx-church',
                name: hymn.title,
                desc: 'verse and chorus included',
                action: appWideActions.newHymn,
                meta: `hymn ${hymn.meta}`,
                searchableOnly: true,
                hymnIndex: hymn.number,
                type: slideTypes.hymn,
            }))

            setActions([...quickActionsArr, ...bibleBookActions, ...hymnActions])
        }

        initHymns()
    }, [getAllHymns])

    // Listen for events
    useEffect(() => {
        const unsubs: Array<() => void> = []

        unsubs.push(on(appWideActions.newBible, (data) => {
            if (data === '') setPage('bible')
        }))

        unsubs.push(on(appWideActions.newSong, (data) => {
            const d = data as Slide | undefined
            if (!d || !(d as { fromSaved?: boolean }).fromSaved) setPage('song')
        }))

        unsubs.push(on(appWideActions.newHymn, (data) => {
            if (data === 'undefined') setPage('hymn')
        }))

        unsubs.push(on(appWideActions.newMedia, (data) => {
            const arr = data as Slide[] | undefined
            if (!arr || !arr[0] || !(arr[0] as { fromSaved?: boolean }).fromSaved) setPage('media')
        }))

        unsubs.push(on(appWideActions.newYouTubeVideo, () => setPage('youtube')))
        unsubs.push(on(appWideActions.newVimeoVideo, () => setPage('vimeo')))
        unsubs.push(on(appWideActions.newSearchBible, () => setPage('search-bible')))
        unsubs.push(on(appWideActions.newLibrary, () => setPage('library')))
        unsubs.push(on(appWideActions.newTemplates, () => setPage('templates')))
        unsubs.push(on(appWideActions.newAlert, () => setPage('alert')))
        unsubs.push(on(appWideActions.newCountdown, () => setPage('countdown')))

        unsubs.push(on(appWideActions.quickActionsFocus, () => {
            if (page !== '') {
                setTimeout(() => searchInputRef.current?.focus(), 300)
                setPage('')
            } else {
                searchInputRef.current?.focus()
            }
        }))

        return () => unsubs.forEach(u => u())
    }, [on, page])

    // Reset focus when page changes
    useEffect(() => {
        setFocusedActionIndex(0)
        setSearchInput('')
    }, [page])

    // Parse bible chapter and verse from search input
    const bibleChapterAndVerse = useMemo(() => {
        const regex = /\b\d+\s*:\s*\d+\b|\b\d+\s\d+\b/g
        const bibleBookFollowedByJustChapterMatch = searchInput
            ?.replace('/', '')
            .match(/\b\w+\s+\d+\b(?!\S)/g)

        if (
            bibleBookFollowedByJustChapterMatch?.[0] &&
            !searchInput?.match(regex)
        ) {
            const standaloneChapter = Number(
                bibleBookFollowedByJustChapterMatch[0]?.split(' ')?.[1] || 1
            )
            return `${standaloneChapter}:1`
        }

        const match = searchInput
            ?.replace('/', '')
            .match(regex)?.[0]
            ?.replaceAll(' ', ':')
        return match?.trim()
    }, [searchInput])

    // Filtered actions based on search
    const searchedActions = useMemo<QuickAction[]>(() => {
        const twoDigitNumbers = searchInput
            ?.replace('/', '')
            ?.match(/\b\d{2}\b/g)

        // Don't search if input includes two digit number
        if (twoDigitNumbers) return []

        const colonIndex = searchInput.indexOf(':')
        const searchInputBeforeColon = colonIndex === -1
            ? searchInput
            : searchInput.substring(0, colonIndex)

        if (!searchInputBeforeColon.trim()) return []

        const results = fuzzysort.go(searchInputBeforeColon, actions, {
            keys: ['name', 'desc', 'meta'],
        })

        let mappedResults = results.map(result => result.obj as QuickAction)

        // Sort by showing searchableOnly actions last
        mappedResults = mappedResults.sort((a: QuickAction, b: QuickAction) => {
            if (a.searchableOnly && !b.searchableOnly) return 1
            if (!a.searchableOnly && b.searchableOnly) return -1
            return 0
        })

        // If bible chapter and verse found, show Bible types first
        if (bibleChapterAndVerse) {
            mappedResults = mappedResults.sort((a: QuickAction, b: QuickAction) => {
                if (a.type === 'bible' && b.type !== 'bible') return -1
                if (a.type !== 'bible' && b.type === 'bible') return 1
                return 0
            })
        }

        return mappedResults.slice(0, 10)
    }, [searchInput, actions, bibleChapterAndVerse])

    // Handle keyboard navigation
    const handleInputKeydown = useCallback((e: React.KeyboardEvent) => {
        const currentActions = searchInput.length >= 2
            ? searchedActions
            : actions?.filter((a: QuickAction) => !a?.searchableOnly)

        const maxIndex = currentActions.length - 1

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                if (focusedActionIndex < maxIndex) {
                    setFocusedActionIndex(prev => prev + 1)
                }
                break
            case 'ArrowUp':
                e.preventDefault()
                if (focusedActionIndex > 0) {
                    setFocusedActionIndex(prev => prev - 1)
                }
                break
            case 'Enter':
                e.preventDefault()
                const action = currentActions?.[focusedActionIndex]
                if (action) {
                    const actionData = action.type === slideTypes.bible
                        ? `${action.bibleBookIndex}:${bibleChapterAndVerse}`
                        : action.type === slideTypes.hymn
                            ? action.hymnIndex
                            : ''
                    globalEmit(action.action, actionData)
                }
                break
        }
    }, [searchInput, searchedActions, actions, focusedActionIndex, bibleChapterAndVerse, globalEmit])

    // Scroll focused action into view
    useEffect(() => {
        if (actionsContainerRef.current) {
            const focusedElement = actionsContainerRef.current.querySelector(
                `[data-action-index="${focusedActionIndex}"]`
            )
            if (focusedElement) {
                focusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }
        }
    }, [focusedActionIndex])

    // Filter basic actions
    const basicActions = actions?.filter((a: QuickAction) => !a?.searchableOnly)

    return (
        <div className="max-w-[330px] relative overflow-visible z-20 bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {searchInput.length < 2 ? 'Quick Actions' : 'Search Results'}
                </h2>
                {page && (
                    <button
                        onClick={() => setPage('')}
                        className="text-sm text-primary-600 hover:text-primary-700"
                    >
                        Back
                    </button>
                )}
            </div>

            {/* Search Input */}
            <div className="mb-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={handleInputKeydown}
                        placeholder="Search actions, scripture, hymns..."
                        className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                    />
                    {searchInput && (
                        <button
                            onClick={() => setSearchInput('')}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* Search hints */}
                {searchInput.trim().length > 0 && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-gray-600 dark:text-gray-400">
                        <span>Search anything:</span>
                        <div className="flex gap-1">
                            {[slideTypes.bible, slideTypes.hymn, slideTypes.song].map(type => (
                                <SlideChip key={type} slideType={type} />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Content based on page state */}
            {page === 'bible' ? (
                <BibleList onClose={() => setPage('')} />
            ) : page === 'hymn' ? (
                <HymnList onClose={() => setPage('')} />
            ) : page === 'song' ? (
                <SongList onClose={() => setPage('')} />
            ) : (
                <>
                    {/* Actions List */}
                    <div
                        ref={actionsContainerRef}
                        className="overflow-y-auto max-h-[calc(100vh-250px)] space-y-1"
                    >
                        {searchInput.length < 2 ? (
                            // Basic actions
                            basicActions.map((action, index) => (
                                <ActionCard
                                    key={action.name}
                                    action={action}
                                    dataActionIndex={index}
                                    isFocused={index === focusedActionIndex}
                                    onClick={() => {
                                        setFocusedActionIndex(index)
                                        globalEmit(action.action, '')
                                    }}
                                />
                            ))
                        ) : (
                            // Search results
                            searchedActions.map((action: QuickAction, index: number) => (
                                <ActionCard
                                    key={action.name}
                                    action={{ ...action, bibleChapterAndVerse }}
                                    dataActionIndex={index}
                                    isFocused={index === focusedActionIndex}
                                    onClick={() => {
                                        setFocusedActionIndex(index)
                                        const actionData = action.type === slideTypes.bible
                                            ? `${action.bibleBookIndex}:${bibleChapterAndVerse}`
                                            : action.type === slideTypes.hymn
                                                ? action.hymnIndex
                                                : ''
                                        globalEmit(action.action, actionData)
                                    }}
                                />
                            ))
                        )}
                    </div>

                    {/* Empty state for search */}
                    {searchInput.length >= 2 && searchedActions.length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                            <p>No actions found</p>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
