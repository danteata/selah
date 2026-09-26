import type { Slide } from '../types'

/**
 * The CSS filter behind a slide's text: its blur, and its dimming (50% unless
 * the slide sets its own). One definition for the projector and the operator's
 * live monitor — only the projector applied it, so the operator watched a
 * brighter, sharper slide than the room did. `??`, not `||`: a brightness of
 * 0 is a real choice, and `||` turned it back into 50.
 */
export function slideBackgroundFilter(slide: Slide): string {
    const blur = slide.slideStyle?.blur ?? 0
    const brightness = slide.slideStyle?.brightness ?? 50
    return `blur(${blur}px) brightness(${brightness}%)`
}
