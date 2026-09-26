import { useEffect, useRef, type ReactNode } from 'react'
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss'

/**
 * The overlay and keyboard behaviour every dialog needs, in one place.
 *
 * The app's ~20 modals each rolled their own: most had no Escape, none kept
 * Tab inside the dialog (it walked on into the studio behind), focus was left
 * on whatever button opened them, and closing one of two stacked modals with
 * Escape closed both. This handles all of that; the caller supplies the panel.
 */

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

// Open modals, innermost last: only the top one answers Escape and Tab.
const stack: symbol[] = []
let scrollLocks = 0

interface ModalProps {
    isOpen: boolean
    onClose: () => void
    children: ReactNode
    /** Id of the element naming the dialog, or use `ariaLabel`. */
    labelledBy?: string
    ariaLabel?: string
    describedBy?: string
    role?: 'dialog' | 'alertdialog'
    /** Classes for the panel. */
    className?: string
    /** Classes for the backdrop, replacing the default dimming. */
    overlayClassName?: string
    closeOnBackdrop?: boolean
    closeOnEscape?: boolean
}

export function Modal({
    isOpen,
    onClose,
    children,
    labelledBy,
    ariaLabel,
    describedBy,
    role = 'dialog',
    className = 'w-full max-w-lg rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] shadow-2xl',
    overlayClassName = 'bg-black/50 backdrop-blur-sm',
    closeOnBackdrop = true,
    closeOnEscape = true,
}: ModalProps) {
    const panelRef = useRef<HTMLDivElement>(null)
    const backdropDismiss = useBackdropDismiss(closeOnBackdrop ? onClose : undefined)
    const onCloseRef = useRef(onClose)
    const closeOnEscapeRef = useRef(closeOnEscape)
    useEffect(() => {
        onCloseRef.current = onClose
        closeOnEscapeRef.current = closeOnEscape
    })

    useEffect(() => {
        if (!isOpen) return
        const id = Symbol('modal')
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

    if (!isOpen) return null

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${overlayClassName}`}
            {...backdropDismiss}
        >
            <div
                ref={panelRef}
                role={role}
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-label={labelledBy ? undefined : ariaLabel}
                aria-describedby={describedBy}
                tabIndex={-1}
                className={`outline-none ${className}`}
            >
                {children}
            </div>
        </div>
    )
}
