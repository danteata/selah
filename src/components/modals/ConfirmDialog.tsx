import { useEffect } from 'react'
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
    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel()
            }
        }

        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            document.body.style.overflow = 'hidden'
        }

        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = ''
        }
    }, [isOpen, onCancel])

    if (!isOpen) return null

    const typeConfig = {
        info: {
            icon: Info,
            iconColor: 'text-blue-500',
            bgColor: 'bg-blue-50 dark:bg-blue-900/20',
            confirmButton: 'bg-blue-600 hover:bg-blue-700',
        },
        warning: {
            icon: AlertTriangle,
            iconColor: 'text-yellow-500',
            bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
            confirmButton: 'bg-yellow-600 hover:bg-yellow-700',
        },
        danger: {
            icon: AlertTriangle,
            iconColor: 'text-red-500',
            bgColor: 'bg-red-50 dark:bg-red-900/20',
            confirmButton: 'bg-red-600 hover:bg-red-700',
        },
        success: {
            icon: CheckCircle,
            iconColor: 'text-green-500',
            bgColor: 'bg-green-50 dark:bg-green-900/20',
            confirmButton: 'bg-green-600 hover:bg-green-700',
        },
    }

    const config = typeConfig[type]
    const Icon = config.icon

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose?.() || onCancel()
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className={`flex items-center gap-3 p-4 ${config.bgColor}`}>
                    <Icon className={`w-6 h-6 ${config.iconColor}`} />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {title}
                    </h3>
                    <button
                        onClick={onClose || onCancel}
                        className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-black/5"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4">
                    <p className="text-gray-600 dark:text-gray-300">
                        {message}
                    </p>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-800">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${config.confirmButton}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
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
