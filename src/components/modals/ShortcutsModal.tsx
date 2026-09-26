import { X, Keyboard } from 'lucide-react'
import { Modal } from './Modal'

interface ShortcutsModalProps {
    isOpen: boolean
    onClose: () => void
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
    const shortcutGroups = [
        {
            title: 'General',
            shortcuts: [
                { keys: ['⌘', 'K'], description: 'Command palette' },
                { keys: ['⌘', '/'], description: 'Focus quick actions search' },
                { keys: ['⌘', ','], description: 'Open settings' },
                { keys: ['?'], description: 'Show this help' },
                { keys: ['Esc'], description: 'Close modal' },
            ],
        },
        {
            title: 'Slides',
            shortcuts: [
                { keys: ['⌘', 'Z'], description: 'Undo' },
                { keys: ['⌘', 'Y'], description: 'Redo' },
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
                { keys: ['⌘', '1–9'], description: 'Go to slide in the live deck' },
            ],
        },
        {
            title: 'Bible Verses',
            shortcuts: [
                { keys: ['N'], description: 'Next verse (bible slide)' },
                { keys: ['P'], description: 'Previous verse (bible slide)' },
                { keys: ['←'], description: 'Previous verse (bible slide)' },
                { keys: ['→'], description: 'Next verse (bible slide)' },
            ],
        },
        {
            title: 'Bible Panel',
            shortcuts: [
                { keys: ['`'], description: 'Edit reference — book · chapter · verse' },
                { keys: ['0-9'], description: 'Go to verse (live bible slide)' },
                { keys: ['V'], description: 'Version picker — then press its number' },
                { keys: ['⇧', 'V'], description: 'Cycle Bible version' },
            ],
        },
        {
            title: 'Live Presentation',
            shortcuts: [
                { keys: ['⌘', 'P'], description: 'Promote to live' },
                { keys: ['B'], description: 'Clear the output (and bring it back)' },
            ],
        },
    ]

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            labelledBy="shortcuts-modal-title"
            className="w-full max-w-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden"
        >
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)]">
                <Keyboard className="w-6 h-6 text-[var(--accent-teal)]" />
                <h2 id="shortcuts-modal-title" className="text-lg font-semibold text-[var(--text-primary)]">
                    Keyboard Shortcuts
                </h2>
                <button
                    aria-label="Close"
                    onClick={onClose}
                    className="ml-auto p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)]"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Content */}
            <div className="p-6 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {shortcutGroups.map((group) => (
                        <div key={group.title}>
                            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                                {group.title}
                            </h3>
                            <div className="space-y-2">
                                {group.shortcuts.map((shortcut, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center justify-between py-1.5"
                                    >
                                        <span className="text-sm text-[var(--text-secondary)]">
                                            {shortcut.description}
                                        </span>
                                        <div className="flex gap-1">
                                            {shortcut.keys.map((key, keyIndex) => (
                                                <kbd
                                                    key={keyIndex}
                                                    className="px-2 py-0.5 text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-tertiary)] rounded border border-[var(--border-default)] min-w-[24px] text-center"
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
            <div className="px-6 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                <p className="text-xs text-[var(--text-muted)] text-center">
                    On Windows/Linux, use <kbd className="px-1 py-0.5 bg-[var(--bg-tertiary)] rounded text-[10px]">Ctrl</kbd> instead of <kbd className="px-1 py-0.5 bg-[var(--bg-tertiary)] rounded text-[10px]">⌘</kbd>
                </p>
            </div>
        </Modal>
    )
}
