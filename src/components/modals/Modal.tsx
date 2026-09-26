import type { ReactNode } from 'react'
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss'
import { useDialog } from '../../hooks/useDialog'

/**
 * The overlay and keyboard behaviour every dialog needs, in one place.
 *
 * The app's ~20 modals each rolled their own: most had no Escape, none kept
 * Tab inside the dialog (it walked on into the studio behind), focus was left
 * on whatever button opened them, and closing one of two stacked modals with
 * Escape closed both. This handles all of that (see useDialog); the caller
 * supplies the panel.
 */

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
    /** Centred dialog, or a full-height drawer on the right. */
    placement?: 'center' | 'right'
    /** Stacking class for the overlay, for dialogs opened above other layers. */
    zIndexClassName?: string
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
    placement = 'center',
    zIndexClassName = 'z-50',
}: ModalProps) {
    const panelRef = useDialog({ isOpen, onClose, closeOnEscape })
    const backdropDismiss = useBackdropDismiss(closeOnBackdrop ? onClose : undefined)

    if (!isOpen) return null

    return (
        <div
            className={`fixed inset-0 ${zIndexClassName} flex ${placement === 'right' ? 'justify-end' : 'items-center justify-center p-4'} ${overlayClassName}`}
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
