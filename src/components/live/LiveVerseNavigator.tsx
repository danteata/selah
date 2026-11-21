import { useCallback, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import { useLiveSession, useVerseNavigationShortcuts, VERSE_NAV_PRIORITY } from '../../hooks'
import { useNativeMultiMonitor } from '../../hooks/useNativeMultiMonitor'
import { withScripture } from '../../hooks/useSlideCreation'
import type { Scripture, Slide } from '../../types'
import { BibleVerseNavigator, type BibleVerseNavigatorHandle } from '../bible/BibleVerseNavigator'

interface LiveVerseNavigatorProps {
    liveSlide: Slide | undefined
    className?: string
}

/**
 * Step through the passage on air: the navigator strip, and N / P / ← / →
 * from anywhere. Only while scripture is on air, so it never swallows those
 * keys for anything else. ↑/↓ stay with the deck.
 */
export function LiveVerseNavigator({ liveSlide, className }: LiveVerseNavigatorProps) {
    const navigatorRef = useRef<BibleVerseNavigatorHandle | null>(null)
    const { isDesktop, sendSlideToLive } = useNativeMultiMonitor()
    const { syncSlideContent } = useLiveSession()
    const isScripture = liveSlide?.type === 'bible'

    useVerseNavigationShortcuts(
        () => navigatorRef.current?.navigateVerse('next'),
        () => navigatorRef.current?.navigateVerse('prev'),
        { enabled: isScripture, priority: VERSE_NAV_PRIORITY.live }
    )

    const handleVerseSelect = useCallback((scripture: Scripture) => {
        if (!liveSlide || liveSlide.type !== 'bible') return
        // scripture.content already holds exactly the verses the navigator
        // selected (single verse, shift-clicked set, or dragged span).
        const updatedSlide = withScripture(liveSlide, scripture)
        useAppStore.getState().updateActiveSlide(updatedSlide)
        window.dispatchEvent(new CustomEvent('broadcast-slide', { detail: updatedSlide }))
        if (isDesktop) {
            void sendSlideToLive(liveSlide.id, updatedSlide as unknown as Record<string, unknown>)
        }
        void syncSlideContent(updatedSlide)
    }, [liveSlide, isDesktop, sendSlideToLive, syncSlideContent])

    if (!liveSlide || !isScripture) return null
    const navigator = (
        <BibleVerseNavigator
            ref={navigatorRef}
            currentSlide={liveSlide}
            onVerseSelect={handleVerseSelect}
        />
    )
    return className ? <div className={className}>{navigator}</div> : navigator
}
