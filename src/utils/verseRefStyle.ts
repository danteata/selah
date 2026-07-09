import type { CSSProperties } from 'react'
import type { SlideStyle } from '../types'

type VerseRefStyleFields = Pick<
    SlideStyle,
    'verseRefColor' | 'verseRefBold' | 'verseRefItalic' | 'verseRefUnderline' | 'verseRefSizePercent'
>

interface ClampBase {
    /** Minimum px at the low end of the clamp(). */
    minPx: number
    /** Coefficient for the viewport/container-relative unit (vw or cqw). */
    coefficient: number
    unit: 'vw' | 'cqw'
    /** Maximum px at the high end of the clamp(). */
    maxPx: number
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
