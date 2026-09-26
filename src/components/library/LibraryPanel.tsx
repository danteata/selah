import { Library, X } from 'lucide-react'
import { LibraryContent } from './LibraryContent'
import { useLibrary } from '../../hooks/useLibrary'
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventType } from '../../services/analytics/types'
import { useEffect } from 'react'
import { Modal } from '../modals/Modal'

interface LibraryPanelProps {
    isOpen: boolean
    onClose: () => void
}

export function LibraryPanel({ isOpen, onClose }: LibraryPanelProps) {
    const { libraryCount } = useLibrary()
    const { trackEvent } = useAnalytics()

    useEffect(() => {
        if (isOpen) {
            trackEvent(AnalyticsEventType.LIBRARY_ACCESSED, { library_count: libraryCount })
        }
    }, [isOpen, libraryCount, trackEvent])

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            placement="right"
            overlayClassName="bg-black/30 backdrop-blur-sm"
            zIndexClassName="z-50"
            labelledBy="library-panel-title"
            className="h-full w-96 bg-[var(--bg-primary)] shadow-2xl flex flex-col border-l border-[var(--border-default)]"
        >
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)]">
                <Library className="w-5 h-5 text-[var(--accent-teal)]" />
                <h2 id="library-panel-title" className="font-semibold text-[var(--text-primary)] flex-1" style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}>
                    My Library
                </h2>
                <span className="text-xs text-[var(--text-muted)]">
                    {libraryCount} slides
                </span>
                <button
                    aria-label="Close"
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
        </Modal>
    )
}
