import type { CSSProperties } from 'react'
import type { SlideStyle } from '../types'

type VerseRefStyleFields = Pick<
    SlideStyle,
    'verseRefColor' | 'verseRefBold' | 'verseRefItalic' | 'verseRefUnderline' | 'verseRefSizePercent'
>

export interface ClampBase {
    /** Minimum px at the low end of the clamp(). */
    minPx: number
    /** Coefficient for the viewport/container-relative unit (vw or cqw). */
    coefficient: number
    unit: 'vw' | 'cqw'
    /** Maximum px at the high end of the clamp(). */
    maxPx: number
}

/**
 * The caption's base bounds per layout, shared so the DOM renderer and the canvas
 * renderer (the alternate output) size the reference identically — otherwise the
 * same percentage means one thing on the projector and another on an NDI feed.
 */
export const VERSE_REF_BOUNDS = {
    lowerThird: { minPx: 20, coefficient: 2.4, unit: 'vw', maxPx: 48 },
    // Doubled from 3.2vw / 28–80px, which read too small: operators were setting
    // 200% on every slide to compensate. 100% is now that size.
    fullSlide: { minPx: 56, coefficient: 6.4, unit: 'vw', maxPx: 160 },
} as const satisfies Record<string, ClampBase>

/** Resolved size in pixels, for renderers that cannot use CSS `clamp()`. */
export function resolveVerseRefPx(
    slideStyle: VerseRefStyleFields | undefined,
    defaultStyle: VerseRefStyleFields | undefined,
    base: ClampBase,
    frameWidth: number,
): number {
    const scale = (slideStyle?.verseRefSizePercent ?? defaultStyle?.verseRefSizePercent ?? 100) / 100
    // 1vw is a hundredth of the frame, which is what the DOM clamp resolves against.
    const preferred = base.coefficient * scale * (frameWidth / 100)
    return Math.min(Math.max(preferred, base.minPx * scale), base.maxPx * scale)
}

/** Scales a clamp()'s min/preferred/max by `percent / 100`. */
function scaledClamp({ minPx, coefficient, unit, maxPx }: ClampBase, percent: number): string {
    const scale = percent / 100
    return `clamp(${minPx * scale}px, ${coefficient * scale}${unit}, ${maxPx * scale}px)`
}

/**
 * Resolves the verse-reference caption's color/weight/style/decoration/size
 * from per-slide overrides falling back to the global default, for a given
 * caption's base (unscaled) clamp() bounds — each render site has different
 * base bounds (default layout vs lower-third), so the caller supplies them.
 */
export function getVerseRefStyle(
    slideStyle: VerseRefStyleFields | undefined,
    defaultStyle: VerseRefStyleFields | undefined,
    base: ClampBase
): CSSProperties {
    const color = slideStyle?.verseRefColor ?? defaultStyle?.verseRefColor ?? 'rgba(255,255,255,0.85)'
    const bold = slideStyle?.verseRefBold ?? defaultStyle?.verseRefBold ?? false
    const italic = slideStyle?.verseRefItalic ?? defaultStyle?.verseRefItalic ?? false
    const underline = slideStyle?.verseRefUnderline ?? defaultStyle?.verseRefUnderline ?? false
    const sizePercent = slideStyle?.verseRefSizePercent ?? defaultStyle?.verseRefSizePercent ?? 100

    return {
        color,
        fontWeight: bold ? 700 : 600,
        fontStyle: italic ? 'italic' : 'normal',
        textDecoration: underline ? 'underline' : 'none',
        fontSize: scaledClamp(base, sizePercent),
    }
}
