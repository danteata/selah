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
import { fontForRun, parseTextRuns, runsToText, type TextRun } from './textRuns'

/** The subset of CanvasRenderingContext2D this renderer uses, so the geometry can
 *  be tested without a real canvas (happy-dom provides no 2D context). */
export interface Canvas2DLike {
    canvas: { width: number; height: number }
    save(): void
    restore(): void
    clearRect(x: number, y: number, w: number, h: number): void
    fillRect(x: number, y: number, w: number, h: number): void
    fillText(text: string, x: number, y: number): void
    strokeText(text: string, x: number, y: number): void
    measureText(text: string): { width: number }
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): {
        addColorStop(offset: number, color: string): void
    }
    fillStyle: string | object
    strokeStyle: string | object
    lineWidth: number
    font: string
    textAlign: CanvasTextAlign
    textBaseline: CanvasTextBaseline
}

export interface LowerThirdRenderOptions {
    /** Frame size — the NDI feed's resolution, typically 1920×1080. */
    width: number
    height: number
    /** Fallback font family when the slide doesn't set one. */
    defaultFont?: string
    /** Text colour. SlideStyle carries no colour field — in the DOM renderer it
     *  comes from the TipTap markup, which plain text can't preserve. */
    textColor?: string
}

/** Fraction of the frame height the bar occupies, and its inset from the bottom. */
const BAR_HEIGHT = 0.18
const BAR_BOTTOM_INSET = 0.08
const SIDE_MARGIN = 0.06
const PADDING = 0.025

const DEFAULT_ACCENT = '#0d9488'

/** Everything needed to draw, resolved from the slide once so it can be asserted
 *  in tests without a canvas. */
export interface LowerThirdLayout {
    bar: { x: number; y: number; width: number; height: number }
    /** null for the minimalist style, which draws no bar at all. */
    fill: { kind: 'solid'; color: string } | { kind: 'gradient'; from: string; to: string } | null
    accentBar: { x: number; y: number; width: number; height: number; color: string } | null
    title: { text: string; x: number; y: number; fontPx: number; align: CanvasTextAlign; color: string }
    subtitle: { text: string; x: number; y: number; fontPx: number; align: CanvasTextAlign; color: string } | null
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
    const subtitle = plainTextFromHtml(style.lowerThirdSubtitle ?? '')

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
                color: options.textColor ?? 'rgba(255,255,255,0.85)',
            }
            : null,
        fontFamily: style.font || options.defaultFont || 'Inter, system-ui, sans-serif',
        outlined: !!style.textOutlined,
    }
}

/** One laid-out line: its runs and the total width, for alignment. */
interface RunLine {
    runs: TextRun[]
    width: number
}

function measureRun(ctx: Canvas2DLike, run: TextRun, fontPx: number, fontFamily: string, weight: string): number {
    ctx.font = fontForRun(run, fontPx, fontFamily, weight)
    return ctx.measureText(run.text).width
}

/** Greedy word wrap across runs, so a bold word can sit mid-sentence. */
export function wrapRuns(
    ctx: Canvas2DLike,
    runs: TextRun[],
    options: { fontPx: number; fontFamily: string; weight: string; maxWidth: number },
): RunLine[] {
    const lines: RunLine[] = []
    let current: RunLine = { runs: [], width: 0 }

    for (const run of runs) {
        // Keep the spaces: they are what separates words across a style change.
        const words = run.text.split(/(\s+)/).filter((word) => word.length > 0)
        for (const word of words) {
            const piece: TextRun = { ...run, text: word }
            const width = measureRun(ctx, piece, options.fontPx, options.fontFamily, options.weight)

            if (current.width + width > options.maxWidth && current.runs.length > 0 && word.trim()) {
                lines.push(current)
                current = { runs: [], width: 0 }
            }
            // A wrapped line never starts with the space that caused the break.
            if (!word.trim() && current.runs.length === 0) continue

            const previous = current.runs[current.runs.length - 1]
            if (previous && previous.bold === piece.bold && previous.italic === piece.italic && previous.color === piece.color) {
                previous.text += piece.text
            } else {
                current.runs.push(piece)
            }
            current.width += width
        }
    }

    if (current.runs.length > 0) lines.push(current)
    return lines
}

/**
 * Shrink until the text fits the bar. A long name would otherwise overflow the
 * bar or be clipped, which on a broadcast graphic reads as a bug.
 */
function fitRuns(
    ctx: Canvas2DLike,
    runs: TextRun[],
    options: { fontPx: number; fontFamily: string; weight: string; maxWidth: number; maxLines: number },
): { lines: RunLine[]; fontPx: number } {
    let fontPx = options.fontPx
    for (let attempt = 0; attempt < 8; attempt++) {
        const lines = wrapRuns(ctx, runs, { ...options, fontPx })
        if (lines.length <= options.maxLines) return { lines, fontPx }
        fontPx *= 0.88
    }
    return { lines: wrapRuns(ctx, runs, { ...options, fontPx }), fontPx }
}

function drawLines(
    ctx: Canvas2DLike,
    lines: RunLine[],
    options: {
        fontPx: number
        fontFamily: string
        weight: string
        align: CanvasTextAlign
        x: number
        firstBaselineY: number
        lineHeight: number
        color: string
        outlined: boolean
    },
) {
    // Runs are drawn one after another, so the alignment is applied to the line
    // as a whole and each run advances the pen.
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    lines.forEach((line, index) => {
        const y = options.firstBaselineY + index * options.lineHeight
        let x = options.align === 'center'
            ? options.x - line.width / 2
            : options.align === 'right'
                ? options.x - line.width
                : options.x

        for (const run of line.runs) {
            ctx.font = fontForRun(run, options.fontPx, options.fontFamily, options.weight)
            if (options.outlined) {
                ctx.lineWidth = Math.max(2, options.fontPx * 0.06)
                ctx.strokeStyle = 'rgba(0,0,0,0.85)'
                ctx.strokeText(run.text, x, y)
            }
            ctx.fillStyle = run.color ?? options.color
            ctx.fillText(run.text, x, y)
            x += ctx.measureText(run.text).width
        }
    })
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
    if (titleRuns.length > 0) {
        const { lines, fontPx } = fitRuns(ctx, titleRuns, {
            fontPx: layout.title.fontPx,
            fontFamily: layout.fontFamily,
            weight: '700',
            maxWidth: textWidth,
            maxLines: layout.subtitle ? 1 : 2,
        })
        drawLines(ctx, lines, {
            fontPx,
            fontFamily: layout.fontFamily,
            weight: '700',
            align: layout.title.align,
            x: layout.title.x,
            firstBaselineY: layout.title.y - (lines.length - 1) * fontPx * 0.6,
            lineHeight: fontPx * 1.2,
            color: layout.title.color,
            outlined: layout.outlined,
        })
    }

    if (layout.subtitle) {
        // The subtitle is a plain settings field, not editor markup, so it is a
        // single unstyled run.
        const subtitleRuns: TextRun[] = [{ text: layout.subtitle.text, bold: false, italic: false, color: null }]
        const { lines, fontPx } = fitRuns(ctx, subtitleRuns, {
            fontPx: layout.subtitle.fontPx,
            fontFamily: layout.fontFamily,
            weight: '400',
            maxWidth: textWidth,
            maxLines: 1,
        })
        drawLines(ctx, lines, {
            fontPx,
            fontFamily: layout.fontFamily,
            weight: '400',
            align: layout.subtitle.align,
            x: layout.subtitle.x,
            firstBaselineY: layout.subtitle.y,
            lineHeight: fontPx * 1.2,
            color: layout.subtitle.color,
            outlined: layout.outlined,
        })
    }

    ctx.restore()
    return layout
}
