import { useEffect, useState } from 'react'
import type { Countdown, Slide } from '../types'

/**
 * Countdown timing shared by the operator's preview and the projector.
 *
 * They used to run two independent one-second intervals, which drift (and the
 * operator's is throttled in a background tab); reopening the output window
 * restarted its count from the full time; and pause existed only as a hover
 * button on the projector, so the two screens disagreed about the time left.
 *
 * A countdown slide now carries its own clock in `slideStyle`: the moment it
 * ends while running, or the time left while paused. Both screens compute
 * the same answer from it, and it travels with the slide to the output window
 * and to a live session like any other slide change.
 */

/** "HH:MM:SS" or "MM:SS" → seconds. */
export function parseCountdownTime(timeStr: string): number {
    const parts = timeStr.split(':').map(Number)
    if (parts.some((part) => Number.isNaN(part))) return 0
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return 0
}

/** Seconds → "HH:MM:SS", or "MM:SS" under an hour. */
export function formatCountdownTime(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function countdownDurationSeconds(slide: Slide): number {
    const data = slide.data as Countdown | undefined
    return parseCountdownTime(data?.time || slide.contents[1] || '00:05:00')
}

export function isCountdownPaused(slide: Slide): boolean {
    return slide.slideStyle?.countdownPausedRemainingMs != null
}

/**
 * Seconds left. `localStartedAt` covers a slide with no clock of its own (sent
 * live by an older client): it counts from when this screen first showed it.
 */
export function countdownRemainingSeconds(slide: Slide, now: number, localStartedAt: number): number {
    const style = slide.slideStyle
    const totalMs = countdownDurationSeconds(slide) * 1000
    let remainingMs: number
    if (style?.countdownPausedRemainingMs != null) remainingMs = style.countdownPausedRemainingMs
    else if (style?.countdownEndsAt != null) remainingMs = style.countdownEndsAt - now
    else remainingMs = totalMs - (now - localStartedAt)
    return Math.max(0, Math.ceil(remainingMs / 1000))
}

/** The slide with a fresh clock, running from `now`. */
export function startCountdown(slide: Slide, now: number): Slide {
    return {
        ...slide,
        slideStyle: {
            ...slide.slideStyle,
            countdownEndsAt: now + countdownDurationSeconds(slide) * 1000,
            countdownPausedRemainingMs: undefined,
        },
    }
}

export function pauseCountdown(slide: Slide, now: number): Slide {
    if (isCountdownPaused(slide)) return slide
    const remainingMs = countdownRemainingSeconds(slide, now, now) * 1000
    return {
        ...slide,
        slideStyle: { ...slide.slideStyle, countdownPausedRemainingMs: remainingMs },
    }
}

export function resumeCountdown(slide: Slide, now: number): Slide {
    const paused = slide.slideStyle?.countdownPausedRemainingMs
    if (paused == null) return slide
    return {
        ...slide,
        slideStyle: { ...slide.slideStyle, countdownEndsAt: now + paused, countdownPausedRemainingMs: undefined },
    }
}

/** Seconds left on a countdown slide, updated while it runs. */
export function useCountdownSeconds(slide: Slide | null | undefined): number {
    const [now, setNow] = useState(() => Date.now())
    const slideId = slide?.id
    // When this screen first showed the slide; only used without a clock.
    const [localStart, setLocalStart] = useState(() => ({ id: slideId, at: Date.now() }))
    if (localStart.id !== slideId) setLocalStart({ id: slideId, at: Date.now() })

    const running = !!slide && slide.type === 'countdown' && !isCountdownPaused(slide)
    useEffect(() => {
        if (!running) return
        setNow(Date.now())
        // Sub-second, so the displayed second turns over on time on both screens.
        const timer = setInterval(() => setNow(Date.now()), 250)
        return () => clearInterval(timer)
    }, [running, slideId])

    if (!slide || slide.type !== 'countdown') return 0
    return countdownRemainingSeconds(slide, now, localStart.at)
}
