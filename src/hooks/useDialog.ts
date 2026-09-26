import { useEffect, useRef } from 'react'

/**
 * The keyboard and focus behaviour every dialog needs: focus moves in and Tab
 * stays inside, Escape closes only the topmost of stacked dialogs, focus goes
 * back to the opener, and the page behind stops scrolling.
 *
 * `Modal` is built on this. A dialog that draws its own overlay (to animate
 * out with framer-motion, say) uses it directly: attach the returned ref to
 * the panel.
 */

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

// Open dialogs, innermost last: only the top one answers Escape and Tab.
const stack: symbol[] = []
let scrollLocks = 0

interface DialogOptions {
    isOpen: boolean
    onClose: () => void
    closeOnEscape?: boolean
}

export function useDialog<T extends HTMLElement = HTMLDivElement>({ isOpen, onClose, closeOnEscape = true }: DialogOptions) {
    const panelRef = useRef<T>(null)
    const onCloseRef = useRef(onClose)
    const closeOnEscapeRef = useRef(closeOnEscape)
    useEffect(() => {
        onCloseRef.current = onClose
        closeOnEscapeRef.current = closeOnEscape
    })

    useEffect(() => {
        if (!isOpen) return
        const id = Symbol('dialog')
        stack.push(id)
        const opener = document.activeElement as HTMLElement | null

        if (scrollLocks++ === 0) document.body.style.overflow = 'hidden'

        // Respect an autoFocus inside the panel; otherwise take the first
        // control, or the panel itself.
        const panel = panelRef.current
        if (panel && !panel.contains(document.activeElement)) {
            const first = panel.querySelector<HTMLElement>(FOCUSABLE)
            ;(first ?? panel).focus()
        }

        const onKeyDown = (e: KeyboardEvent) => {
            if (stack[stack.length - 1] !== id || e.defaultPrevented) return
            if (e.key === 'Escape' && closeOnEscapeRef.current) {
                e.stopPropagation()
                onCloseRef.current()
                return
            }
            if (e.key !== 'Tab' || !panelRef.current) return
            const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
            if (items.length === 0) {
                e.preventDefault()
                return
            }
            const first = items[0]
            const last = items[items.length - 1]
            const active = document.activeElement
            if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
                e.preventDefault()
                last.focus()
            } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
                e.preventDefault()
                first.focus()
            }
        }
        // Bubble phase: a control inside that handles Escape itself (a
        // dropdown, the shortcut recorder) and stops it keeps the dialog open.
        document.addEventListener('keydown', onKeyDown)

        return () => {
            document.removeEventListener('keydown', onKeyDown)
            const at = stack.indexOf(id)
            if (at !== -1) stack.splice(at, 1)
            if (--scrollLocks === 0) document.body.style.overflow = ''
            // Hand focus back to what opened the dialog, if it's still there.
            if (opener && opener.isConnected) opener.focus()
        }
    }, [isOpen])

    return panelRef
}
