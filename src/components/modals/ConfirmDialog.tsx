import { Modal } from './Modal'
import { X, AlertTriangle, CheckCircle, Info } from 'lucide-react'

export type ConfirmDialogType = 'info' | 'warning' | 'danger' | 'success'

interface ConfirmDialogProps {
    isOpen: boolean
    title: string
    message: string
    type?: ConfirmDialogType
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
    onCancel: () => void
    onClose?: () => void
}

export function ConfirmDialog({
    isOpen,
    title,
    message,
    type = 'info',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    onClose,
}: ConfirmDialogProps) {
    const typeConfig = {
        info: {
            icon: Info,
            iconColor: 'text-[var(--accent-teal)]',
            confirmButton: 'bg-[var(--accent-teal)] hover:brightness-110 transition-all shadow-sm',
        },
        warning: {
            icon: AlertTriangle,
            iconColor: 'text-[var(--accent-amber)]',
            confirmButton: 'bg-yellow-600 hover:bg-yellow-700',
        },
        danger: {
            icon: AlertTriangle,
            iconColor: 'text-[var(--accent-rose)]',
            confirmButton: 'bg-red-600 hover:bg-red-700',
        },
        success: {
            icon: CheckCircle,
            iconColor: 'text-[var(--accent-emerald)]',
            confirmButton: 'bg-green-600 hover:bg-green-700',
        },
    }

    const config = typeConfig[type]
    const Icon = config.icon

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose ?? onCancel}
            role="alertdialog"
            labelledBy="confirm-dialog-title"
            describedBy="confirm-dialog-message"
            className="w-full max-w-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
        >
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)]">
                <Icon className={`w-6 h-6 ${config.iconColor}`} />
                <h3 id="confirm-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">
                    {title}
                </h3>
                <button
                    aria-label="Close"
                    onClick={onClose || onCancel}
                    className="ml-auto p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)]"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Content */}
            <div className="p-4">
                <p id="confirm-dialog-message" className="text-[var(--text-secondary)]">
                    {message}
                </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 p-4 border-t border-[var(--border-subtle)]">
                {/* Focus moves into the dialog so Enter answers it — before, it
                    re-pressed whatever button behind it had opened it. A
                    destructive confirm starts on Cancel. */}
                <button
                    autoFocus={type === 'danger'}
                    onClick={onCancel}
                    className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg hover:text-[var(--text-primary)] transition-colors"
                >
                    {cancelText}
                </button>
                <button
                    autoFocus={type !== 'danger'}
                    onClick={onConfirm}
                    className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${config.confirmButton}`}
                >
                    {confirmText}
                </button>
            </div>
        </Modal>
    )
}

// Hook for using confirm dialog
import { useState, useCallback } from 'react'

interface ConfirmOptions {
    title: string
    message: string
    type?: ConfirmDialogType
    confirmText?: string
    cancelText?: string
}

// eslint-disable-next-line react-refresh/only-export-components -- dev-only fast refresh; the useConfirmDialog hook lives beside its dialog
export function useConfirmDialog() {
    const [isOpen, setIsOpen] = useState(false)
    const [options, setOptions] = useState<ConfirmOptions>({
        title: '',
        message: '',
    })
    const [resolveRef, setResolveRef] = useState<(value: boolean) => void>()

    const confirm = useCallback((newOptions: ConfirmOptions): Promise<boolean> => {
        setOptions(newOptions)
        setIsOpen(true)

        return new Promise((resolve) => {
            setResolveRef(() => resolve)
        })
    }, [])

    const handleConfirm = useCallback(() => {
        setIsOpen(false)
        resolveRef?.(true)
    }, [resolveRef])

    const handleCancel = useCallback(() => {
        setIsOpen(false)
        resolveRef?.(false)
    }, [resolveRef])

    const ConfirmDialogComponent = useCallback(() => (
        <ConfirmDialog
            isOpen={isOpen}
            title={options.title}
            message={options.message}
            type={options.type}
            confirmText={options.confirmText}
            cancelText={options.cancelText}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
        />
    ), [isOpen, options, handleConfirm, handleCancel])

    return {
        confirm,
        ConfirmDialog: ConfirmDialogComponent,
    }
}
