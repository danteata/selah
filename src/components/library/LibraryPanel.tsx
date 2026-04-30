import { Library, X } from 'lucide-react'
import { LibraryContent } from './LibraryContent'
import { useLibrary } from '../../hooks/useLibrary'

interface LibraryPanelProps {
    isOpen: boolean
    onClose: () => void
}

export function LibraryPanel({ isOpen, onClose }: LibraryPanelProps) {
    const { libraryCount } = useLibrary()

    if (!isOpen) return null

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="fixed right-0 top-0 bottom-0 z-50 w-96 bg-[var(--bg-primary)] shadow-2xl flex flex-col border-l border-[var(--border-default)]">
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)]">
                    <Library className="w-5 h-5 text-[var(--accent-teal)]" />
                    <h2 className="font-semibold text-[var(--text-primary)] flex-1" style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}>
                        My Library
                    </h2>
                    <span className="text-xs text-[var(--text-muted)]">
                        {libraryCount} slides
                    </span>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)]"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden">
                    <LibraryContent />
                </div>
            </div>
        </>
    )
}
