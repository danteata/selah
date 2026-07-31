/**
 * Applying a template's styling to a slide the alternate output is about to draw.
 *
 * Distinct from `applyTemplateToSlide` in `useSlideCreation`, which stamps a
 * template onto a slide as it is *created*. Here the slide already exists — it
 * may be the very slide that is live on the projector — and the template belongs
 * to the *output*, not to the content. So this returns a styled copy and leaves
 * the original alone: the projector keeps its own look while the output applies
 * its own.
 *
 * Only styling is taken. The template's background is deliberately ignored: a
 * lower third draws a bar over a transparent frame and never shows one, and the
 * live slide's background is the projector's business.
 */

import type { Slide, SlideStyle } from '../../types'
import type { TemplateItem } from '../../hooks/useTemplates'

/** A template's stored slide, which may be JSON or an already-parsed object. */
export function templateSlide(template: TemplateItem | null | undefined): Partial<Slide> | null {
    if (!template) return null
    const stored = template.slideId
    if (typeof stored === 'string') {
        try {
            return JSON.parse(stored) as Partial<Slide>
        } catch {
            return null
        }
    }
    if (typeof stored === 'object' && stored !== null) {
        return stored as Partial<Slide>
    }
    return null
}

/** True when this template describes a lower third. */
export function isLowerThirdTemplate(template: TemplateItem): boolean {
    const layout = templateSlide(template)?.layout
    return layout === 'lower-third' || layout === 'lower_third'
}

/**
 * A copy of `slide` wearing the template's styling. The template's values win,
 * the way they do when a slide is created from one.
 */
export function withTemplateStyle(slide: Slide, template: TemplateItem | null | undefined): Slide {
    const source = templateSlide(template)
    if (!source?.slideStyle) return slide

    const merged: SlideStyle = { ...slide.slideStyle, ...source.slideStyle }
    return {
        ...slide,
        slideStyle: merged,
        // The template decides the layout too, which is how a full-text slide
        // becomes a lower third on this output without being altered anywhere else.
        layout: source.layout ?? slide.layout,
    }
}
