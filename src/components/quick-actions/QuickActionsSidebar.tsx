import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Search, X, ChevronRight, Book, Music, FileText, Image, Video, Clock, AlertCircle, Layout, Settings, Calendar, Keyboard, Zap } from 'lucide-react'
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
    { id: 'media', icon: <Image className="w-4 h-4" />, label: 'Media', action: appWideActions.newMedia },
    { id: 'template', icon: <Layout className="w-4 h-4" />, label: 'Templates', action: appWideActions.newTemplates },
    { id: 'countdown', icon: <Clock className="w-4 h-4" />, label: 'Countdown', action: appWideActions.newCountdown },
    { id: 'alert', icon: <AlertCircle className="w-4 h-4" />, label: 'Alert', action: appWideActions.newAlert },
]

interface QuickActionsSidebarProps {
    compact?: boolean
}

export function QuickActionsSidebar({ compact = false }: QuickActionsSidebarProps) {
    const [searchInput, setSearchInput] = useState('')
    const [isExpanded, setIsExpanded] = useState(false)
    const [actions, setActions] = useState<QuickAction[]>([])
    const [focusedIndex, setFocusedIndex] = useState(0)

    const searchInputRef = useRef<HTMLInputElement>(null)
    const { getAllHymns, getHymnByNumber } = useHymn()
    const { fetchScripture } = useScripture()
    const { createBibleSlide, createHymnSlides } = useSlideCreation()

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
    }, [setQuickActionsPage, openModal, fetchScripture, createBibleSlide, appendActiveSlide, getHymnByNumber, createHymnSlides, bibleChapterAndVerse, setEditingSlide, activeSchedule])

    // Handle sidebar action click
    const handleSidebarAction = useCallback((actionStr: string) => {
        executeAction(actionStr)
    }, [executeAction])

    // Handle keyboard navigation
    const handleInputKeydown = useCallback((e: React.KeyboardEvent) => {
        const currentActions = searchInput.length >= 2 ? searchedActions : []
        const maxIndex = currentActions.length - 1

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
                const action = currentActions?.[focusedIndex]
                if (action) {
                    executeAction(action)
                }
                break
            case 'Escape':
                setSearchInput('')
                setFocusedIndex(0)
                break
        }
    }, [searchInput, searchedActions, focusedIndex, executeAction])

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
                        {searchedActions.map((action, index) => (
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
                        ))}
                        {searchedActions.length === 0 && (
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