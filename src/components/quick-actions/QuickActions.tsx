import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import fuzzysort from 'fuzzysort'
import { useHymn, useScripture, useSlideCreation } from '../../hooks'
import { useAppStore, type QuickActionsPage } from '../../store/appStore'
import {
    slideTypes,
    quickActionsArr,
    bibleBooks,
    appWideActions,
    type QuickAction,
    type Slide
} from '../../types'
import { ActionCard } from './ActionCard'
import { SlideChip } from '../slides/SlideChip'
import { BibleList } from '../bible/BibleList'
import { HymnList } from '../hymns/HymnList'
import { DictionaryPanel } from '../dictionary/DictionaryPanel'
import { SongList } from '../songs/SongList'

// Group actions into categories for better visual organisation
const PRIMARY_ACTIONS: Set<string> = new Set([
    appWideActions.newBible,
    appWideActions.newSearchBible,
    appWideActions.newHymn,
    appWideActions.addSong,
    appWideActions.newLibrary,
    appWideActions.newSong,
])

const CREATE_ACTIONS: Set<string> = new Set([
    appWideActions.newSlide,
    appWideActions.newMedia,
    appWideActions.newTemplates,
    appWideActions.newAlert,
    appWideActions.newCountdown,
    appWideActions.newYouTubeVideo,
    appWideActions.newVimeoVideo,
])

export function QuickActions() {
    const [searchInput, setSearchInput] = useState('')
    const [focusedActionIndex, setFocusedActionIndex] = useState(0)
    const [actions, setActions] = useState<QuickAction[]>([])

    const searchInputRef = useRef<HTMLInputElement>(null)
    const actionsContainerRef = useRef<HTMLDivElement>(null)
    const { getAllHymns, getHymnByNumber } = useHymn()
    const { fetchScripture } = useScripture()
    const { createBibleSlide, createHymnSlides } = useSlideCreation()

    // Use Zustand for page state and actions
    const page = useAppStore((state) => state.quickActionsPage)
    const setQuickActionsPage = useAppStore((state) => state.setQuickActionsPage)
    const openModal = useAppStore((state) => state.openModal)
    const appendActiveSlide = useAppStore((state) => state.appendActiveSlide)
    const setEditingSlide = useAppStore((state) => state.setEditingSlide)
    const activeSchedule = useAppStore((state) => state.activeSchedule)

    // Initialize actions with hymns
    useEffect(() => {
        const initHymns = async () => {
            const allHymns = await getAllHymns()

            const bibleBookActions = bibleBooks.map((book, index) => ({
                icon: 'i-bx-bible',
                name: book,
                desc: `Open the book of ${book}`,
                action: `bible:${index + 1}`,
                meta: `${book} 0:0 1:1 2:2 3:3 4:4 5:5 6:6 7:7 8:8 9:9 10:10 -`,
                searchableOnly: true,
                bibleBookIndex: `${index + 1}`,
                type: slideTypes.bible,
            }))

            const hymnActions = allHymns.map((hymn) => ({
                icon: 'i-bx-church',
                name: hymn.title,
                desc: 'verse and chorus included',
                action: `hymn:${hymn.number}`,
                meta: `hymn ${hymn.meta}`,
                searchableOnly: true,
                hymnIndex: hymn.number,
                type: slideTypes.hymn,
            }))

            setActions([...quickActionsArr, ...bibleBookActions, ...hymnActions])
        }

        initHymns()
    }, [getAllHymns])

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

        mappedResults = mappedResults.sort((a: QuickAction, b: QuickAction) => {
            if (a.searchableOnly && !b.searchableOnly) return 1
            if (!a.searchableOnly && b.searchableOnly) return -1
            return 0
        })

        if (bibleChapterAndVerse) {
            mappedResults = mappedResults.sort((a: QuickAction, b: QuickAction) => {
                if (a.type === 'bible' && b.type !== 'bible') return -1
                if (a.type !== 'bible' && b.type === 'bible') return 1
                return 0
            })
        }

        return mappedResults.slice(0, 10)
    }, [searchInput, actions, bibleChapterAndVerse])

    // Handle action execution
    const executeAction = useCallback(async (action: QuickAction) => {
        if (action.action === appWideActions.newBible || action.action === appWideActions.newSearchBible) {
            setQuickActionsPage('bible')
            return
        }
        if (action.action === appWideActions.newHymn) {
            setQuickActionsPage('hymn')
            return
        }
        if (action.action === appWideActions.newDictionary) {
            setQuickActionsPage('dictionary')
            return
        }
        if (action.action === appWideActions.newSong || action.action === appWideActions.addSong) {
            setQuickActionsPage('song')
            return
        }
        if (action.action === appWideActions.newMedia) {
            openModal('mediaPicker')
            return
        }
        if (action.action === appWideActions.newYouTubeVideo) {
            openModal('mediaPicker')
            return
        }
        if (action.action === appWideActions.newVimeoVideo) {
            openModal('mediaPicker')
            return
        }
        if (action.action === appWideActions.newTemplates) {
            openModal('templateBrowser')
            return
        }
        if (action.action === appWideActions.newAlert) {
            openModal('alertModal')
            return
        }
        if (action.action === appWideActions.newCountdown) {
            openModal('countdownModal')
            return
        }
        if (action.action === appWideActions.newLibrary) {
            openModal('libraryPanel')
            return
        }
        if (action.action === appWideActions.openSettings) {
            openModal('settings')
            return
        }
        if (action.action === appWideActions.openScheduleModal) {
            openModal('scheduleModal')
            return
        }
        if (action.action === appWideActions.openShortcutsModal) {
            openModal('shortcuts')
            return
        }
        if (action.action === appWideActions.removeAlert) {
            console.log('Remove alert action triggered')
            return
        }
        if (action.action === appWideActions.toggleDarkMode) {
            document.documentElement.classList.toggle('dark')
            return
        }

        if (action.action.startsWith('bible:')) {
            const bookIndex = action.bibleBookIndex
            const reference = `${bookIndex}:${bibleChapterAndVerse || '1:1'}`
            try {
                const scripture = await fetchScripture(reference)
                if (scripture) {
                    const slide = createBibleSlide(scripture)
                    if (slide) {
                        appendActiveSlide(slide)
                    }
                }
            } catch (e) {
                console.error('Failed to fetch scripture:', e)
            }
            return
        }

        if (action.action.startsWith('hymn:')) {
            const hymnNumber = action.hymnIndex
            if (!hymnNumber) return
            try {
                const hymn = await getHymnByNumber(hymnNumber)
                if (hymn) {
                    const slides = createHymnSlides(hymn as any)
                    slides.forEach(slide => {
                        appendActiveSlide(slide)
                    })
                }
            } catch (e) {
                console.error('Failed to fetch hymn:', e)
            }
            return
        }

        if (action.action === appWideActions.newSlide || action.action === appWideActions.newText) {
            const newSlide: Slide = {
                id: `slide_${Date.now()}`,
                index: 0,
                name: 'New Slide',
                type: 'text',
                layout: 'full-text',
                contents: [''],
                userId: '',
                churchId: '',
                scheduleId: activeSchedule?._id || '',
            }
            setEditingSlide(newSlide)
            openModal('editor')
            return
        }
    }, [setQuickActionsPage, openModal, fetchScripture, createBibleSlide, appendActiveSlide, getHymnByNumber, createHymnSlides, bibleChapterAndVerse, setEditingSlide, activeSchedule])

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
                    executeAction(action)
                }
                break
        }
    }, [searchInput, searchedActions, actions, focusedActionIndex, executeAction])

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

    // Categorised basic actions
    const basicActions = actions?.filter((a: QuickAction) => !a?.searchableOnly)
    const primaryActions = basicActions.filter(a => PRIMARY_ACTIONS.has(a.action))
    const createActions = basicActions.filter(a => CREATE_ACTIONS.has(a.action))
    const otherActions = basicActions.filter(a => !PRIMARY_ACTIONS.has(a.action) && !CREATE_ACTIONS.has(a.action))

    // Handle page close
    const handleClosePage = useCallback(() => {
        setQuickActionsPage('')
    }, [setQuickActionsPage])

    // Build flat action list for keyboard navigation index tracking
    const allVisibleActions = useMemo(() => {
        if (searchInput.length >= 2) return searchedActions
        return [...primaryActions, ...createActions, ...otherActions]
    }, [searchInput, searchedActions, primaryActions, createActions, otherActions])

    return (
        <div className="relative">
            {/* Search Input */}
            <div className="mb-3">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={handleInputKeydown}
                        placeholder="Search actions, scripture, hymns..."
                        className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:bg-gray-800/50 dark:text-white transition-colors placeholder:text-gray-400"
                    />
                    {searchInput && (
                        <button
                            onClick={() => setSearchInput('')}
                            className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Search hints */}
                {searchInput.trim().length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <span>Search:</span>
                        <div className="flex gap-1">
                            {[slideTypes.bible, slideTypes.hymn, slideTypes.song].map(type => (
                                <SlideChip key={type} slideType={type} />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Sub-page navigation */}
            {page && (
                <button
                    onClick={handleClosePage}
                    className="mb-2 text-xs text-[var(--accent-teal)] hover:underline font-medium"
                >
                    ← Back to actions
                </button>
            )}

            {/* Content based on page state */}
            {page === 'bible' || page === 'search-bible' ? (
                <BibleList onClose={handleClosePage} />
            ) : page === 'hymn' ? (
                <HymnList onClose={handleClosePage} />
            ) : page === 'dictionary' ? (
                <DictionaryPanel onClose={handleClosePage} isInline />
            ) : page === 'song' ? (
                <SongList onClose={handleClosePage} />
            ) : (
                <div ref={actionsContainerRef}>
                    {searchInput.length >= 2 ? (
                        /* Search results — flat list */
                        <div className="space-y-0.5">
                            {searchedActions.map((action: QuickAction, index: number) => (
                                <ActionCard
                                    key={action.name}
                                    action={{ ...action, bibleChapterAndVerse }}
                                    dataActionIndex={index}
                                    isFocused={index === focusedActionIndex}
                                    onClick={() => {
                                        setFocusedActionIndex(index)
                                        executeAction(action)
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        /* Default view — grouped actions */
                        <>
                            {/* Primary actions */}
                            {primaryActions.length > 0 && (
                                <div className="mb-3">
                                    <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1 px-1">
                                        Content
                                    </div>
                                    <div className="space-y-0.5">
                                        {primaryActions.map((action, index) => (
                                            <ActionCard
                                                key={action.name}
                                                action={action}
                                                dataActionIndex={index}
                                                isFocused={index === focusedActionIndex}
                                                onClick={() => {
                                                    setFocusedActionIndex(index)
                                                    executeAction(action)
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Create actions */}
                            {createActions.length > 0 && (
                                <div className="mb-3">
                                    <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1 px-1">
                                        Create
                                    </div>
                                    <div className="space-y-0.5">
                                        {createActions.map((action, index) => {
                                            const globalIndex = primaryActions.length + index
                                            return (
                                                <ActionCard
                                                    key={action.name}
                                                    action={action}
                                                    dataActionIndex={globalIndex}
                                                    isFocused={globalIndex === focusedActionIndex}
                                                    onClick={() => {
                                                        setFocusedActionIndex(globalIndex)
                                                        executeAction(action)
                                                    }}
                                                />
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Other actions (settings, schedule, etc.) */}
                            {otherActions.length > 0 && (
                                <div>
                                    <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1 px-1">
                                        More
                                    </div>
                                    <div className="space-y-0.5">
                                        {otherActions.map((action, index) => {
                                            const globalIndex = primaryActions.length + createActions.length + index
                                            return (
                                                <ActionCard
                                                    key={action.name}
                                                    action={action}
                                                    dataActionIndex={globalIndex}
                                                    isFocused={globalIndex === focusedActionIndex}
                                                    onClick={() => {
                                                        setFocusedActionIndex(globalIndex)
                                                        executeAction(action)
                                                    }}
                                                />
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Empty state for search */}
                    {searchInput.length >= 2 && searchedActions.length === 0 && (
                        <div className="text-center py-6 text-sm text-gray-400">
                            No actions found
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
