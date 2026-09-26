import { describe, it, expect, beforeEach } from 'vitest'
import {
    countdownRemainingSeconds,
    formatCountdownTime,
    parseCountdownTime,
    pauseCountdown,
    resumeCountdown,
    startCountdown,
} from '../countdown'
import { useAppStore } from '../../store/appStore'
import type { Slide } from '../../types'

const countdown = (id = 'cd', time = '00:05:00'): Slide => ({
    id, index: 0, name: 'Countdown', type: 'countdown', layout: 'full-text',
    userId: '', churchId: '', scheduleId: '', contents: ['Starting soon', time],
})

describe('countdown clock', () => {
    it('parses and formats times', () => {
        expect(parseCountdownTime('01:02:03')).toBe(3723)
        expect(parseCountdownTime('05:00')).toBe(300)
        expect(parseCountdownTime('nonsense')).toBe(0)
        expect(formatCountdownTime(3723)).toBe('01:02:03')
        expect(formatCountdownTime(65)).toBe('01:05')
    })

    it('gives every screen the same answer from the slide itself', () => {
        const started = startCountdown(countdown(), 1_000_000)
        // Two screens, reading at the same instant, however long each was open.
        expect(countdownRemainingSeconds(started, 1_000_000 + 60_000, 0)).toBe(240)
        expect(countdownRemainingSeconds(started, 1_000_000 + 60_000, 999_999_999)).toBe(240)
    })

    it('freezes while paused and carries on from there when resumed', () => {
        const started = startCountdown(countdown(), 0)
        const paused = pauseCountdown(started, 100_000) // 200s left
        expect(countdownRemainingSeconds(paused, 900_000, 0)).toBe(200)

        const resumed = resumeCountdown(paused, 900_000)
        expect(countdownRemainingSeconds(resumed, 950_000, 0)).toBe(150)
    })

    it('stops at zero', () => {
        const started = startCountdown(countdown(), 0)
        expect(countdownRemainingSeconds(started, 10_000_000, 0)).toBe(0)
    })

    it('counts from when this screen first showed a slide with no clock', () => {
        expect(countdownRemainingSeconds(countdown(), 30_000, 0)).toBe(270)
    })
})

describe('going live starts the clock', () => {
    beforeEach(() => useAppStore.getState().signOut())

    it('stamps a countdown slide when it goes live', () => {
        useAppStore.setState({ activeSlides: [countdown()] })
        useAppStore.getState().setLiveSlide('cd')

        const slide = useAppStore.getState().activeSlides[0]
        expect(slide.slideStyle?.countdownEndsAt).toBeGreaterThan(Date.now())
    })

    it('does not restart a countdown that is already live', () => {
        useAppStore.setState({ activeSlides: [countdown()] })
        useAppStore.getState().setLiveSlide('cd')
        const first = useAppStore.getState().activeSlides[0].slideStyle?.countdownEndsAt

        // A live session echoing the same live slide back.
        useAppStore.getState().setLiveSlide('cd')
        expect(useAppStore.getState().activeSlides[0].slideStyle?.countdownEndsAt).toBe(first)
    })
})
