/**
 * MobileVerseStepper — the phone's previous / next verse, while a Bible slide
 * is live. The desktop's verse navigator does this under the program output;
 * on a phone it sits in the thumb bar, above Next.
 *
 * It changes the live slide in place (John 3:16 → 3:17), the same edit the
 * desktop navigator makes: this device's store and output, then the session,
 * from which the desk's projector picks it up.
 */

import { useCallback, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useScripture, withScripture } from '../../hooks'
import { bibleSlideRange, steppedRange } from '../../utils/bibleSlideRange'
import type { Slide } from '../../types'

export function MobileVerseStepper({ slide, onSlideChanged }: {
    slide: Slide
    /** Share the changed slide (the live session's `syncSlideContent`). */
    onSlideChanged: (slide: Slide) => void
}) {
    const { fetchScripture } = useScripture()
    const [busy, setBusy] = useState(false)
    const range = bibleSlideRange(slide)

    const step = useCallback(async (direction: 'prev' | 'next') => {
        const target = range && steppedRange(range, direction)
        if (!range || !target) return
        setBusy(true)
        try {
            const label = `${range.bookIndex}:${range.chapter}:${target.startVerse}${target.endVerse !== target.startVerse ? `-${target.endVerse}` : ''}`
            const scripture = await fetchScripture(label, range.version)
            // The screen may have moved on while the verses loaded.
            const { activeSlides, liveSlideId } = useAppStore.getState()
            const live = activeSlides.find((s) => s.id === liveSlideId)
            if (!scripture || !live || live.id !== slide.id) return

            const updated = withScripture(live, scripture)
            useAppStore.getState().updateActiveSlide(updated)
            window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updated }))
            onSlideChanged(updated)
        } finally {
            setBusy(false)
        }
    }, [range, slide.id, fetchScripture, onSlideChanged])

    if (!range) return null
    const verses = range.startVerse === range.endVerse ? `${range.startVerse}` : `${range.startVerse}–${range.endVerse}`
    const buttonClass = 'h-11 px-3 flex items-center gap-1 rounded-xl text-sm font-semibold text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-default)] active:scale-[0.97] transition-transform disabled:opacity-35 disabled:active:scale-100'

    return (
        <div className="flex items-center gap-2 mb-2">
            <button
                type="button"
                onClick={() => void step('prev')}
                disabled={busy || !steppedRange(range, 'prev')}
                aria-label="Previous verse"
                className={buttonClass}
            >
                <ChevronLeft className="w-5 h-5" />
                Verse
            </button>
            <span className="flex-1 min-w-0 text-center text-sm font-medium text-[var(--text-secondary)] truncate tabular-nums">
                {range.bookName} {range.chapter}:{verses}
            </span>
            <button
                type="button"
                onClick={() => void step('next')}
                disabled={busy || !steppedRange(range, 'next')}
                aria-label="Next verse"
                className={buttonClass}
            >
                Verse
                <ChevronRight className="w-5 h-5" />
            </button>
        </div>
    )
}
