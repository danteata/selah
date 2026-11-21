import { useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks/useLiveSession'
import { shouldIgnoreShortcut } from '../../hooks/useKeyboardShortcuts'
import { queueSlidesFor } from './groupQueueItems'

/**
 * Enter sends the staged slide on air, from anywhere on the desk. It lived in
 * the service order, so it only worked while that panel was mounted; Preview
 * and the service order can now sit anywhere, or in a background tab.
 *
 * Mounted once, in the shell. Renders nothing.
 */
export function StagedSlideShortcut() {
    const {
        isConnected,
        isOperator,
        isContributor,
        isOpen,
        setLiveSlide: setSharedLiveSlide,
        sessionScheduleId,
    } = useLiveSession()
    const canGoLive = !isConnected || isOperator || (isContributor && isOpen)

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
            if (shouldIgnoreShortcut(e)) return
            // Enter on a focused button or link is that control's own click.
            const el = document.activeElement
            if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) return
            if (!canGoLive) return

            const { stagedSlideId, liveSlideId, activeSlides, activeSchedule } = useAppStore.getState()
            if (!stagedSlideId || stagedSlideId === liveSlideId) return
            // Only a slide still in the service order: one removed since it
            // was staged, or from another schedule, is nothing staged.
            const inServiceOrder = queueSlidesFor(activeSlides, sessionScheduleId || activeSchedule?._id)
                .some((slide) => slide.id === stagedSlideId)
            if (!inServiceOrder) return

            e.preventDefault()
            void setSharedLiveSlide(stagedSlideId)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [canGoLive, setSharedLiveSlide, sessionScheduleId])

    return null
}
