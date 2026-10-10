/**
 * What a canvas feed paints behind a slide's text: the same backdrop the
 * projector shows — a colour, a CSS gradient, an image or a motion background
 * — dimmed and blurred by the slide's own settings.
 *
 * A media slide (a photo or video shown as the content itself) is drawn the
 * same way, fitted as the slide asks and without the dimming. Only external
 * players (YouTube, Vimeo) can't be drawn: they live in an iframe.
 */

import type { Slide } from '../../types'
import { motionBackgroundFor, motionSeed, seededRandom, type MotionBackground } from '../../components/motion/motionBackgrounds'
import { slideBackgroundFilter } from '../../utils/slideBackground'
import { getObjectFit } from '../../utils/mediaFit'
import { parseCssGradient, paintCssGradient, type CssGradient } from './cssGradient'

export type Backdrop =
    | { kind: 'none' }
    | { kind: 'color'; color: string }
    | { kind: 'gradient'; gradient: CssGradient }
    | { kind: 'image'; url: string; fit: Fit; media: boolean }
    | { kind: 'video'; url: string; fit: Fit; media: boolean }
    | { kind: 'motion'; motion: MotionBackground }
    /** Something the canvas can't draw (an external player); the feed carries text only. */
    | { kind: 'unsupported' }

export type Fit = 'cover' | 'contain' | 'fill'

/** Where a slide's backdrop comes from, given its resolved background URL. */
export function backdropFor(slide: Slide, backgroundUrl: string | null): Backdrop {
    const motion = motionBackgroundFor(slide.background)
    if (motion) return { kind: 'motion', motion }
    const media = slide.type === 'media'
    if (slide.backgroundType === 'external') return { kind: 'unsupported' }
    const source = backgroundUrl || slide.background || ''
    if (!source) return { kind: 'none' }
    // Media fills as the slide says; a backdrop behind text always covers.
    const fit: Fit = media ? getObjectFit(slide.slideStyle?.backgroundFillType) : 'cover'
    if (slide.backgroundType === 'video') return { kind: 'video', url: source, fit, media }
    const gradient = parseCssGradient(source)
    if (gradient) return { kind: 'gradient', gradient }
    if (/^(#|rgb|hsl)/i.test(source)) return { kind: 'color', color: source }
    if (/-gradient\(/i.test(source)) return { kind: 'unsupported' }
    return { kind: 'image', url: source, fit, media }
}

/** Whether drawing this backdrop changes from frame to frame. */
export function backdropAnimates(backdrop: Backdrop): boolean {
    return backdrop.kind === 'motion' || backdrop.kind === 'video'
}

/**
 * Media is loaded with CORS, so a canvas that draws it can still be read back
 * (getImageData). A file served without CORS headers then fails to load —
 * a black backdrop — rather than tainting the canvas and breaking every frame.
 */
function corsSafe(el: HTMLImageElement | HTMLVideoElement, url: string) {
    if (!url.startsWith('data:')) el.crossOrigin = 'anonymous'
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
        corsSafe(img, url)
        img.onload = () => {
            this.images.set(url, img)
            this.onLoad()
        }
        img.onerror = () => this.images.set(url, 'failed')
        img.src = url
        return null
    }
}

/** How a media slide's video should be playing (from its synced slideStyle). */
export interface VideoPlayback {
    playing: boolean
    loop: boolean
    /** A seek command: the position, and a token that changes with each command. */
    seek?: { position: number; token: number }
}

/**
 * The feed's video element: one at a time, for the slide on air. Background
 * videos play muted on a loop; a media slide's follows the operator's play,
 * pause, seek and loop, as `MediaContent` does on the projector. The feed has
 * no sound, so every video is muted.
 */
export class BackdropVideos {
    private video: HTMLVideoElement | null = null
    private url: string | null = null
    private lastSeek: number | undefined

    get(url: string, playback: VideoPlayback): HTMLVideoElement | null {
        if (typeof document === 'undefined') return null
        if (this.url !== url) {
            this.release()
            const video = document.createElement('video')
            corsSafe(video, url)
            video.muted = true
            video.playsInline = true
            video.preload = 'auto'
            video.src = url
            this.video = video
            this.url = url
        }
        const video = this.video
        if (!video) return null
        video.loop = playback.loop
        if (playback.seek && playback.seek.token !== this.lastSeek) {
            this.lastSeek = playback.seek.token
            video.currentTime = playback.seek.position
        }
        if (playback.playing && video.paused) video.play().catch(() => {})
        if (!playback.playing && !video.paused) video.pause()
        // HAVE_CURRENT_DATA: there is a frame to draw.
        return video.readyState >= 2 ? video : null
    }

    release(): void {
        if (this.video) {
            this.video.pause()
            this.video.removeAttribute('src')
            this.video.load()
        }
        this.video = null
        this.url = null
        this.lastSeek = undefined
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
    frame: {
        width: number
        height: number
        timeSec: number
        images?: BackdropImages
        videos?: BackdropVideos
        motionStates?: MotionStates
    },
): void {
    const { width, height } = frame
    ctx.save()
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)

    // The projector dims (and may blur) every backdrop by the slide's settings.
    // Not every canvas supports `filter` (older WebKit); there it's skipped.
    // Media shown as the content itself isn't dimmed, as on the projector.
    const dims = backdrop.kind !== 'none' && backdrop.kind !== 'unsupported'
        && !((backdrop.kind === 'image' || backdrop.kind === 'video') && backdrop.media)
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
            if (img) drawFitted(ctx, img, img.naturalWidth, img.naturalHeight, backdrop.fit, width, height)
            break
        }
        case 'video': {
            const style = slide.slideStyle
            const seekPosition = style?.mediaSeekPosition
            const playback: VideoPlayback = backdrop.media
                ? {
                    playing: style?.isMediaPlaying ?? true,
                    loop: style?.repeatMedia ?? false,
                    seek: seekPosition === undefined ? undefined : { position: seekPosition, token: style?.mediaSeekNonce ?? seekPosition },
                }
                : { playing: true, loop: true }
            const video = frame.videos?.get(backdrop.url, playback)
            if (video) drawFitted(ctx, video, video.videoWidth, video.videoHeight, backdrop.fit, width, height)
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

/** Draw `source` into the frame as CSS `object-fit` would, centred. */
function drawFitted(ctx: BackdropContext, source: CanvasImageSource, sw: number, sh: number, fit: Fit, width: number, height: number) {
    if (!ctx.drawImage || sw <= 0 || sh <= 0) return
    if (fit === 'fill') {
        ctx.drawImage(source, 0, 0, width, height)
        return
    }
    const scale = fit === 'cover' ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh)
    const w = sw * scale
    const h = sh * scale
    ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h)
}
