/**
 * GSAP Setup
 * Register all plugins here so they are only registered once.
 * Import from this file everywhere in the app.
 */
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
// @ts-ignore - GSAP Flip types casing conflict on Linux with case-sensitive FS
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
