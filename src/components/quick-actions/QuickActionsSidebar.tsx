import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Search, X, ChevronRight, Book, Music, FileText, Image, Video, Clock, AlertCircle, Layout, Settings, Calendar, Keyboard, Zap, Sparkles, PanelBottom } from 'lucide-react'
import fuzzysort from 'fuzzysort'
import { useHymn, useScripture, useSlideCreation, useSemanticVerseSearch } from '../../hooks'
import { useAppStore } from '../../store/appStore'
import { slideTypes, quickActionsArr, bibleBooks, appWideActions, type QuickAction, type Slide, type Scripture } from '../../types'
import { SlideChip } from '../slides/SlideChip'
import { BibleList } from '../bible/BibleList'
import { HymnList } from '../hymns/HymnList'
import { SongList } from '../songs/SongList'

// Icon mapping for actions
const actionIconMap: Record<string, React.ReactNode> = {
    'i-bx-bible': <Book className="w-4 h-4" />,
    'i-bx-church': <Music className="w-4 h-4" />,
    'i-bx-file': <FileText className="w-4 h-4" />,
    'i-bx-image': <Image className="w-4 h-4" />,
    'i-bx-video': <Video className="w-4 h-4" />,
    'i-bx-time': <Clock className="w-4 h-4" />,
    'i-bx-bell': <AlertCircle className="w-4 h-4" />,
    'i-bx-layout': <Layout className="w-4 h-4" />,
    'i-bx-cog': <Settings className="w-4 h-4" />,
    'i-bx-calendar': <Calendar className="w-4 h-4" />,
    'i-bx-command': <Keyboard className="w-4 h-4" />,
}

// Quick action items for sidebar
const SIDEBAR_ACTIONS = [
    { id: 'bible', icon: <Book className="w-4 h-4" />, label: 'Bible', action: appWideActions.newBible },
    { id: 'hymn', icon: <Music className="w-4 h-4" />, label: 'Hymn', action: appWideActions.newHymn },
    { id: 'song', icon: <Music className="w-4 h-4" />, label: 'Song', action: appWideActions.newSong },
    { id: 'slide', icon: <FileText className="w-4 h-4" />, label: 'Slide', action: appWideActions.newSlide },
    { id: 'lower-third', icon: <PanelBottom className="w-4 h-4" />, label: 'Lower Third', action: appWideActions.newLowerThird },
    { id: 'media', icon: <Image className="w-4 h-4" />, label: 'Media', action: appWideActions.newMedia },
    { id: 'template', icon: <Layout className="w-4 h-4" />, label: 'Templates', action: appWideActions.newTemplates },
    { id: 'countdown', icon: <Clock className="w-4 h-4" />, label: 'Countdown', action: appWideActions.newCountdown },
    { id: 'alert', icon: <AlertCircle className="w-4 h-4" />, label: 'Alert', action: appWideActions.newAlert },
]

export function QuickActionsSidebar() {
    const [searchInput, setSearchInput] = useState('')
    const [actions, setActions] = useState<QuickAction[]>([])
    const [focusedIndex, setFocusedIndex] = useState(0)
    const [previewScripture, setPreviewScripture] = useState<{ action: string; scripture: Scripture | null } | null>(null)

    const searchInputRef = useRef<HTMLInputElement>(null)
    const { getAllHymns, getHymnByNumber } = useHymn()
    const { fetchScripture } = useScripture()
    const { createBibleSlide, createHymnSlides } = useSlideCreation()

    // Semantic verse search hook
    const {
        results: semanticResults,
        isSearching: isSemanticSearching,
        hasEmbeddings,
        isEmbedderReady,
        search: semanticSearch,
        clearResults: clearSemanticResults,
        initEmbedder,
    } = useSemanticVerseSearch({
        threshold: 0.55, // Lower base threshold for short phrases
        limit: 3,
        debounceMs: 400,
        minQueryLength: 2, // Allow searches with just 2 characters
    })

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

    // Initialize embedder early for faster first search
    useEffect(() => {
        if (hasEmbeddings && !isEmbedderReady) {
            initEmbedder()
        }
    }, [hasEmbeddings, isEmbedderReady, initEmbedder])

    // Listen for focus event from keyboard shortcut
    useEffect(() => {
        const handleFocus = () => {
            searchInputRef.current?.focus()
        }
        window.addEventListener('selah:focus-quick-actions', handleFocus)
        return () => window.removeEventListener('selah:focus-quick-actions', handleFocus)
    }, [])

    // Trigger semantic search when search input changes
    useEffect(() => {
        if (searchInput.length >= 2 && hasEmbeddings) {
            // Only do semantic search if it doesn't look like a bible reference
            const looksLikeReference = /^(genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|1?\s?samuel|2?\s?kings|1?\s?chronicles|2?\s?chronicles|ezra|nehemiah|esther|job|psalms?|proverbs?|ecclesiastes|song of solomon|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|1?\s?corinthians|2?\s?corinthians|galatians|ephesians|philippians|colossians|1?\s?thessalonians|2?\s?thessalonians|1?\s?timothy|2?\s?timothy|titus|philemon|hebrews|james|1?\s?peter|2?\s?peter|1?\s?john|2?\s?john|3?\s?john|jude|revelation)\s*\d*/i.test(searchInput)

            if (!looksLikeReference) {
                semanticSearch(searchInput)
            }
        } else if (searchInput.length < 2) {
            clearSemanticResults()
        }
    }, [searchInput, hasEmbeddings, semanticSearch, clearSemanticResults])

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
            ?.replace(/\s*:\s*/g, ':')  // Normalize spaces around colon
            .replace(/\s+/g, ':')       // Replace remaining spaces with colon
        return match?.trim()
    }, [searchInput])

    // Fetch scripture preview for manual references
    useEffect(() => {
        let isMounted = true

        const fetchPreview = async () => {
            if (!bibleChapterAndVerse) {
                if (isMounted) setPreviewScripture(null)
                return
            }

            // Find the active bible action based on search input
            const colonIndex = searchInput.indexOf(':')
            const searchInputBeforeColon = colonIndex === -1 ? searchInput : searchInput.substring(0, colonIndex)
            const results = fuzzysort.go(searchInputBeforeColon, actions, { keys: ['name', 'desc', 'meta'] })
            const topResult = results[0]?.obj as QuickAction | undefined

            if (topResult?.type === 'bible' && topResult.bibleBookIndex) {
                const bookIndex = topResult.bibleBookIndex
                const reference = `${bookIndex}:${bibleChapterAndVerse}`
                const actionStr = `bible:${bookIndex}`

                try {
                    const scripture = await fetchScripture(reference)
                    if (isMounted) {
                        setPreviewScripture({ action: actionStr, scripture })
                    }
                } catch (e) {
                    // Ignore fetch failures for preview
                    if (isMounted) setPreviewScripture({ action: actionStr, scripture: null })
                }
            } else {
                if (isMounted) setPreviewScripture(null)
            }
        }

        const timer = setTimeout(fetchPreview, 300) // Debounce for typing
        return () => {
            isMounted = false
            clearTimeout(timer)
        }
    }, [bibleChapterAndVerse, searchInput, actions, fetchScripture])

    // Filtered actions based on search
    const searchedActions = useMemo<QuickAction[]>(() => {
        const colonIndex = searchInput.indexOf(':')
        const searchInputBeforeColon = colonIndex === -1
            ? searchInput
            : searchInput.substring(0, colonIndex)

        // Check if the input looks like a bible reference pattern
        // (book name followed by chapter number, optionally with verse after colon)
        // This pattern matches: "John 3", "Psalm 119", "1 John 2", etc.
        const looksLikeBibleReference = /^[1-3]?\s*[a-zA-Z]+\s+\d+/.test(searchInputBeforeColon.trim())

        // Only filter out two-digit numbers if it doesn't look like a bible reference
        // This allows "Psalm 23:4", "John 15:7", "Psalm 119:157" to work
        // But still filters out standalone hymn numbers like "45"
        if (!looksLikeBibleReference) {
            const twoDigitNumbers = searchInputBeforeColon
                ?.replace('/', '')
                ?.match(/\b\d{2}\b/g)

            if (twoDigitNumbers) return []
        }

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

        return mappedResults.slice(0, 8)
    }, [searchInput, actions, bibleChapterAndVerse])

    // Handle action execution
    const executeAction = useCallback(async (action: QuickAction | string) => {
        const actionStr = typeof action === 'string' ? action : action.action

        if (actionStr === appWideActions.newBible || actionStr === appWideActions.newSearchBible) {
            setQuickActionsPage('bible')
            return
        }
        if (actionStr === appWideActions.newHymn) {
            setQuickActionsPage('hymn')
            return
        }
        if (actionStr === appWideActions.newSong || actionStr === appWideActions.addSong) {
            setQuickActionsPage('song')
            return
        }
        if (actionStr === appWideActions.newMedia) {
            openModal('mediaPicker')
            return
        }
        if (actionStr === appWideActions.newTemplates) {
            openModal('templateBrowser')
            return
        }
        if (actionStr === appWideActions.newAlert) {
            openModal('alertModal')
            return
        }
        if (actionStr === appWideActions.newCountdown) {
            openModal('countdownModal')
            return
        }
        if (actionStr === appWideActions.newLibrary) {
            openModal('libraryPanel')
            return
        }
        if (actionStr === appWideActions.openSettings) {
            openModal('settings')
            return
        }
        if (actionStr === appWideActions.openScheduleModal) {
            openModal('scheduleModal')
            return
        }
        if (actionStr === appWideActions.openShortcutsModal) {
            openModal('shortcuts')
            return
        }

        if (actionStr.startsWith('bible:')) {
            const bookIndex = typeof action === 'object' && action.bibleBookIndex ? action.bibleBookIndex : '1'
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
            setSearchInput('')
            return
        }

        // Handle semantic verse result selection
        if (actionStr.startsWith('semantic-verse:')) {
            // Parse the reference format: "bookNumber:chapter:verse" (e.g., "45:3:23")
            const referenceData = actionStr.replace('semantic-verse:', '')
            try {
                const scripture = await fetchScripture(referenceData)
                if (scripture) {
                    const slide = createBibleSlide(scripture)
                    if (slide) {
                        appendActiveSlide(slide)
                    }
                }
            } catch (e) {
                console.error('Failed to fetch scripture from semantic search:', e)
            }
            setSearchInput('')
            clearSemanticResults()
            return
        }

        if (actionStr.startsWith('hymn:')) {
            const hymnNumber = typeof action === 'object' && action.hymnIndex ? action.hymnIndex : null
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
            setSearchInput('')
            return
        }

        if (actionStr === appWideActions.newSlide || actionStr === appWideActions.newText) {
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

        if (actionStr === appWideActions.newLowerThird) {
            const newSlide: Slide = {
                id: `slide_${Date.now()}`,
                index: 0,
                name: 'Lower Third',
                type: 'text',
                layout: 'lower-third',
                contents: ['<p>Speaker Name</p>'],
                userId: '',
                churchId: '',
                scheduleId: activeSchedule?._id || '',
                slideStyle: {
                    fontSize: 3.5,
                    alignment: 'left',
                    lowerThirdStyle: 'standard',
                    lowerThirdPosition: 'left',
                    lowerThirdAccentColor: '#0d9488',
                    lowerThirdSubtitle: '',
                },
            }
            setEditingSlide(newSlide)
            openModal('lowerThirdEditor')
            return
        }
    }, [setQuickActionsPage, openModal, fetchScripture, createBibleSlide, appendActiveSlide, getHymnByNumber, createHymnSlides, bibleChapterAndVerse, setEditingSlide, activeSchedule, clearSemanticResults])

    // Handle sidebar action click
    const handleSidebarAction = useCallback((actionStr: string) => {
        executeAction(actionStr)
    }, [executeAction])

    // Handle keyboard navigation
    const handleInputKeydown = useCallback((e: React.KeyboardEvent) => {
        // Combine regular actions with semantic results for navigation
        const totalResults = searchedActions.length + semanticResults.length
        const maxIndex = totalResults - 1

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                if (focusedIndex < maxIndex) {
                    setFocusedIndex(prev => prev + 1)
                }
                break
            case 'ArrowUp':
                e.preventDefault()
                if (focusedIndex > 0) {
                    setFocusedIndex(prev => prev - 1)
                }
                break
            case 'Enter':
                e.preventDefault()
                // Check if we're in semantic results range
                if (focusedIndex >= searchedActions.length) {
                    const semanticIndex = focusedIndex - searchedActions.length
                    const verse = semanticResults[semanticIndex]
                    if (verse) {
                        // Use bookNumber:chapter:verse format for fetchScripture
                        executeAction(`semantic-verse:${verse.bookNumber}:${verse.chapter}:${verse.verse}`)
                    }
                } else {
                    const action = searchedActions?.[focusedIndex]
                    if (action) {
                        executeAction(action)
                    }
                }
                break
            case 'Escape':
                setSearchInput('')
                setFocusedIndex(0)
                clearSemanticResults()
                break
        }
    }, [searchedActions, semanticResults, focusedIndex, executeAction, clearSemanticResults])

    // Get icon for action
    const getActionIcon = (iconStr: string): React.ReactNode => {
        return actionIconMap[iconStr] || <Zap className="w-4 h-4" />
    }

    return (
        <div className="h-full flex flex-col">
            {/* Search Input - always visible */}
            <div className="mb-2">
                <div className="relative">
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)] w-3.5 h-3.5" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchInput}
                        onChange={(e) => {
                            setSearchInput(e.target.value)
                            setFocusedIndex(0)
                        }}
                        onKeyDown={handleInputKeydown}
                        placeholder="Search..."
                        className="w-full pl-7 pr-6 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg focus:ring-2 focus:ring-[var(--accent-teal)]/20 focus:border-[var(--accent-teal)] text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)]"
                    />
                    {searchInput && (
                        <button
                            onClick={() => {
                                setSearchInput('')
                                setFocusedIndex(0)
                                clearSemanticResults()
                            }}
                            className="absolute right-1.5 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Search Results or Action Buttons */}
            <div className="flex-1 overflow-y-auto">
                {searchInput.length >= 2 ? (
                    /* Search Results */
                    <div className="space-y-0.5">
                        {/* Regular action results */}
                        {searchedActions.map((action, index) => {
                            // Render rich bible preview if available
                            if (action.type === 'bible' && previewScripture?.action === action.action && previewScripture.scripture?.content) {
                                const content = previewScripture.scripture.content
                                const verseText = Array.isArray(content) ? content.map(v => v.scripture).join(' ') : content
                                return (
                                    <button
                                        key={action.name}
                                        onClick={() => executeAction(action)}
                                        className={`
                                            w-full flex flex-col gap-0.5 px-2 py-1.5 rounded-lg text-left text-xs
                                            transition-colors
                                            ${index === focusedIndex
                                                ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                                : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                                            }
                                        `}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="flex-shrink-0">
                                                <Book className="w-4 h-4" />
                                            </span>
                                            <span className="font-medium truncate">{previewScripture.scripture.label}</span>
                                            <SlideChip slideType="bible" />
                                        </div>
                                        <span className="text-[11px] text-[var(--text-secondary)] line-clamp-2 pl-6">
                                            {verseText}
                                        </span>
                                    </button>
                                )
                            }

                            // Standard rendering
                            return (
                                <button
                                    key={action.name}
                                    onClick={() => executeAction(action)}
                                    className={`
                                        w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs
                                        transition-colors
                                        ${index === focusedIndex
                                            ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                            : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                                        }
                                    `}
                                >
                                    <span className="flex-shrink-0">
                                        {getActionIcon(action.icon)}
                                    </span>
                                    <span className="truncate">{action.name}</span>
                                    {action.type && (
                                        <SlideChip slideType={action.type} />
                                    )}
                                </button>
                            )
                        })}

                        {/* Semantic verse results */}
                        {semanticResults.length > 0 && (
                            <>
                                {semanticResults.map((verse, index) => {
                                    const globalIndex = searchedActions.length + index
                                    return (
                                        <button
                                            key={verse._id}
                                            onClick={() => executeAction(`semantic-verse:${verse.bookNumber}:${verse.chapter}:${verse.verse}`)}
                                            className={`
                                                w-full flex flex-col gap-0.5 px-2 py-1.5 rounded-lg text-left text-xs
                                                transition-colors
                                                ${globalIndex === focusedIndex
                                                    ? 'bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]'
                                                    : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                                                }
                                            `}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="flex-shrink-0">
                                                    <Book className="w-4 h-4" />
                                                </span>
                                                <span className="font-medium truncate">{verse.reference}</span>
                                                <SlideChip slideType="bible" />
                                                <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                                                    {Math.round(verse.score * 100)}% match
                                                </span>
                                            </div>
                                            <span className="text-[11px] text-[var(--text-secondary)] line-clamp-2 pl-6">
                                                {verse.text}
                                            </span>
                                        </button>
                                    )
                                })}
                            </>
                        )}

                        {/* Loading indicator for semantic search */}
                        {isSemanticSearching && (
                            <div className="flex items-center justify-center gap-2 py-2 text-xs text-[var(--text-muted)]">
                                <div className="w-3 h-3 border-2 border-[var(--accent-teal)] border-t-transparent rounded-full animate-spin" />
                                Searching verses...
                            </div>
                        )}

                        {/* No results message */}
                        {searchedActions.length === 0 && semanticResults.length === 0 && !isSemanticSearching && (
                            <p className="text-xs text-[var(--text-muted)] text-center py-4">
                                No results
                            </p>
                        )}
                    </div>
                ) : (
                    /* Quick Action Buttons */
                    <div className="space-y-0.5">
                        {SIDEBAR_ACTIONS.map((action) => (
                            <button
                                key={action.id}
                                onClick={() => handleSidebarAction(action.action)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                            >
                                <span className="flex-shrink-0 text-[var(--text-tertiary)]">
                                    {action.icon}
                                </span>
                                <span className="truncate flex-1">{action.label}</span>
                                <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
                            </button>
                        ))}

                        {/* Divider */}
                        <div className="border-t border-[var(--border-subtle)] my-2" />

                        {/* Settings & Schedule */}
                        <button
                            onClick={() => handleSidebarAction(appWideActions.openScheduleModal)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                            <Calendar className="w-4 h-4" />
                            <span className="truncate">Schedule</span>
                        </button>
                        <button
                            onClick={() => handleSidebarAction(appWideActions.openSettings)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                            <Settings className="w-4 h-4" />
                            <span className="truncate">Settings</span>
                        </button>
                        <button
                            onClick={() => handleSidebarAction(appWideActions.openShortcutsModal)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                            <Keyboard className="w-4 h-4" />
                            <span className="truncate">Shortcuts</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Page view for Bible/Hymn/Song */}
            {page && (
                <div className="absolute inset-0 bg-[var(--bg-secondary)] z-10 flex flex-col">
                    <div className="flex-shrink-0 p-2 border-b border-[var(--border-subtle)]">
                        <button
                            onClick={() => setQuickActionsPage('')}
                            className="text-xs text-[var(--accent-teal)] hover:text-[var(--accent-teal)]/80 font-medium"
                        >
                            ← Back to actions
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {page === 'bible' && <BibleList onClose={() => setQuickActionsPage('')} />}
                        {page === 'hymn' && <HymnList onClose={() => setQuickActionsPage('')} />}
                        {page === 'song' && <SongList onClose={() => setQuickActionsPage('')} />}
                    </div>
                </div>
            )}
        </div>
    )
}