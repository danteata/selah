import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Keyboard navigation for a ranked result list, extracted from the Bible panel
 * so every search surface behaves the same way: the best match is highlighted
 * the moment results appear, ↑/↓ walk the list, Enter presents the highlighted
 * row and Shift+Enter queues it. Before this, the songs and dictionary panels
 * had no key handling at all — you could only pick a result with the mouse.
 *
 * Attach `handleKeyDown` to the panel's root element rather than to the search
 * box: key events then reach it whether the caret is still in the input or focus
 * has moved onto a row, which is why arrows "sometimes" did nothing.
 */
interface UseResultNavigationOptions {
    /** How many rows are currently rendered. */
    count: number
    /**
     * A value that changes when the result set is replaced — typically
     * `` `${query}:${results.length}` ``. The highlight returns to the best match
     * whenever it changes.
     *
     * It must be a primitive, NOT the results array: hooks like `useSongs()`
     * return a fresh array on every render, so an identity comparison reset the
     * highlight on each re-render and the arrow keys looked like they did
     * nothing — the reported "arrows sometimes don't navigate the results".
     */
    resetKey: string | number
    /** Which row to highlight for a fresh result set. Ranked lists put the best
     *  match first, so that's the default. */
    bestIndex?: number
    /** Enter on the highlighted row. `queue` is true when Shift was held. */
    onActivate: (index: number, options: { queue: boolean }) => void
    /** Set false while something else owns the keyboard (e.g. a detail view). */
    enabled?: boolean
}

interface UseResultNavigationResult<T extends HTMLElement = HTMLDivElement> {
    /** Row to highlight, or -1 when there is nothing to highlight. */
    focusedIndex: number
    /** For `onMouseEnter` on a row, so pointer and keyboard agree. */
    setFocusedIndex: (index: number) => void
    /** Attach to the panel root (the element that contains the search box). */
    handleKeyDown: (event: ReactKeyboardEvent) => void
    /** Attach to the scrolling results container to keep the highlight visible.
     *  Rows must carry `data-result-index={index}`. */
    listRef: React.RefObject<T | null>
}

export function useResultNavigation<T extends HTMLElement = HTMLDivElement>({
    count,
    resetKey,
    bestIndex = 0,
    onActivate,
    enabled = true,
}: UseResultNavigationOptions): UseResultNavigationResult<T> {
    // Held together with the result set it belongs to, so a new set is detected
    // during render instead of being corrected by an effect — an effect would
    // render one frame with a stale (possibly out-of-range) highlight first.
    const [focus, setFocus] = useState<{ key: string | number; index: number }>({ key: resetKey, index: bestIndex })

    const seed = count === 0 ? -1 : Math.min(Math.max(bestIndex, 0), count - 1)
    const focusedIndex = !enabled || count === 0
        ? -1
        : focus.key === resetKey
            ? Math.min(Math.max(focus.index, 0), count - 1)
            : seed

    const listRef = useRef<T | null>(null)

    // Keep the highlighted row on screen. 'nearest' scrolls the minimum amount,
    // so arrowing through visible rows doesn't jerk the list around.
    useEffect(() => {
        if (focusedIndex < 0) return
        const row = listRef.current?.querySelector(`[data-result-index="${focusedIndex}"]`)
        if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
    }, [focusedIndex])

    const setFocusedIndex = useCallback((index: number) => {
        setFocus({ key: resetKey, index })
    }, [resetKey])

    const handleKeyDown = useCallback((event: ReactKeyboardEvent) => {
        if (!enabled || count === 0) return

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            const from = focusedIndex < 0 ? (step === 1 ? -1 : 0) : focusedIndex
            setFocus({ key: resetKey, index: (from + step + count) % count })
            return
        }

        if (event.key === 'Enter') {
            // A focused button or link handles its own Enter — acting here too
            // would fire the row action twice.
            const target = event.target as HTMLElement | null
            if (target?.closest('button, a, [role="button"]')) return
            if (focusedIndex < 0) return
            event.preventDefault()
            onActivate(focusedIndex, { queue: event.shiftKey })
        }
    }, [enabled, count, focusedIndex, resetKey, onActivate])

    return { focusedIndex, setFocusedIndex, handleKeyDown, listRef }
}
