/**
 * Draws a slide onto a canvas for the alternate output.
 *
 * The alternate output is generic — it carries whatever slide it is given — but
 * the canvas path draws text: lyrics, scripture, announcements and lower thirds,
 * which is most of what an alternate feed shows. Image and video backgrounds are
 * NOT drawn; a slide with one still goes out as its text, and
 * `canRenderOnCanvas` reports the difference so the UI can say "text only"
 * rather than leaving the operator to wonder. Carrying backgrounds needs the
 * window path (a real `LiveView` rendering the DOM).
 *
 * Everything drawn here starts from a transparent frame, so an output with its
 * alpha channel enabled keys cleanly over video.
 */

import type { Slide } from '../../types'
import { isLowerThird } from '../../utils/lowerThird'
import { renderLowerThird, type LowerThirdRenderOptions } from './renderLowerThird'
import type { Canvas2DLike } from './renderRuns'
import { drawRunLines, fitRuns } from './renderRuns'
import { parseTextRuns } from './textRuns'
import { isCaptionedSlideType, slideCaptionHtml } from '../../utils/slideCaption'

export interface SlideRenderOptions extends LowerThirdRenderOptions {
    /** Paint a background behind the text. Off for a keyed feed, on for a feed
     *  that has to look like the projector. */
    opaqueBackground?: boolean
}

/** Fraction of the frame reserved as a margin around body text. */
const TEXT_MARGIN = 0.08
const CAPTION_GAP = 0.03

/**
 * Whether the canvas path can draw this slide *in full*. False means the text
 * will be drawn but its background won't — see the module comment.
 */
export function canRenderOnCanvas(slide: Slide | null): boolean {
    if (!slide) return true
    if (slide.type === 'media') return false
    return !slide.background
}

/** Centred body text with an optional caption — the ordinary slide look. */
export function renderTextSlide(ctx: Canvas2DLike, slide: Slide, options: SlideRenderOptions) {
    const { width, height } = options

    ctx.clearRect(0, 0, width, height)
    ctx.save()

    if (options.opaqueBackground) {
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, width, height)
    }

    const fontFamily = slide.slideStyle?.font || options.defaultFont || 'Inter, system-ui, sans-serif'
    const color = options.textColor ?? '#ffffff'
    const maxWidth = width * (1 - TEXT_MARGIN * 2)

    const bodyRuns = parseTextRuns(slide.contents?.[0] ?? '')
    const captionRuns = isCaptionedSlideType(slide.type) ? parseTextRuns(slideCaptionHtml(slide)) : []

    if (bodyRuns.length > 0) {
        const startPx = slide.slideStyle?.fontSize ? slide.slideStyle.fontSize * (height / 1080) : height * 0.09
        const { lines, fontPx } = fitRuns(ctx, bodyRuns, {
            fontPx: startPx,
            fontFamily,
            weight: '600',
            maxWidth,
            // Leave room for a caption when there is one.
            maxLines: captionRuns.length > 0 ? 5 : 6,
        })

        const lineHeight = fontPx * 1.25
        const blockHeight = lines.length * lineHeight
        const captionHeight = captionRuns.length > 0 ? height * CAPTION_GAP + fontPx * 0.55 : 0
        const firstY = (height - blockHeight - captionHeight) / 2 + lineHeight / 2

        drawRunLines(ctx, lines, {
            fontPx,
            fontFamily,
            weight: '600',
            align: 'center',
            x: width / 2,
            firstBaselineY: firstY,
            lineHeight,
            color,
            outlined: !!slide.slideStyle?.textOutlined,
        })

        if (captionRuns.length > 0) {
            const captionPx = fontPx * 0.5
            const { lines: captionLines } = fitRuns(ctx, captionRuns, {
                fontPx: captionPx,
                fontFamily,
                weight: '400',
                maxWidth,
                maxLines: 1,
            })
            drawRunLines(ctx, captionLines, {
                fontPx: captionPx,
                fontFamily,
                weight: '400',
                align: 'center',
                x: width / 2,
                firstBaselineY: firstY + blockHeight + height * CAPTION_GAP,
                lineHeight: captionPx * 1.2,
                color,
                outlined: !!slide.slideStyle?.textOutlined,
            })
        }
    }

    ctx.restore()
}

/** Draw whatever the alternate output has been given. */
export function renderSlideToCanvas(ctx: Canvas2DLike, slide: Slide | null, options: SlideRenderOptions) {
    if (!slide) {
        // Nothing on the output: a transparent frame, so a switcher sees the
        // graphic leave rather than the feed freeze on the last one.
        ctx.clearRect(0, 0, options.width, options.height)
        return
    }

    if (isLowerThird(slide)) {
        renderLowerThird(ctx, slide, options)
        return
    }

    renderTextSlide(ctx, slide, options)
}
