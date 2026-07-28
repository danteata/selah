import { slideTypes } from '../types'

/**
 * Slide types that render `contents[1]` as a caption in its own zone —
 * above or below the body — instead of as more body text.
 *
 * Bible slides put "John 3:16 · KJV" there; dictionary slides put
 * "Propitiation · Webster's". Both want the same treatment: the caption
 * stays small and fixed while the body auto-fits the remaining space.
 */
const CAPTIONED_SLIDE_TYPES: ReadonlySet<string> = new Set([
    slideTypes.bible,
    slideTypes.dictionary,
])

export function isCaptionedSlideType(type?: string | null): boolean {
    return !!type && CAPTIONED_SLIDE_TYPES.has(type)
}

/** The caption HTML for a slide, or '' when the slide has none. */
export function slideCaptionHtml(
    slide?: { type?: string; contents?: string[] } | null
): string {
    if (!slide || !isCaptionedSlideType(slide.type)) return ''
    return slide.contents?.[1] || ''
}
