/**
 * Draws a lower third onto a canvas, for an alternate output that is sent over
 * NDI (and mirrored to a window) independently of the program output.
 *
 * Why canvas rather than the DOM renderer in `LiveView`: the feed has to carry
 * alpha so a switcher can key it over camera video. Only pixels we render
 * ourselves can do that — a captured window is always composited and opaque.
 *
 * Two consequences of drawing to a transparent surface, both deliberate:
 *   - `backdrop-filter: blur()` from the DOM styles has no meaning here. There is
 *     nothing behind the bar to blur; the translucent fill is kept and the blur
 *     dropped. The switcher composites over live video, which is the real
 *     background.
 *   - Body text is drawn run by run (see `textRuns.ts`), so bold, italic and
 *     colour from the editor survive. Layout is ours rather than the CSS
 *     engine's: runs are measured, wrapped and drawn individually, and the size
 *     steps down until the text fits the bar.
 */

import type { Slide } from '../../types'
import { parseTextRuns, runsToText } from './textRuns'
import { isCaptionedSlideType, slideCaptionHtml } from '../../utils/slideCaption'
import { drawRunLines, fitRuns, type Canvas2DLike } from './renderRuns'

export type { Canvas2DLike }

export interface LowerThirdRenderOptions {
    /** Frame size — the NDI feed's resolution, typically 1920×1080. */
    width: number
    height: number
    /** Fallback font family when the slide doesn't set one. */
    defaultFont?: string
    /** Text colour. SlideStyle carries no colour field — in the DOM renderer it
     *  comes from the TipTap markup, which plain text can't preserve. */
    textColor?: string
    /**
     * Global verse-reference styling from settings. A slide's own
     * `slideStyle.verseRef*` values win over these, matching how the editor and
     * the DOM renderer resolve them.
     */
    verseRef?: {
        color?: string
        bold?: boolean
        italic?: boolean
        sizePercent?: number
    }
}

/** Fraction of the frame height the bar occupies, and its inset from the bottom. */
const BAR_HEIGHT = 0.18
const BAR_BOTTOM_INSET = 0.08
const SIDE_MARGIN = 0.06
const PADDING = 0.025

const DEFAULT_ACCENT = '#0d9488'

/** Line height of body text inside the bar. */
const BODY_LINE_HEIGHT = 1.15
/**
 * Reference size at 100%, as a fraction of the fitted body size, and the ceiling
 * no percentage may pass. The old baseline was a fraction of the bar, which made
 * the reference so small that 200% was needed to look right — the setting should
 * mean the same thing here as on a full slide.
 */
const REFERENCE_RATIO = 0.7
const REFERENCE_MAX_RATIO = 0.85
/** Gap between verse and reference, as a fraction of the reference size. */
const REFERENCE_GAP = 0.55

/** Everything needed to draw, resolved from the slide once so it can be asserted
 *  in tests without a canvas. */
export interface LowerThirdLayout {
    bar: { x: number; y: number; width: number; height: number }
    /** null for the minimalist style, which draws no bar at all. */
    fill: { kind: 'solid'; color: string } | { kind: 'gradient'; from: string; to: string } | null
    accentBar: { x: number; y: number; width: number; height: number; color: string } | null
    title: { text: string; x: number; y: number; fontPx: number; align: CanvasTextAlign; color: string }
    subtitle: {
        text: string
        x: number
        y: number
        fontPx: number
        align: CanvasTextAlign
        color: string
        /** True when the subtitle is a scripture reference, so it takes the
         *  operator's reference styling rather than the body's. */
        isReference: boolean
        bold: boolean
        italic: boolean
        /** The operator's reference size percentage, applied at draw time against
         *  the body's fitted size. */
        sizePercent?: number
    } | null
    fontFamily: string
    outlined: boolean
}

/** TipTap HTML → the plain text the bar shows. */
export function plainTextFromHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|h[1-6]|li)>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

export function layoutLowerThird(slide: Slide, options: LowerThirdRenderOptions): LowerThirdLayout {
    const { width, height } = options
    const style = slide.slideStyle ?? {}

    const barHeight = height * BAR_HEIGHT
    const barY = height - barHeight - height * BAR_BOTTOM_INSET
    const margin = width * SIDE_MARGIN
    const barWidth = width - margin * 2

    const barStyle = style.lowerThirdStyle ?? 'standard'
    const accent = style.lowerThirdAccentColor || DEFAULT_ACCENT

    const fill: LowerThirdLayout['fill'] =
        barStyle === 'minimalist'
            ? null
            : barStyle === 'gradient-bar'
                ? { kind: 'gradient', from: `${accent}ee`, to: `${accent}88` }
                : { kind: 'solid', color: 'rgba(0, 0, 0, 0.75)' }

    // The DOM version draws this as a 6px left border on a 1080-tall output.
    const accentBar =
        barStyle === 'accent-bar'
            ? { x: margin, y: barY, width: Math.max(4, height * 0.0055), height: barHeight, color: accent }
            : null

    const position = style.lowerThirdPosition ?? 'left'
    const align: CanvasTextAlign = position === 'center' ? 'center' : position === 'right' ? 'right' : 'left'
    const padding = width * PADDING
    const textLeft = margin + padding + (accentBar ? accentBar.width : 0)
    const textRight = margin + barWidth - padding
    const textX = align === 'center' ? width / 2 : align === 'right' ? textRight : textLeft

    const title = runsToText(parseTextRuns(slide.contents?.[0] ?? ''))
    // An explicit subtitle wins; otherwise a scripture slide's reference becomes
    // it. Without this the canvas feed dropped "Psalms 9:2 · KJV" entirely, while
    // the DOM renderer showed it — and on a lower third the reference is the part
    // that makes the verse citable.
    const explicitSubtitle = plainTextFromHtml(style.lowerThirdSubtitle ?? '')
    const caption = isCaptionedSlideType(slide.type) ? plainTextFromHtml(slideCaptionHtml(slide)) : ''
    const subtitle = explicitSubtitle || caption

    const isReference = !explicitSubtitle && !!caption
    // Per-slide beats global, the same order the editor and the DOM renderer use.
    const refColor = style.verseRefColor ?? options.verseRef?.color
    const refBold = style.verseRefBold ?? options.verseRef?.bold ?? false
    const refItalic = style.verseRefItalic ?? options.verseRef?.italic ?? false
    const refSizePercent = style.verseRefSizePercent ?? options.verseRef?.sizePercent

    const titleFontPx = barHeight * (subtitle ? 0.42 : 0.5)
    const subtitleFontPx = barHeight * 0.26
    // Vertically centre the block inside the bar.
    const blockHeight = titleFontPx + (subtitle ? subtitleFontPx * 1.6 : 0)
    const titleY = barY + (barHeight - blockHeight) / 2 + titleFontPx / 2

    return {
        bar: { x: margin, y: barY, width: barWidth, height: barHeight },
        fill,
        accentBar,
        title: {
            text: title,
            x: textX,
            y: titleY,
            fontPx: titleFontPx,
            align,
            color: options.textColor ?? '#ffffff',
        },
        subtitle: subtitle
            ? {
                text: subtitle,
                x: textX,
                y: titleY + titleFontPx * 0.9 + subtitleFontPx * 0.6,
                fontPx: subtitleFontPx,
                align,
                color: (isReference ? refColor : undefined)
                    ?? options.textColor
                    ?? 'rgba(255,255,255,0.85)',
                isReference,
                bold: isReference && refBold,
                italic: isReference && refItalic,
                sizePercent: isReference ? refSizePercent : undefined,
            }
            : null,
        fontFamily: style.font || options.defaultFont || 'Inter, system-ui, sans-serif',
        outlined: !!style.textOutlined,
    }
}

/** Clears the frame to fully transparent and draws the lower third onto it. */
export function renderLowerThird(
    ctx: Canvas2DLike,
    slide: Slide,
    options: LowerThirdRenderOptions,
): LowerThirdLayout {
    const layout = layoutLowerThird(slide, options)

    // Transparent, not black: everything not drawn must key out.
    ctx.clearRect(0, 0, options.width, options.height)
    ctx.save()

    if (layout.fill) {
        if (layout.fill.kind === 'gradient') {
            const gradient = ctx.createLinearGradient(
                layout.bar.x,
                layout.bar.y,
                layout.bar.x + layout.bar.width,
                layout.bar.y + layout.bar.height,
            )
            gradient.addColorStop(0, layout.fill.from)
            gradient.addColorStop(1, layout.fill.to)
            ctx.fillStyle = gradient as unknown as string
        } else {
            ctx.fillStyle = layout.fill.color
        }
        ctx.fillRect(layout.bar.x, layout.bar.y, layout.bar.width, layout.bar.height)
    }

    if (layout.accentBar) {
        ctx.fillStyle = layout.accentBar.color
        ctx.fillRect(layout.accentBar.x, layout.accentBar.y, layout.accentBar.width, layout.accentBar.height)
    }

    // Text width available inside the bar, so a long name wraps or shrinks
    // instead of running past the edge.
    const textWidth = layout.bar.width - (options.width * PADDING) * 2 - (layout.accentBar?.width ?? 0)

    const titleRuns = parseTextRuns(slide.contents?.[0] ?? '')

    // Both blocks are measured before either is drawn, so the pair can be
    // centred in the bar as a unit. Positioning the reference from a
    // precomputed single-line body left a gap under a wrapped verse and pushed
    // the pair off centre.
    const bodyFit = titleRuns.length > 0
        ? fitRuns(ctx, titleRuns, {
            fontPx: layout.title.fontPx,
            fontFamily: layout.fontFamily,
            weight: '700',
            maxWidth: textWidth,
            // Two lines with a reference, three without. One line forced a whole
            // verse to shrink until it was unreadable.
            maxLines: layout.subtitle ? 2 : 3,
            maxHeight: layout.bar.height * (layout.subtitle ? 0.62 : 0.86),
            lineHeightRatio: BODY_LINE_HEIGHT,
            minFontPx: layout.bar.height * 0.12,
        })
        : null

    const bodyFontPx = bodyFit?.fontPx ?? layout.title.fontPx
    const bodyLineHeight = bodyFontPx * BODY_LINE_HEIGHT
    const bodyHeight = (bodyFit?.lines.length ?? 0) * bodyLineHeight

    let subtitleFit: ReturnType<typeof fitRuns> | null = null
    if (layout.subtitle) {
        // The reference is sized from the body's *fitted* size, not from the bar,
        // so the size setting means the same thing here as on a full slide: 100%
        // is a proper citation, and no percentage can outgrow the verse.
        const requested = layout.subtitle.isReference && layout.subtitle.sizePercent
            ? bodyFontPx * REFERENCE_RATIO * (layout.subtitle.sizePercent / 100)
            : bodyFontPx * REFERENCE_RATIO
        const subtitlePx = Math.min(requested, bodyFontPx * REFERENCE_MAX_RATIO)

        subtitleFit = fitRuns(ctx, [{
            text: layout.subtitle.text,
            bold: layout.subtitle.bold,
            italic: layout.subtitle.italic,
            color: null,
        }], {
            fontPx: subtitlePx,
            fontFamily: layout.fontFamily,
            weight: layout.subtitle.bold ? '700' : '400',
            maxWidth: textWidth,
            maxLines: 1,
        })
    }

    // Gap proportional to the type, not to the bar, so it holds at any size.
    const gap = subtitleFit ? subtitleFit.fontPx * REFERENCE_GAP : 0
    const blockHeight = bodyHeight + gap + (subtitleFit?.fontPx ?? 0)
    const blockTop = layout.bar.y + (layout.bar.height - blockHeight) / 2

    if (bodyFit) {
        drawRunLines(ctx, bodyFit.lines, {
            fontPx: bodyFontPx,
            fontFamily: layout.fontFamily,
            weight: '700',
            align: layout.title.align,
            x: layout.title.x,
            firstBaselineY: blockTop + bodyLineHeight / 2,
            lineHeight: bodyLineHeight,
            color: layout.title.color,
            outlined: layout.outlined,
        })
    }

    if (layout.subtitle && subtitleFit) {
        drawRunLines(ctx, subtitleFit.lines, {
            fontPx: subtitleFit.fontPx,
            fontFamily: layout.fontFamily,
            weight: layout.subtitle.bold ? '700' : '400',
            align: layout.subtitle.align,
            x: layout.subtitle.x,
            firstBaselineY: blockTop + bodyHeight + gap + subtitleFit.fontPx / 2,
            lineHeight: subtitleFit.fontPx * 1.2,
            color: layout.subtitle.color,
            outlined: layout.outlined,
        })
    }

    ctx.restore()
    return layout
}
