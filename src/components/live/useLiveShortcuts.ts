import { useEffect } from 'react'
import { useClaimLiveNavigation, shouldIgnoreShortcut } from '../../hooks'
import type { OnAir } from './useOnAir'

/**
 * ↑/↓ step what's on air through the deck; Ctrl/Cmd + 1–9 jump to that slide
 * and 0 to the last. While mounted these are the only ↑/↓ handler: the
 * Dashboard's schedule-order fallback stands down (useClaimLiveNavigation).
 *
 * "B" is bound once, in Dashboard, which is always mounted. Binding it here
 * as well made the two toggles cancel out whenever both were up.
 */
export function useLiveShortcuts({ deck, previous, nextUp, setOnAir }: Pick<OnAir, 'deck' | 'previous' | 'nextUp' | 'setOnAir'>) {
    useClaimLiveNavigation()

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey || shouldIgnoreShortcut(e)) return
            if (e.key === 'ArrowDown' && nextUp) {
                e.preventDefault()
                setOnAir(nextUp.id)
            } else if (e.key === 'ArrowUp' && previous) {
                e.preventDefault()
                setOnAir(previous.id)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [nextUp, previous, setOnAir])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (shouldIgnoreShortcut(e)) return
            if (!e.ctrlKey && !e.metaKey) return
            const num = parseInt(e.key, 10)
            if (isNaN(num) || num < 0 || num > 9) return
            e.preventDefault()
            const target = deck[num === 0 ? deck.length - 1 : num - 1]
            if (target?._id) setOnAir(target.id)
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [deck, setOnAir])
}
