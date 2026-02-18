/**
 * useScrollReveal
 * Drop-in GSAP ScrollTrigger reveal for any section or element.
 *
 * Usage:
 *   const sectionRef = useScrollReveal()          // fade-up on scroll
 *   const sectionRef = useScrollReveal('fade')    // just fade
 *   const { ref } = useScrollReveal('stagger')    // stagger direct children
 */
import { useRef, useEffect } from 'react'
// gsap.ts already registers ScrollTrigger — importing gsap from our lib is sufficient
import { gsap } from '../lib/gsap'

export type RevealVariant = 'fade-up' | 'fade' | 'fade-left' | 'fade-right' | 'stagger' | 'stagger-fast' | 'scale' | 'none'

interface ScrollRevealOptions {
    /** CSS selector for stagger children. Defaults to ':scope > *' */
    staggerSelector?: string
    staggerAmount?: number
    start?: string
    duration?: number
    distance?: number
    delay?: number
    once?: boolean
}

export function useScrollReveal<T extends HTMLElement = HTMLElement>(
    variant: RevealVariant = 'fade-up',
    options: ScrollRevealOptions = {},
) {
    const ref = useRef<T>(null)

    useEffect(() => {
        const el = ref.current
        if (!el || variant === 'none') return

        const {
            staggerSelector = ':scope > *',
            staggerAmount = 0.08,
            start = 'top 88%',
            duration = 0.7,
            distance = 28,
            delay = 0,
            once = true,
        } = options

        let ctx: gsap.Context

        if (variant === 'stagger' || variant === 'stagger-fast') {
            const children = el.querySelectorAll(staggerSelector)
            const amount = variant === 'stagger-fast' ? staggerAmount * 0.6 : staggerAmount

            ctx = gsap.context(() => {
                gsap.fromTo(
                    children,
                    { opacity: 0, y: distance * 0.6 },
                    {
                        opacity: 1,
                        y: 0,
                        duration,
                        delay,
                        stagger: amount,
                        ease: 'power3.out',
                        scrollTrigger: {
                            trigger: el,
                            start,
                            once,
                        },
                    },
                )
            }, el)
        } else {
            const fromVars: gsap.TweenVars = { opacity: 0 }
            const toVars: gsap.TweenVars = { opacity: 1, duration, delay, ease: 'power3.out' }

            switch (variant) {
                case 'fade-up':
                    fromVars.y = distance
                    toVars.y = 0
                    break
                case 'fade-left':
                    fromVars.x = distance
                    toVars.x = 0
                    break
                case 'fade-right':
                    fromVars.x = -distance
                    toVars.x = 0
                    break
                case 'scale':
                    fromVars.scale = 0.9
                    toVars.scale = 1
                    break
                case 'fade':
                default:
                    break
            }

            ctx = gsap.context(() => {
                gsap.fromTo(el, fromVars, {
                    ...toVars,
                    scrollTrigger: {
                        trigger: el,
                        start,
                        once,
                    },
                })
            }, el)
        }

        return () => {
            ctx.revert()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [variant])

    return ref
}
