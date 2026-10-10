/**
 * What a canvas feed paints behind a slide's text: the same backdrop the
 * projector shows — a colour, a CSS gradient, an image or a motion background
 * — dimmed and blurred by the slide's own settings.
 *
 * Video isn't drawn here: decoding it for a canvas is a separate job, so a
 * video slide still goes out over its text alone and the feed says so.
 */

import type { Slide } from '../../types'
import { motionBackgroundFor, motionSeed, seededRandom, type MotionBackground } from '../../components/motion/motionBackgrounds'
import { slideBackgroundFilter } from '../../utils/slideBackground'
import { parseCssGradient, paintCssGradient, type CssGradient } from './cssGradient'

export type Backdrop =
    | { kind: 'none' }
    | { kind: 'color'; color: string }
    | { kind: 'gradient'; gradient: CssGradient }
    | { kind: 'image'; url: string }
    | { kind: 'motion'; motion: MotionBackground }
    /** Something the canvas can't draw (video); the feed carries text only. */
    | { kind: 'unsupported' }

/** Where a slide's backdrop comes from, given its resolved background URL. */
export function backdropFor(slide: Slide, backgroundUrl: string | null): Backdrop {
    const motion = motionBackgroundFor(slide.background)
    if (motion) return { kind: 'motion', motion }
    if (slide.type === 'media' || slide.backgroundType === 'video') return { kind: 'unsupported' }
    const source = backgroundUrl || slide.background || ''
    if (!source) return { kind: 'none' }
    const gradient = parseCssGradient(source)
    if (gradient) return { kind: 'gradient', gradient }
    if (/^(#|rgb|hsl)/i.test(source)) return { kind: 'color', color: source }
    if (/-gradient\(/i.test(source)) return { kind: 'unsupported' }
    return { kind: 'image', url: source }
}

/** Whether drawing this backdrop changes from frame to frame. */
export function backdropAnimates(backdrop: Backdrop): boolean {
    return backdrop.kind === 'motion'
}

/**
 * Decoded background images, by URL, so a feed redrawing every frame doesn't
 * decode them again. `onLoad` fires when one finishes, so the feed can redraw.
 */
export class BackdropImages {
    private images = new Map<string, HTMLImageElement | 'loading' | 'failed'>()
    private onLoad: () => void

    constructor(onLoad: () => void = () => {}) {
        this.onLoad = onLoad
    }

    /** The image, once decoded; null while it loads or if it can't. */
    get(url: string): HTMLImageElement | null {
        const entry = this.images.get(url)
        if (entry instanceof HTMLImageElement) return entry
        if (entry) return null
        if (typeof Image === 'undefined') return null
        this.images.set(url, 'loading')
        const img = new Image()
        // A canvas whose pixels are read back (getImageData) must not be
        // tainted, so remote images are fetched with CORS.
        if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous'
        img.onload = () => {
            this.images.set(url, img)
            this.onLoad()
        }
        img.onerror = () => this.images.set(url, 'failed')
        img.src = url
        return null
    }
}

interface BackdropContext {
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void }
    createRadialGradient?(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): { addColorStop(offset: number, color: string): void }
    fillStyle: string | object
    fillRect(x: number, y: number, w: number, h: number): void
    save(): void
    restore(): void
    filter?: string
    drawImage?(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
}

/** Per-feed state a motion background keeps between frames. */
export type MotionStates = Map<string, { width: number; height: number; state: unknown }>

/**
 * Paint `backdrop` over the whole frame, falling back to black for anything
 * not ready or not drawable. `timeSec` drives motion backgrounds.
 */
export function paintBackdrop(
    ctx: BackdropContext,
    slide: Slide,
    backdrop: Backdrop,
    frame: { width: number; height: number; timeSec: number; images?: BackdropImages; motionStates?: MotionStates },
): void {
    const { width, height } = frame
    ctx.save()
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)

    // The projector dims (and may blur) every backdrop by the slide's settings.
    // Not every canvas supports `filter` (older WebKit); there it's skipped.
    const dims = backdrop.kind !== 'none' && backdrop.kind !== 'unsupported'
    if (dims && 'filter' in ctx) ctx.filter = slideBackgroundFilter(slide)

    switch (backdrop.kind) {
        case 'color':
            ctx.fillStyle = backdrop.color
            ctx.fillRect(0, 0, width, height)
            break
        case 'gradient':
            paintCssGradient(ctx, backdrop.gradient, width, height)
            break
        case 'image': {
            const img = frame.images?.get(backdrop.url)
            if (img && ctx.drawImage) {
                // Cover, centred: what `bg-cover bg-center` does on the projector.
                const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
                const w = img.naturalWidth * scale
                const h = img.naturalHeight * scale
                ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h)
            }
            break
        }
        case 'motion': {
            const { motion } = backdrop
            const states = frame.motionStates
            let entry = states?.get(motion.id)
            if (!entry || entry.width !== width || entry.height !== height) {
                entry = { width, height, state: motion.scene.setup(width, height, seededRandom(motionSeed(motion.id))) }
                states?.set(motion.id, entry)
            }
            motion.scene.draw(ctx as unknown as CanvasRenderingContext2D, width, height, frame.timeSec, entry.state)
            break
        }
    }
    ctx.restore()
}
