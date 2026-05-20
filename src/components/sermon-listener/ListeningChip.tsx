import { useSermonListenerContext } from '../sermon-listener/SermonListenerContext'
import { useAppStore } from '../../store/appStore'
import { Mic } from 'lucide-react'

/**
 * A small floating chip at the bottom-right corner when the sermon listener
 * is recording in the background (panel hidden). Clicking reopens the panel.
 */
export function ListeningChip() {
    const sermonListener = useSermonListenerContext()
    const activeNavSection = useAppStore((s) => s.activeNavSection)
    const setActiveNavSection = useAppStore((s) => s.setActiveNavSection)

    // Only show when listening AND the sermon panel is not visible
    if (!sermonListener?.isListening) return null
    if (activeNavSection === 'sermon') return null

    return (
        <button
            onClick={() => setActiveNavSection('sermon')}
            className="fixed bottom-14 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/90 hover:bg-red-600 text-white text-xs font-medium shadow-lg shadow-red-500/30 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
            title="Sermon Listener — Recording in background. Click to show."
        >
            <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            <Mic className="w-3 h-3" />
            <span>Listening&hellip;</span>
        </button>
    )
}