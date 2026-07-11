import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, BookOpen } from 'lucide-react'
import { useScripture } from '../../hooks'
import { useAppStore } from '../../store/appStore'
import type { Scripture, BibleVerse, Slide } from '../../types'
import { bibleBooks } from '../../types'

interface BibleVerseNavigatorProps {
    currentSlide: Slide | null | undefined
    onVerseSelect: (scripture: Scripture) => void
}

export interface BibleVerseNavigatorHandle {
    /** Move the navigator's current verse range by one range in the given direction. */
    navigateVerse: (direction: 'prev' | 'next') => void
}

export const BibleVerseNavigator = forwardRef<BibleVerseNavigatorHandle, BibleVerseNavigatorProps>(function BibleVerseNavigator(
    { currentSlide, onVerseSelect },
    ref
) {
    const [neighboringVerses, setNeighboringVerses] = useState<{ prev: BibleVerse[]; next: BibleVerse[] }>({ prev: [], next: [] })
    const [currentVerses, setCurrentVerses] = useState<BibleVerse[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedVersion, setSelectedVersion] = useState<string>('')
    const [downloadedVersionIds, setDownloadedVersionIds] = useState<string[]>([])
    // Which verse numbers are currently selected for display — seeded from
    // whatever the live slide actually shows (see the seeding effect below),
    // then driven by click / shift+click / drag in the grid.
    const [selectedVerses, setSelectedVerses] = useState<Set<number>>(new Set())
    const dragAnchorRef = useRef<number | null>(null)
    const isMouseDownRef = useRef(false)
    const isDraggingRef = useRef(false)
    const justDraggedRef = useRef(false)

    const { fetchScripture, fetchScriptureByVerseNumbers, isVersionDownloaded } = useScripture()
    const defaultBibleVersion = useAppStore((state) => state.settings.defaultBibleVersion)

    // Check which versions are downloaded
    useEffect(() => {
        const checkVersions = async () => {
            // Check common versions
            const commonVersions = ['KJV', 'ASV', 'WEB', 'YLT', 'NKJV', 'NIV', 'AMP', 'NLT']
            const downloaded: string[] = []
            for (const v of commonVersions) {
                const isDownloaded = await isVersionDownloaded(v)
                if (isDownloaded) {
                    downloaded.push(v)
                }
            }
            setDownloadedVersionIds(downloaded)
        }
        checkVersions()
    }, [isVersionDownloaded])

    // Initialize version from slide data or default
    useEffect(() => {
        if (currentSlide?.type === 'bible') {
            const data = currentSlide.data as Scripture | undefined
            if (data?.version) {
                setSelectedVersion(data.version)
                return
            }
        }
        if (!selectedVersion) {
            setSelectedVersion(defaultBibleVersion || 'KJV')
        }
    }, [currentSlide, defaultBibleVersion, selectedVersion])

    // Parse current slide to get scripture reference
    const scriptureRef = useMemo(() => {
        if (!currentSlide || currentSlide.type !== 'bible') return null

        const data = currentSlide.data as Scripture | undefined
        if (!data) return null

        // Parse labelShortFormat (e.g., "43:3:16-18" for John 3:16-18)
        const parts = data.labelShortFormat?.split(':')
        if (!parts || parts.length < 3) return null

        const bookIndex = parseInt(parts[0])
        const chapter = parseInt(parts[1])
        const versePart = parts[2]

        let startVerse: number
        let endVerse: number

        if (versePart.includes('-')) {
            const [start, end] = versePart.split('-')
            startVerse = parseInt(start)
            endVerse = parseInt(end)
        } else {
            startVerse = parseInt(versePart)
            endVerse = startVerse
        }

        return {
            bookIndex,
            bookName: bibleBooks[bookIndex - 1] || '',
            chapter,
            startVerse,
            endVerse,
            version: data.version || selectedVersion,
        }
    }, [currentSlide, selectedVersion])

    // Seed the selection from whatever the live slide actually shows —
    // "selected" always tracks "currently displayed" (e.g. just the first
    // verse of an auto-detected range), not the full originally-detected
    // range, so the grid's highlighting never contradicts the slide.
    useEffect(() => {
        if (!scriptureRef) {
            setSelectedVerses(new Set())
            return
        }
        const displayed = currentSlide?.displayVerseNumbers
        if (displayed && displayed.length > 0) {
            setSelectedVerses(new Set(displayed))
            return
        }
        const wholeRange: number[] = []
        for (let v = scriptureRef.startVerse; v <= scriptureRef.endVerse; v++) {
            wholeRange.push(v)
        }
        setSelectedVerses(new Set(wholeRange))
        // Only re-seed when the live slide identity changes (or the range it
        // encodes changes) — not on every render, so a user's in-progress
        // click/drag selection isn't clobbered mid-interaction.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSlide?.id, scriptureRef?.startVerse, scriptureRef?.endVerse, currentSlide?.displayVerseNumbers])

    const fetchTokenRef = useRef(0)

    useEffect(() => {
        if (!scriptureRef) {
            fetchTokenRef.current += 1
            setNeighboringVerses({ prev: [], next: [] })
            setCurrentVerses([])
            return
        }

        const token = ++fetchTokenRef.current
        setLoading(true)
        // Clear stale data immediately, synchronously with the range change —
        // otherwise the previous range's prev/next verses stay on screen
        // (just dimmed) while the new range's neighbors are fetched one at a
        // time, briefly mixing an old range's numbers with the new one's.
        setNeighboringVerses({ prev: [], next: [] })
        setCurrentVerses([])

        const fetchNeighbors = async () => {
            const { bookIndex, chapter, startVerse, endVerse, version } = scriptureRef

            const currentLabel = `${bookIndex}:${chapter}:${startVerse}${endVerse !== startVerse ? `-${endVerse}` : ''}`
            const currentResult = await fetchScripture(currentLabel, version)
            if (token !== fetchTokenRef.current) return
            if (currentResult && Array.isArray(currentResult.content)) {
                setCurrentVerses(currentResult.content as BibleVerse[])
            } else {
                setCurrentVerses([])
            }

            const prevStart = Math.max(1, startVerse - 5)
            if (prevStart < startVerse) {
                const prevLabel = `${bookIndex}:${chapter}:${prevStart}-${startVerse - 1}`
                const prevResult = await fetchScripture(prevLabel, version)
                if (token !== fetchTokenRef.current) return
                if (prevResult && Array.isArray(prevResult.content)) {
                    setNeighboringVerses({ prev: prevResult.content as BibleVerse[], next: [] })
                } else {
                    setNeighboringVerses(prev => ({ ...prev, prev: [] }))
                }
            } else {
                setNeighboringVerses(prev => ({ ...prev, prev: [] }))
            }

            const nextEnd = endVerse + 5
            const nextLabel = `${bookIndex}:${chapter}:${endVerse + 1}-${nextEnd}`
            const nextResult = await fetchScripture(nextLabel, version)
            if (token !== fetchTokenRef.current) return
            if (nextResult && Array.isArray(nextResult.content)) {
                setNeighboringVerses(prev => ({ ...prev, next: nextResult.content as BibleVerse[] }))
            } else {
                setNeighboringVerses(prev => ({ ...prev, next: [] }))
            }

            if (token === fetchTokenRef.current) {
                setLoading(false)
            }
        }

        fetchNeighbors()
    }, [scriptureRef, fetchScripture])

    // Combine prev/current/next into one ascending, duplicate-free list for
    // the grid. Deduplication is a safety net, not the primary fix — prev
    // and next are fetched from strictly outside the current range so they
    // shouldn't overlap it, but a defensive dedupe is cheap insurance
    // against any residual timing edge case producing a repeated verse.
    const gridVerses = useMemo(() => {
        const combined = [...neighboringVerses.prev, ...currentVerses, ...neighboringVerses.next]
        const seen = new Set<number>()
        const deduped: BibleVerse[] = []
        for (const v of combined) {
            const num = Number(v.verse)
            if (seen.has(num)) continue
            seen.add(num)
            deduped.push(v)
        }
        return deduped.sort((a, b) => Number(a.verse) - Number(b.verse))
    }, [neighboringVerses, currentVerses])

    // Commit a (possibly non-contiguous) verse-number selection — used by
    // plain click, shift+click, and drag-end. Fetches exactly those verses
    // and merges them into one Scripture handed to the parent.
    const commitSelection = useCallback(async (verseNums: number[]) => {
        if (!scriptureRef || verseNums.length === 0) return

        const result = await fetchScriptureByVerseNumbers(scriptureRef.bookIndex, scriptureRef.chapter, verseNums, selectedVersion)
        if (result) {
            onVerseSelect(result)
        }
    }, [scriptureRef, selectedVersion, fetchScriptureByVerseNumbers, onVerseSelect])

    const handleVerseClick = useCallback((verseNum: number, event: { shiftKey: boolean }) => {
        if (justDraggedRef.current) {
            // The mouseup handler already committed a drag ending on this
            // button — the browser's synthesized click for the same
            // press-release should not also fire a plain-click selection.
            justDraggedRef.current = false
            return
        }

        if (event.shiftKey) {
            setSelectedVerses(prev => {
                const next = new Set(prev)
                if (next.has(verseNum)) {
                    next.delete(verseNum)
                } else {
                    next.add(verseNum)
                }
                void commitSelection(Array.from(next))
                return next
            })
        } else {
            setSelectedVerses(new Set([verseNum]))
            void commitSelection([verseNum])
        }
    }, [commitSelection])

    const handleVerseMouseDown = useCallback((verseNum: number) => {
        dragAnchorRef.current = verseNum
        isMouseDownRef.current = true
        isDraggingRef.current = false
    }, [])

    const handleVerseMouseEnter = useCallback((verseNum: number) => {
        if (!isMouseDownRef.current || dragAnchorRef.current === null) return
        if (verseNum === dragAnchorRef.current && !isDraggingRef.current) return

        isDraggingRef.current = true
        const anchor = dragAnchorRef.current
        const [lo, hi] = anchor <= verseNum ? [anchor, verseNum] : [verseNum, anchor]
        const span: number[] = []
        for (let v = lo; v <= hi; v++) span.push(v)
        setSelectedVerses(new Set(span))
    }, [])

    // A drag can end anywhere on the page, not just on a verse button.
    useEffect(() => {
        const handleWindowMouseUp = () => {
            if (isMouseDownRef.current && isDraggingRef.current) {
                justDraggedRef.current = true
                setSelectedVerses(prev => {
                    void commitSelection(Array.from(prev))
                    return prev
                })
                // A synthesized click only follows mouseup when the drag
                // started and ended on the SAME button — if it ended on a
                // different one, no click ever fires to consume this flag
                // (see handleVerseClick), so clear it after the tick in
                // which any such click would have already run.
                setTimeout(() => { justDraggedRef.current = false }, 0)
            }
            isMouseDownRef.current = false
            isDraggingRef.current = false
            dragAnchorRef.current = null
        }
        window.addEventListener('mouseup', handleWindowMouseUp)
        return () => window.removeEventListener('mouseup', handleWindowMouseUp)
    }, [commitSelection])

    // Handle verse range selection
    const handleVerseRangeSelect = useCallback(async (startVerse: number, endVerse: number) => {
        if (!scriptureRef) return

        const label = `${scriptureRef.bookIndex}:${scriptureRef.chapter}:${startVerse}${endVerse !== startVerse ? `-${endVerse}` : ''}`
        const result = await fetchScripture(label, selectedVersion)
        if (result) {
            onVerseSelect(result)
        }
    }, [scriptureRef, selectedVersion, fetchScripture, onVerseSelect])

    // Change version and refresh
    const handleVersionChange = useCallback(async (newVersion: string) => {
        setSelectedVersion(newVersion)
        if (scriptureRef) {
            const label = `${scriptureRef.bookIndex}:${scriptureRef.chapter}:${scriptureRef.startVerse}${scriptureRef.endVerse !== scriptureRef.startVerse ? `-${scriptureRef.endVerse}` : ''}`
            const result = await fetchScripture(label, newVersion)
            if (result) {
                onVerseSelect(result)
            }
        }
    }, [scriptureRef, fetchScripture, onVerseSelect])

    // Navigate to previous/next verse
    const navigateVerse = useCallback((direction: 'prev' | 'next') => {
        if (!scriptureRef) return

        const { startVerse, endVerse } = scriptureRef
        const range = endVerse - startVerse + 1

        if (direction === 'prev') {
            const newStart = Math.max(1, startVerse - range)
            handleVerseRangeSelect(newStart, newStart + range - 1)
        } else {
            handleVerseRangeSelect(startVerse + range, endVerse + range)
        }
    }, [scriptureRef, handleVerseRangeSelect])

    // Expose the navigateVerse function to the parent via ref so it can
    // bind keyboard shortcuts (N / P / Left / Right) at a higher level
    // without each instance needing its own listener.
    useImperativeHandle(ref, () => ({ navigateVerse }), [navigateVerse])

    // If not a bible slide, don't render
    if (!scriptureRef) {
        return null
    }

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-primary-500" />
                    <span className="font-medium text-sm">
                        {scriptureRef.bookName} {scriptureRef.chapter}
                    </span>
                </div>

                {/* Version Quick Switch */}
                <div className="flex items-center gap-1">
                    {downloadedVersionIds.slice(0, 5).map((v) => (
                        <button
                            key={v}
                            onClick={() => handleVersionChange(v)}
                            className={`px-2 py-0.5 text-xs rounded transition-colors ${selectedVersion === v
                                ? 'bg-primary-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                                }`}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            {/* Navigation Controls */}
            <div className="flex items-center justify-center gap-2 p-2 border-b border-gray-200 dark:border-gray-700">
                <button
                    onClick={() => navigateVerse('prev')}
                    disabled={scriptureRef.startVerse <= 1}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-30"
                    title="Previous verses"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>

                <span className="text-sm font-medium px-3">
                    {scriptureRef.startVerse === scriptureRef.endVerse
                        ? `Verse ${scriptureRef.startVerse}`
                        : `Verses ${scriptureRef.startVerse}-${scriptureRef.endVerse}`
                    }
                </span>

                <button
                    onClick={() => navigateVerse('next')}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    title="Next verses"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>

            {/* Verse Grid — click to select a single verse, shift+click to add/remove
                one, or click-drag across a span to select a contiguous range.
                Selected verses merge into one slide. */}
            <div className="p-3 relative min-h-[3.25rem]">
                <div
                    className={`flex flex-wrap gap-1 transition-opacity select-none ${loading ? 'opacity-50 pointer-events-none' : ''
                        }`}
                >
                    {gridVerses.map((v) => {
                        const verseNum = parseInt(v.verse)
                        const isSelected = selectedVerses.has(verseNum)
                        return (
                            <button
                                key={v.verse}
                                onMouseDown={() => handleVerseMouseDown(verseNum)}
                                onMouseEnter={() => handleVerseMouseEnter(verseNum)}
                                onClick={(e) => handleVerseClick(verseNum, e)}
                                className={`w-8 h-8 flex items-center justify-center text-sm rounded transition-colors ${isSelected
                                    ? 'bg-primary-500 text-white font-medium'
                                    : 'bg-gray-100 dark:bg-gray-800 hover:bg-primary-100 dark:hover:bg-primary-900/30'
                                    }`}
                                title={`${scriptureRef.bookName} ${scriptureRef.chapter}:${v.verse}${isSelected ? ' (selected — shift+click to remove)' : ' (click to show, shift+click to add, drag to select a range)'}`}
                            >
                                {v.verse}
                            </button>
                        )
                    })}
                </div>
                {loading && (
                    <RefreshCw className="w-4 h-4 animate-spin text-gray-400 absolute top-3 right-3" />
                )}
            </div>

            {/* Quick verse text preview */}
            {currentVerses.length > 0 && (
                <div className="p-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 max-h-32 overflow-y-auto">
                    <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                        {currentVerses.slice(0, 2).map((v) => (
                            <div key={v.verse} className="flex gap-1">
                                <sup className="text-primary-500 shrink-0">{v.verse}</sup>
                                <span>{v.scripture.slice(0, 80)}{v.scripture.length > 80 ? '…' : ''}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
})
