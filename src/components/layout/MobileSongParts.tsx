/**
 * MobileSongParts — the live song's sections as a row of chips in the phone's
 * thumb bar ("Verse 1 · Chorus · Verse 2 …"), so any part is one tap away,
 * not only the next one. The song analogue of MobileVerseStepper.
 */

import { useEffect, useRef } from 'react'
import type { Slide } from '../../types'

export function MobileSongParts({ parts, liveSlideId, onGoLive }: {
    parts: Slide[]
    liveSlideId: string | null
    onGoLive: (slide: Slide) => void
}) {
    const liveRef = useRef<HTMLButtonElement>(null)

    // Keep the live part in view as the song moves on.
    useEffect(() => {
        liveRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
    }, [liveSlideId])

    return (
        <div className="flex gap-1.5 mb-2 -mx-4 px-4 overflow-x-auto no-scrollbar" role="group" aria-label="Song sections">
            {parts.map((slide, i) => {
                const live = slide.id === liveSlideId
                return (
                    <button
                        key={slide.id}
                        ref={live ? liveRef : undefined}
                        type="button"
                        onClick={() => { if (!live) onGoLive(slide) }}
                        aria-pressed={live}
                        className={`h-10 px-3.5 flex-shrink-0 rounded-xl text-sm font-semibold whitespace-nowrap active:scale-[0.97] transition-transform ${live
                            ? 'text-white bg-red-500/90'
                            : 'text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-default)]'}`}
                    >
                        {slide.verseLabel || `Part ${i + 1}`}
                    </button>
                )
            })}
        </div>
    )
}
