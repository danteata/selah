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
    /** Draw as a lower third whatever the slide's own layout says — an output
     *  setting, so one slide can be a full slide on the projector and a bar on
     *  the stream. */
    forceLowerThird?: boolean
}

/** Fraction of the frame reserved as a margin around body text. */
const TEXT_MARGIN = 0.08
const CAPTION_GAP = 0.03

/**
 * Body text size bounds, as a fraction of frame height. These mirror
 * AutoFitText's minPx 18 / maxPx 160 at 1080p, so the alternate output fills its
 * frame the way the projector does — and scales with the output format.
 *
 * The slide's own `fontSize` is deliberately NOT used as the starting size: the
 * DOM renderer doesn't either (it auto-fits between these bounds), and treating
 * that value as pixels here produced text a few pixels tall.
 */
const BODY_MAX_FRACTION = 160 / 1080
const BODY_MIN_FRACTION = 18 / 1080
/** Share of the frame height the body may occupy before it has to shrink. */
const BODY_HEIGHT_FRACTION = 0.74

/**
 * Whether the canvas path can draw this slide *in full*. False means the text
 * will be drawn but its background won't — see the module comment.
 *
 * A lower third is always full: its renderer draws a bar over a transparent
 * frame and never uses the slide background at all. That matters because
 * applying any template sets a background (`applyTemplateToSlide`), so a slide
 * made from a lower-third template carries one it will never show — and warning
 * "text only" about it would be noise in exactly the workflow lower thirds are
 * for.
 */
export function canRenderOnCanvas(slide: Slide | null): boolean {
    if (!slide) return true
    if (isLowerThird(slide)) return true
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
        const { lines, fontPx } = fitRuns(ctx, bodyRuns, {
            // Start at the maximum and shrink: that is what makes short text big.
            fontPx: height * BODY_MAX_FRACTION,
            fontFamily,
            weight: '600',
            maxWidth,
            maxLines: 12,
            maxHeight: height * (captionRuns.length > 0 ? BODY_HEIGHT_FRACTION - 0.08 : BODY_HEIGHT_FRACTION),
            lineHeightRatio: 1.25,
            minFontPx: height * BODY_MIN_FRACTION,
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
            // The reference takes the operator's styling: per-slide first, then
            // the global setting — the order the editor and DOM renderer use.
            const refColor = slide.slideStyle?.verseRefColor ?? options.verseRef?.color
            const refBold = slide.slideStyle?.verseRefBold ?? options.verseRef?.bold ?? false
            const refItalic = slide.slideStyle?.verseRefItalic ?? options.verseRef?.italic ?? false
            const refSizePercent = slide.slideStyle?.verseRefSizePercent ?? options.verseRef?.sizePercent
            const captionPx = fontPx * 0.5 * (refSizePercent ? refSizePercent / 100 : 1)
            const captionWeight = refBold ? '700' : '400'
            const styledCaption = captionRuns.map((run) => ({ ...run, italic: run.italic || refItalic }))
            const { lines: captionLines } = fitRuns(ctx, styledCaption, {
                fontPx: captionPx,
                fontFamily,
                weight: captionWeight,
                maxWidth,
                maxLines: 1,
            })
            drawRunLines(ctx, captionLines, {
                fontPx: captionPx,
                fontFamily,
                weight: captionWeight,
                align: 'center',
                x: width / 2,
                firstBaselineY: firstY + blockHeight + height * CAPTION_GAP,
                lineHeight: captionPx * 1.2,
                color: refColor ?? color,
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

    if (options.forceLowerThird || isLowerThird(slide)) {
        renderLowerThird(ctx, slide, options)
        return
    }

    renderTextSlide(ctx, slide, options)
}
