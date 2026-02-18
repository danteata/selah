/**
 * useSlideTransition
 * GSAP-powered slide-change animations for the live/preview view.
 *
 * Usage:
 *   const { containerRef, transition } = useSlideTransition('fade')
 *
 *   Call `transition(newSlideId)` when you want to animate to a new slide.
 *   The hook animates: old slide out → new slide in.
 */
import { useRef, useCallback } from 'react'
import { gsap } from '../lib/gsap'

export type SlideTransitionType =
    | 'none'
    | 'fade'
    | 'slide-up'
    | 'slide-down'
    | 'slide-left'
    | 'slide-right'
    | 'zoom-in'
    | 'zoom-out'
    | 'blur'
    | 'wipe-up'
    | 'reveal'

interface UseSlideTransitionOptions {
    duration?: number
    ease?: string
}

const TRANSITION_DURATION = 0.55

/**
 * Animate the old element OUT.
 */
function animateOut(
    el: HTMLElement,
    type: SlideTransitionType,
    duration: number,
    ease: string,
): Promise<void> {
    return new Promise((resolve) => {
        if (type === 'none') { resolve(); return }

        const tl = gsap.timeline({ onComplete: resolve })

        switch (type) {
            case 'fade':
                tl.to(el, { opacity: 0, duration, ease })
                break
            case 'slide-up':
                tl.to(el, { y: '-100%', opacity: 0, duration, ease })
                break
            case 'slide-down':
                tl.to(el, { y: '100%', opacity: 0, duration, ease })
                break
            case 'slide-left':
                tl.to(el, { x: '-100%', opacity: 0, duration, ease })
                break
            case 'slide-right':
                tl.to(el, { x: '100%', opacity: 0, duration, ease })
                break
            case 'zoom-in':
                tl.to(el, { scale: 1.08, opacity: 0, duration, ease })
                break
            case 'zoom-out':
                tl.to(el, { scale: 0.92, opacity: 0, duration, ease })
                break
            case 'blur':
                tl.to(el, { filter: 'blur(24px)', opacity: 0, duration, ease })
                break
            case 'wipe-up':
            case 'reveal':
                tl.to(el, { clipPath: 'inset(100% 0 0 0)', duration, ease })
                break
            default:
                resolve()
        }
    })
}

/**
 * Animate the new element IN.
 */
function animateIn(
    el: HTMLElement,
    type: SlideTransitionType,
    duration: number,
    ease: string,
): void {
    if (type === 'none') {
        gsap.set(el, { clearProps: 'all' })
        return
    }

    // Reset to starting state first
    switch (type) {
        case 'fade':
            gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration, ease })
            break
        case 'slide-up':
            gsap.fromTo(el, { y: '100%', opacity: 0 }, { y: '0%', opacity: 1, duration, ease })
            break
        case 'slide-down':
            gsap.fromTo(el, { y: '-100%', opacity: 0 }, { y: '0%', opacity: 1, duration, ease })
            break
        case 'slide-left':
            gsap.fromTo(el, { x: '100%', opacity: 0 }, { x: '0%', opacity: 1, duration, ease })
            break
        case 'slide-right':
            gsap.fromTo(el, { x: '-100%', opacity: 0 }, { x: '0%', opacity: 1, duration, ease })
            break
        case 'zoom-in':
            gsap.fromTo(el, { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration, ease })
            break
        case 'zoom-out':
            gsap.fromTo(el, { scale: 1.08, opacity: 0 }, { scale: 1, opacity: 1, duration, ease })
            break
        case 'blur':
            gsap.fromTo(el, { filter: 'blur(24px)', opacity: 0 }, { filter: 'blur(0px)', opacity: 1, duration, ease })
            break
        case 'wipe-up':
        case 'reveal':
            gsap.fromTo(el,
                { clipPath: 'inset(100% 0 0 0)' },
                { clipPath: 'inset(0% 0 0 0)', duration, ease: 'power4.inOut' }
            )
            break
        default:
            gsap.set(el, { clearProps: 'all' })
    }
}

export function useSlideTransition(
    type: SlideTransitionType = 'fade',
    options: UseSlideTransitionOptions = {},
) {
    const containerRef = useRef<HTMLDivElement>(null)
    const isAnimatingRef = useRef(false)

    const duration = options.duration ?? TRANSITION_DURATION
    const ease = options.ease ?? 'power3.inOut'

    /**
     * Call this when the slide content has already changed in the DOM.
     * Pass the container element (or use containerRef).
     */
    const animateSlideChange = useCallback(
        (el?: HTMLElement | null) => {
            const target = el ?? containerRef.current
            if (!target || type === 'none' || isAnimatingRef.current) return

            isAnimatingRef.current = true

            // Quick fade-out then fade-in on the same element
            // (content has already swapped so we do an instant hide → animate in)
            gsap.killTweensOf(target)

            // Set start state immediately
            switch (type) {
                case 'fade':
                    gsap.set(target, { opacity: 0 })
                    gsap.to(target, { opacity: 1, duration, ease, onComplete: () => { isAnimatingRef.current = false } })
                    break
                case 'slide-up':
                    gsap.set(target, { y: '4%', opacity: 0 })
                    gsap.to(target, { y: '0%', opacity: 1, duration, ease, onComplete: () => { isAnimatingRef.current = false } })
                    break
                case 'slide-down':
                    gsap.set(target, { y: '-4%', opacity: 0 })
                    gsap.to(target, { y: '0%', opacity: 1, duration, ease, onComplete: () => { isAnimatingRef.current = false } })
                    break
                case 'slide-left':
                    gsap.set(target, { x: '4%', opacity: 0 })
                    gsap.to(target, { x: '0%', opacity: 1, duration, ease, onComplete: () => { isAnimatingRef.current = false } })
                    break
                case 'slide-right':
                    gsap.set(target, { x: '-4%', opacity: 0 })
                    gsap.to(target, { x: '0%', opacity: 1, duration, ease, onComplete: () => { isAnimatingRef.current = false } })
                    break
                case 'zoom-in':
                    gsap.set(target, { scale: 0.96, opacity: 0 })
                    gsap.to(target, { scale: 1, opacity: 1, duration, ease, onComplete: () => { isAnimatingRef.current = false } })
                    break
                case 'zoom-out':
                    gsap.set(target, { scale: 1.04, opacity: 0 })
                    gsap.to(target, { scale: 1, opacity: 1, duration, ease, onComplete: () => { isAnimatingRef.current = false } })
                    break
                case 'blur':
                    gsap.set(target, { filter: 'blur(12px)', opacity: 0 })
                    gsap.to(target, { filter: 'blur(0px)', opacity: 1, duration, ease, onComplete: () => { isAnimatingRef.current = false } })
                    break
                case 'wipe-up':
                case 'reveal':
                    gsap.set(target, { clipPath: 'inset(0 0 100% 0)' })
                    gsap.to(target, {
                        clipPath: 'inset(0 0 0% 0)',
                        duration,
                        ease: 'power4.inOut',
                        onComplete: () => {
                            gsap.set(target, { clearProps: 'clipPath' })
                            isAnimatingRef.current = false
                        },
                    })
                    break
                default:
                    isAnimatingRef.current = false
            }
        },
        [type, duration, ease],
    )

    return { containerRef, animateSlideChange, animateIn, animateOut }
}

export { animateIn, animateOut }
