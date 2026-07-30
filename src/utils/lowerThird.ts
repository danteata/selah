import type { Slide } from '../types'

/**
 * Whether a slide uses the lower-third layout.
 *
 * Both spellings exist in stored slides: `SLIDE_LAYOUTS.lower_third` is the string
 * `'lower-third'`, but older data (and some code paths) carry the underscored key
 * itself. LiveOutput already checked for both; this keeps the graphics channel
 * from disagreeing with the renderer about what a lower third is.
 */
export function isLowerThird(slide: Pick<Slide, 'layout'> | null | undefined): boolean {
    return slide?.layout === 'lower-third' || slide?.layout === 'lower_third'
}
