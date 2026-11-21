import { useCallback, useMemo } from 'react'
import { useAppStore } from '../../store/appStore'
import { useLiveSession } from '../../hooks/useLiveSession'
import type { Slide } from '../../types'
import { queueSlidesFor } from './groupQueueItems'

export interface StagedSlide {
    /**
     * The slide waiting to go on air: staged, still in the service order, and
     * not already on air. Anything else counts as nothing staged.
     */
    staged: Slide | undefined
    /** This desk may send to air (the service order's rule). */
    canSend: boolean
    /** Send the staged slide on air. Does nothing when there is none. */
    send: () => void
}

export function useStagedSlide(): StagedSlide {
    const stagedSlideId = useAppStore((state) => state.stagedSlideId)
    const liveSlideId = useAppStore((state) => state.liveSlideId)
    const activeSlides = useAppStore((state) => state.activeSlides)
    const activeScheduleId = useAppStore((state) => state.activeSchedule?._id)
    const {
        isConnected,
        isOperator,
        isContributor,
        isOpen,
        setLiveSlide: setSharedLiveSlide,
        sessionScheduleId,
    } = useLiveSession()
    const canSend = !isConnected || isOperator || (isContributor && isOpen)

    const staged = useMemo(() => {
        if (!stagedSlideId || stagedSlideId === liveSlideId) return undefined
        return queueSlidesFor(activeSlides, sessionScheduleId || activeScheduleId)
            .find((slide) => slide.id === stagedSlideId)
    }, [stagedSlideId, liveSlideId, activeSlides, sessionScheduleId, activeScheduleId])

    const send = useCallback(() => {
        if (!staged || !canSend) return
        void setSharedLiveSlide(staged.id)
    }, [staged, canSend, setSharedLiveSlide])

    return { staged, canSend, send }
}
