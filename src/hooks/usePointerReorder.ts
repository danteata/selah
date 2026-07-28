import { useCallback, useRef, useState } from 'react'

/**
 * Drag-to-reorder built on pointer events, which is the only kind that works
 * everywhere Selah runs.
 *
 * Native HTML5 drag-and-drop is dead inside the desktop webview: Tauri's
 * file-drop handler (`dragDropEnabled`, on by default) consumes the drag events
 * before the page sees them. Turning it off is not an option — media import and
 * the song migration wizard both rely on `onDragDropEvent` to accept files
 * dropped onto the window — so anything reorderable in-page has to be driven by
 * pointer events instead. The slide queue already does this; this hook is that
 * approach made reusable.
 *
 * Usage:
 *
 *   const reorder = usePointerReorder({ onReorder: move })
 *   <ul {...reorder.containerProps}>
 *     {items.map((item, i) => (
 *       <li key={item.id} {...reorder.itemProps(i)}>
 *         <GripVertical {...reorder.handleProps(i)} />
 *       </li>
 *     ))}
 *   </ul>
 *
 * `draggingIndex` and `dragOverIndex` are exposed for styling; the caller owns
 * all classes.
 */

/** Marks a row as a drop target. The hook finds rows by this attribute. */
const INDEX_ATTRIBUTE = 'data-reorder-index'

export interface UsePointerReorderOptions {
    /** Called with the source and target indices when a drag completes. */
    onReorder: (from: number, to: number) => void
    /** Set false to make the list temporarily non-reorderable. */
    enabled?: boolean
}

export interface UsePointerReorderResult {
    /** Index being dragged, or null. */
    draggingIndex: number | null
    /** Index currently hovered as a drop target, or null. */
    dragOverIndex: number | null
    containerProps: {
        ref: (node: HTMLElement | null) => void
        onPointerMove: (event: React.PointerEvent) => void
        onPointerUp: (event: React.PointerEvent) => void
        onPointerLeave: () => void
    }
    itemProps: (index: number) => Record<string, string | number>
    handleProps: (index: number) => {
        onPointerDown: (event: React.PointerEvent) => void
        /** `touch-none` so a touch drag doesn't scroll the list instead. */
        className: string
        style: React.CSSProperties
    }
}

export function usePointerReorder({
    onReorder,
    enabled = true,
}: UsePointerReorderOptions): UsePointerReorderResult {
    // The source index lives in a ref, not state: the pointer handlers read it
    // on every move, and going through a re-render first would drop events.
    const fromIndexRef = useRef<number | null>(null)
    const containerRef = useRef<HTMLElement | null>(null)
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

    const setContainer = useCallback((node: HTMLElement | null) => {
        containerRef.current = node
    }, [])

    const endDrag = useCallback(() => {
        fromIndexRef.current = null
        setDraggingIndex(null)
        setDragOverIndex(null)
        if (containerRef.current) {
            containerRef.current.style.userSelect = ''
            containerRef.current.style.cursor = ''
        }
    }, [])

    /** The row index under the pointer, or null if the pointer isn't over one. */
    const indexUnderPointer = useCallback((clientX: number, clientY: number): number | null => {
        const element = document.elementFromPoint(clientX, clientY)
        const row = (element as HTMLElement | null)?.closest(`[${INDEX_ATTRIBUTE}]`)
        if (!row) return null
        const index = Number(row.getAttribute(INDEX_ATTRIBUTE))
        return Number.isNaN(index) ? null : index
    }, [])

    const onPointerDown = useCallback((index: number) => (event: React.PointerEvent) => {
        if (!enabled || event.button !== 0) return
        // Stops the browser starting a text selection or its own drag.
        event.preventDefault()
        fromIndexRef.current = index
        setDraggingIndex(index)
        if (containerRef.current) {
            containerRef.current.style.userSelect = 'none'
            containerRef.current.style.cursor = 'grabbing'
        }
    }, [enabled])

    const onPointerMove = useCallback((event: React.PointerEvent) => {
        if (fromIndexRef.current == null) return
        const overIndex = indexUnderPointer(event.clientX, event.clientY)
        if (overIndex != null && overIndex !== fromIndexRef.current) {
            setDragOverIndex(overIndex)
        }
    }, [indexUnderPointer])

    const onPointerUp = useCallback((event: React.PointerEvent) => {
        const from = fromIndexRef.current
        if (from == null) return
        const to = indexUnderPointer(event.clientX, event.clientY)
        // Reset before reordering: onReorder re-renders the list, and leaving
        // drag state set would leave a row stuck in its dragging style.
        endDrag()
        if (to != null && to !== from) onReorder(from, to)
    }, [indexUnderPointer, endDrag, onReorder])

    return {
        draggingIndex,
        dragOverIndex,
        containerProps: {
            ref: setContainer,
            onPointerMove,
            onPointerUp,
            // Releasing outside the list cancels rather than dropping somewhere
            // the operator can't see.
            onPointerLeave: endDrag,
        },
        itemProps: (index: number) => ({ [INDEX_ATTRIBUTE]: index }),
        handleProps: (index: number) => ({
            onPointerDown: onPointerDown(index),
            className: 'touch-none',
            style: { cursor: enabled ? (draggingIndex != null ? 'grabbing' : 'grab') : 'default' },
        }),
    }
}
