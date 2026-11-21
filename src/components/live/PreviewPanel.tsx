import { Send } from 'lucide-react'
import { useStagedSlide } from '../preview/useStagedSlide'
import { useLiveDeck } from './useOnAir'
import { OutputThumbnail } from './OutputThumbnail'

/**
 * Preview: the staged slide, as the projector will draw it, ready to send.
 * With nothing staged it shows next up instead, labelled so it can't be
 * mistaken for a slide the operator picked.
 */
export function PreviewPanel() {
    const { staged, canSend, send } = useStagedSlide()
    const { nextUp } = useLiveDeck()
    const slide = staged ?? nextUp

    return (
        <div className="h-full flex flex-col gap-2 p-3 overflow-hidden">
            <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0">
                    <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${staged ? 'text-[var(--accent-teal)]' : 'text-[var(--text-tertiary)]'}`}>
                        {staged ? 'Staged' : 'Next Up'}
                    </div>
                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {slide?.name || (staged ? '' : 'Nothing after this')}
                    </div>
                </div>
                {staged && canSend && (
                    <button
                        onClick={send}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[11px] font-bold flex-shrink-0 transition-colors"
                        title="Send to Live (Enter)"
                    >
                        <Send className="w-3.5 h-3.5" />
                        Send
                    </button>
                )}
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center live-monitor-box">
                <OutputThumbnail
                    slide={slide}
                    emptyText={staged ? '' : 'End of Schedule'}
                    className="preview-panel-frame"
                />
            </div>
        </div>
    )
}
