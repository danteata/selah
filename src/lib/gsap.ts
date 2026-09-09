/**
 * GSAP Setup
 * Register all plugins here so they are only registered once.
 * Import from this file everywhere in the app.
 */
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
// `@ts-ignore` on purpose, not `@ts-expect-error`: the GSAP Flip casing
// conflict only surfaces on a case-sensitive filesystem, so on the platforms
// where this import resolves cleanly `@ts-expect-error` becomes an "unused
// directive" error and breaks the build there instead. A suppression for a
// platform-dependent error is exactly what @ts-ignore is for.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { Flip } from 'gsap/Flip'
import { TextPlugin } from 'gsap/TextPlugin'

gsap.registerPlugin(ScrollTrigger, Flip, TextPlugin)

// Global defaults
gsap.defaults({
    ease: 'power3.out',
    duration: 0.7,
})

// ScrollTrigger defaults
ScrollTrigger.defaults({
    toggleActions: 'play none none none',
    start: 'top 85%',
})

export { gsap, ScrollTrigger, Flip, TextPlugin }
export default gsap
