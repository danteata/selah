import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'

const CONFIRM_WINDOW_MS = 4000

/**
 * Close for the incidental exits — Escape, a backdrop click — that won't
 * silently throw away unsaved edits.
 *
 * With changes pending, the first attempt only warns; a second within a few
 * seconds discards. Escape used to close editors outright, so pressing it to
 * dismiss a colour picker inside one lost the whole edit. Explicit Cancel and
 * X buttons should keep calling `onClose` directly: those are a decision.
 */
export function useGuardedClose(isDirty: boolean, onClose: () => void) {
    const armedAt = useRef(0)
    const dirtyRef = useRef(isDirty)
    const onCloseRef = useRef(onClose)

    useEffect(() => {
        dirtyRef.current = isDirty
        onCloseRef.current = onClose
        if (!isDirty) armedAt.current = 0
    }, [isDirty, onClose])

    return useCallback(() => {
        if (!dirtyRef.current || Date.now() - armedAt.current < CONFIRM_WINDOW_MS) {
            armedAt.current = 0
            onCloseRef.current()
            return
        }
        armedAt.current = Date.now()
        toast.warning('You have unsaved changes', {
            description: 'Press Esc again (or click outside) to discard them.',
            duration: CONFIRM_WINDOW_MS,
        })
    }, [])
}
