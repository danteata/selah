import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, BookOpen } from 'lucide-react'
import { useScripture } from '../../hooks'
import { useAppStore } from '../../store/appStore'
import { BOOK_MAX_VERSES } from '../../services/sermon-listener/verseDetection'
import type { Scripture, BibleVerse, Slide } from '../../types'
import { bibleBooks } from '../../types'

interface BibleVerseNavigatorProps {
    currentSlide: Slide | null | undefined
    onVerseSelect: (scripture: Scripture) => void
}

// How many version chips to show inline before the rest live in the v-picker.
// Kept small so the navigator stays thin even with many versions downloaded.
const MAX_VERSION_CHIPS = 3

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
    const bibleVersionOrder = useAppStore((state) => state.settings.bibleVersionOrder)

    // Downloaded versions arranged by the operator's saved preference (drag-to-
    // reorder in Bible settings): preferred ids first, then any remaining
    // downloaded ones. This drives the numbered chips + the v-picker slots.
    const orderedVersionIds = useMemo(() => {
        const pref = (bibleVersionOrder ?? []).filter((v) => downloadedVersionIds.includes(v))
        const rest = downloadedVersionIds.filter((v) => !pref.includes(v))
        return [...pref, ...rest]
    }, [bibleVersionOrder, downloadedVersionIds])

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

    // Jump straight to a verse number in the current chapter (used by the
    // type-a-number quick-jump below). Same effect as clicking its grid button.
    const goToVerse = useCallback((n: number) => {
        if (!scriptureRef) return
        const v = Math.max(1, Math.floor(n))
        setSelectedVerses(new Set([v]))
        void commitSelection([v])
    }, [scriptureRef, commitSelection])

    // Step to the next / previous downloaded version (for the v / ⇧V shortcut).
    // Uses the async-verified downloaded list — the static `isDownloaded` flag
    // on bibleVersionObjects can't be trusted here.
    const cycleVersion = useCallback((dir: 1 | -1) => {
        if (orderedVersionIds.length < 2) return
        const at = orderedVersionIds.findIndex((v) => v === selectedVersion)
        const next = ((at < 0 ? 0 : at) + dir + orderedVersionIds.length) % orderedVersionIds.length
        void handleVersionChange(orderedVersionIds[next])
    }, [orderedVersionIds, selectedVersion, handleVersionChange])

    // Jump directly to a numbered version slot (1-based, in the order shown on
    // the chips) — the fast "give me exactly AMP" instead of cycling to it.
    const selectVersionSlot = useCallback((slot: number) => {
        const v = orderedVersionIds[slot - 1]
        if (v && v !== selectedVersion) void handleVersionChange(v)
    }, [orderedVersionIds, selectedVersion, handleVersionChange])

    // Quick keyboard control while a bible slide is live (and no field is
    // focused):
    //   • type a verse number → jump to it ("36" → verse 36, on Enter/pause)
    //   • v → open the numbered version picker; then a digit picks that slot
    //     (v then 1 = first version). v again cycles; ⇧V cycles backwards.
    const [pendingVerse, setPendingVerse] = useState('')
    const [versionPicking, setVersionPicking] = useState(false)
    const pendingRef = useRef('')
    const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const versionModeRef = useRef(false)
    const versionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const goToVerseRef = useRef(goToVerse)
    goToVerseRef.current = goToVerse
    const cycleVersionRef = useRef(cycleVersion)
    cycleVersionRef.current = cycleVersion
    const selectVersionSlotRef = useRef(selectVersionSlot)
    selectVersionSlotRef.current = selectVersionSlot

    useEffect(() => {
        if (!scriptureRef) return
        const setPending = (v: string) => { pendingRef.current = v; setPendingVerse(v) }
        const commitPending = () => {
            if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null }
            const raw = pendingRef.current
            setPending('')
            if (raw) {
                const n = parseInt(raw, 10)
                if (Number.isFinite(n)) goToVerseRef.current(n)
            }
        }
        const exitVersionMode = () => {
            versionModeRef.current = false
            setVersionPicking(false)
            if (versionTimerRef.current) { clearTimeout(versionTimerRef.current); versionTimerRef.current = null }
        }
        const enterVersionMode = () => {
            versionModeRef.current = true
            setVersionPicking(true)
            if (versionTimerRef.current) clearTimeout(versionTimerRef.current)
            versionTimerRef.current = setTimeout(exitVersionMode, 2500)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return
            const el = document.activeElement
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable) return

            // Version-picker mode: a digit chooses the slot; v cycles; Esc/other exits.
            if (versionModeRef.current) {
                if (e.key >= '1' && e.key <= '9') {
                    e.preventDefault(); exitVersionMode(); selectVersionSlotRef.current(parseInt(e.key, 10)); return
                }
                if (e.key === 'v' || e.key === 'V') { e.preventDefault(); enterVersionMode(); cycleVersionRef.current(e.shiftKey ? -1 : 1); return }
                if (e.key === 'Escape') { e.preventDefault(); exitVersionMode(); return }
                exitVersionMode() // any other key drops out of version mode, then falls through
            }

            if (e.key >= '0' && e.key <= '9') {
                e.preventDefault()
                if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
                const buf = (pendingRef.current + e.key).slice(0, 3)
                setPending(buf)
                const n = parseInt(buf, 10)
                const chapterMax = BOOK_MAX_VERSES[scriptureRef.bookName]?.[scriptureRef.chapter - 1]
                // Auto-commit the moment no further digit could form a valid verse
                // (n×10 already exceeds the chapter's verse count) — single digits
                // fire instantly, "36" lands as soon as it's unambiguous, and long
                // chapters (Psalm 119) still accept three digits. Fall back to a
                // short pause when we don't know the chapter length.
                if (chapterMax && n * 10 > chapterMax) {
                    commitPending()
                } else {
                    pendingTimerRef.current = setTimeout(commitPending, 1100)
                }
            } else if (e.key === 'Enter' && pendingRef.current) {
                e.preventDefault()
                commitPending()
            } else if (e.key === 'Escape' && pendingRef.current) {
                e.preventDefault()
                if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null }
                setPending('')
            } else if (e.key === 'V' && e.shiftKey) {
                e.preventDefault()
                cycleVersionRef.current(-1)
            } else if (e.key === 'v') {
                e.preventDefault()
                enterVersionMode()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('keydown', onKey)
            if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null }
            if (versionTimerRef.current) { clearTimeout(versionTimerRef.current); versionTimerRef.current = null }
        }
    }, [scriptureRef])

    // If not a bible slide, don't render
    if (!scriptureRef) {
        return null
    }

    return (
        <div className="relative bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Type-a-number quick-jump readout — appears while digits are being
                entered, clears on commit/timeout. */}
            {pendingVerse && (
                <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-500 text-white text-xs font-semibold shadow-lg tabular-nums pointer-events-none">
                    Go to v{pendingVerse}
                </div>
            )}
            {/* Version picker — appears after pressing "v", press a number to pick. */}
            {versionPicking && (
                <div className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 bg-gray-900/95 text-white shadow-lg pointer-events-none">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60 mr-1">Version →</span>
                    {orderedVersionIds.map((v, i) => (
                        <span
                            key={v}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${selectedVersion === v ? 'bg-primary-500' : 'bg-white/10'}`}
                        >
                            <kbd className="text-[9px] font-bold text-white/70">{i + 1}</kbd>
                            {v}
                        </span>
                    ))}
                </div>
            )}
            {/* Row 1 — book·chapter, version quick-switch, and verse stepper, all
                on one compact line so the navigator stays thin. */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <BookOpen className="w-4 h-4 text-primary-500 shrink-0" />
                <span className="font-medium text-sm truncate">
                    {scriptureRef.bookName} {scriptureRef.chapter}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                    {orderedVersionIds.slice(0, MAX_VERSION_CHIPS).map((v, i) => (
                        <button
                            key={v}
                            onClick={() => handleVersionChange(v)}
                            title={`${v} — press v then ${i + 1}`}
                            className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] rounded transition-colors ${selectedVersion === v
                                ? 'bg-primary-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                                }`}
                        >
                            <span className={`text-[8px] font-bold tabular-nums ${selectedVersion === v ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>{i + 1}</span>
                            {v}
                        </button>
                    ))}
                    {orderedVersionIds.length > MAX_VERSION_CHIPS && (
                        <span
                            className="px-1 py-0.5 text-[10px] text-gray-400 dark:text-gray-500"
                            title={`${orderedVersionIds.length - MAX_VERSION_CHIPS} more — press v to pick any version`}
                        >
                            +{orderedVersionIds.length - MAX_VERSION_CHIPS}
                        </span>
                    )}
                </div>
                <div className="flex-1 min-w-0" />
                <button
                    onClick={() => navigateVerse('prev')}
                    disabled={scriptureRef.startVerse <= 1}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-30 shrink-0"
                    title="Previous verses"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-medium tabular-nums whitespace-nowrap shrink-0">
                    {scriptureRef.startVerse === scriptureRef.endVerse
                        ? `v${scriptureRef.startVerse}`
                        : `v${scriptureRef.startVerse}–${scriptureRef.endVerse}`
                    }
                </span>
                <button
                    onClick={() => navigateVerse('next')}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded shrink-0"
                    title="Next verses"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            {/* Row 2 — verse numbers as a single horizontal-scroll strip (handles
                long chapters without growing tall). Click to show, shift+click to
                add/remove, drag across for a contiguous range. The strip keeps a
                fixed height and shows skeleton chips while a new range's verses
                fetch — otherwise the row collapses to zero height between the
                synchronous clear (above) and the refetch, and the whole navigator
                jumps on every selection. */}
            <div className="px-2 py-1.5 relative">
                <div
                    className={`flex gap-1 min-h-7 overflow-x-auto custom-scrollbar select-none transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''
                        }`}
                >
                    {gridVerses.length === 0 && loading
                        ? Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={`skeleton-${i}`}
                                className="w-7 h-7 shrink-0 rounded bg-gray-100 dark:bg-gray-800 animate-pulse"
                            />
                        ))
                        : gridVerses.map((v) => {
                        const verseNum = parseInt(v.verse)
                        const isSelected = selectedVerses.has(verseNum)
                        return (
                            <button
                                key={v.verse}
                                onMouseDown={() => handleVerseMouseDown(verseNum)}
                                onMouseEnter={() => handleVerseMouseEnter(verseNum)}
                                onClick={(e) => handleVerseClick(verseNum, e)}
                                className={`w-7 h-7 shrink-0 flex items-center justify-center text-xs rounded transition-colors ${isSelected
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
                    <RefreshCw className="w-4 h-4 animate-spin text-gray-400 absolute top-1.5 right-2" />
                )}
            </div>
        </div>
    )
})
