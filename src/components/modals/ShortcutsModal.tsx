import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'

interface ShortcutsModalProps {
    isOpen: boolean
    onClose: () => void
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose()
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
    }, [isOpen, onClose])

    if (!isOpen) return null

    const shortcutGroups = [
        {
            title: 'General',
            shortcuts: [
                { keys: ['⌘', '/'], description: 'Focus quick actions search' },
                { keys: ['⌘', ','], description: 'Open settings' },
                { keys: ['⌘', 'H'], description: 'Show this help' },
                { keys: ['Esc'], description: 'Close modal / Clear selection' },
            ],
        },
        {
            title: 'Slides',
            shortcuts: [
                { keys: ['⌘', 'Z'], description: 'Undo' },
                { keys: ['⌘', 'Y'], description: 'Redo' },
                { keys: ['⌘', 'S'], description: 'Save to library' },
                { keys: ['Delete'], description: 'Delete selected slide' },
            ],
        },
        {
            title: 'Navigation',
            shortcuts: [
                { keys: ['↑'], description: 'Previous slide' },
                { keys: ['↓'], description: 'Next slide' },
                { keys: ['Home'], description: 'First slide' },
                { keys: ['End'], description: 'Last slide' },
            ],
        },
        {
            title: 'Live Presentation',
            shortcuts: [
                { keys: ['⌘', 'P'], description: 'Promote to live' },
                { keys: ['Space'], description: 'Toggle live slide' },
                { keys: ['B'], description: 'Black screen' },
                { keys: ['W'], description: 'White screen' },
            ],
        },
    ]

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-primary-500/10 to-primary-600/10">
                    <Keyboard className="w-6 h-6 text-primary-600" />
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Keyboard Shortcuts
                    </h2>
                    <button
                        onClick={onClose}
                        className="ml-auto p-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                    <div className="grid grid-cols-2 gap-6">
                        {shortcutGroups.map((group) => (
                            <div key={group.title}>
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                                    {group.title}
                                </h3>
                                <div className="space-y-2">
                                    {group.shortcuts.map((shortcut, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center justify-between py-1.5"
                                        >
                                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                                {shortcut.description}
                                            </span>
                                            <div className="flex gap-1">
                                                {shortcut.keys.map((key, keyIndex) => (
                                                    <kbd
                                                        key={keyIndex}
                                                        className="px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 min-w-[24px] text-center"
                                                    >
                                                        {key}
                                                    </kbd>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                        On Windows/Linux, use <kbd className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">Ctrl</kbd> instead of <kbd className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">⌘</kbd>
                    </p>
                </div>
            </div>
        </div>
    )
}
