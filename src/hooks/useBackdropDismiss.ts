import { useCallback, useRef, type MouseEvent } from 'react'

/**
 * Props for a modal backdrop that closes it on a click — a real one.
 *
 * `onClick` alone fires on mouseup, wherever the press began. Drag-selecting
 * lyrics in a textarea and letting go over the backdrop therefore closed the
 * modal and threw the work away. This only counts a click whose press also
 * started on the backdrop itself.
 */
export function useBackdropDismiss(onDismiss: (() => void) | undefined) {
    const pressedOnBackdrop = useRef(false)

    const onMouseDown = useCallback((e: MouseEvent<HTMLElement>) => {
        pressedOnBackdrop.current = e.target === e.currentTarget
    }, [])

    const onClick = useCallback((e: MouseEvent<HTMLElement>) => {
        const began = pressedOnBackdrop.current
        pressedOnBackdrop.current = false
        if (began && e.target === e.currentTarget) onDismiss?.()
    }, [onDismiss])

    return { onMouseDown, onClick }
}
