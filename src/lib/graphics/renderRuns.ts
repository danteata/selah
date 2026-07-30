/**
 * Shared run layout for the canvas renderers: measuring, wrapping and drawing
 * styled text runs.
 *
 * Both the lower third and the ordinary-slide renderer need the same behaviour —
 * wrap across style changes, shrink until it fits, draw run by run advancing the
 * pen — so it lives here rather than being written twice and drifting.
 */

import { fontForRun, type TextRun } from './textRuns'

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
export function fitRuns(
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

export function drawRunLines(
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
