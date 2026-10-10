/**
 * A canvas-rendered output feed with its own frame clock: what the alternate
 * output draws when it goes out over NDI.
 *
 * Frames are drawn only when something changed or is moving — a new slide, a
 * crossfade in progress, a motion background, a running countdown. A still
 * picture is drawn once; the NDI channel repeats it at the output's rate (see
 * `push.rs`). The design follows filmcraft's playback loop (MIT OR Apache-2.0,
 * ArtCraft Team and the FilmCraft contributors): the clock decides which frame
 * is due from wall time, and a frame that can't go out because the previous
 * one is still being sent is skipped rather than queued.
 */

import type { Slide } from '../../types'
import { renderSlideToCanvas, type SlideRenderOptions } from '../../lib/graphics/renderSlide'
import { backdropAnimates, backdropFor, BackdropImages, BackdropVideos, type Backdrop, type MotionStates } from '../../lib/graphics/renderBackdrop'
import { isCountdownPaused } from '../../utils/countdown'

export interface FeedScene {
    slide: Slide | null
    /** Frame size and styling; the feed adds the backdrop and the clock. */
    options: SlideRenderOptions
    /** The slide's resolved background URL (useSlideBackgroundUrl). */
    backgroundUrl: string | null
    /** Crossfade length between slides; 0 cuts. */
    transitionSeconds: number
}

/** Progress 0..1 through a crossfade that started at `start`. */
export function fadeProgress(now: number, start: number, seconds: number): number {
    if (seconds <= 0) return 1
    return Math.min(1, Math.max(0, (now - start) / (seconds * 1000)))
}

/** Whether the picture changes on its own from frame to frame. */
export function sceneAnimates(slide: Slide | null, backdrop: Backdrop | null): boolean {
    if (!slide) return false
    if (slide.type === 'countdown' && !isCountdownPaused(slide)) return true
    return !!backdrop && backdropAnimates(backdrop)
}

type Push = (canvas: HTMLCanvasElement) => Promise<boolean>

export class CanvasFeed {
    private scene: FeedScene | null = null
    private backdrop: Backdrop | null = null
    private frame: HTMLCanvasElement | null = null
    private next: HTMLCanvasElement | null = null
    private fadeFrom: HTMLCanvasElement | null = null
    private fadeStart = 0
    private dirty = true
    private readonly clockStart = typeof performance !== 'undefined' ? performance.now() : 0
    private readonly images = new BackdropImages(() => { this.dirty = true })
    private readonly videos = new BackdropVideos()
    private readonly motionStates: MotionStates = new Map()
    private readonly firstShown = new Map<string, number>()
    private worker: Worker | null = null
    private interval: ReturnType<typeof setInterval> | null = null
    private readonly push: Push

    constructor(push: Push) {
        this.push = push
    }

    /** What to show. A different slide starts a crossfade from the current frame. */
    setScene(scene: FeedScene): void {
        const previous = this.scene
        const changedSlide = (previous?.slide?.id ?? null) !== (scene.slide?.id ?? null)
        if (changedSlide && previous && this.frame && scene.transitionSeconds > 0) {
            this.fadeFrom = copyCanvas(this.frame, this.fadeFrom)
            this.fadeStart = performance.now()
        } else if (changedSlide) {
            this.fadeFrom = null
        }
        if (scene.slide && !this.firstShown.has(scene.slide.id)) this.firstShown.set(scene.slide.id, Date.now())
        this.scene = scene
        // A keyed feed draws no backdrop, but a media slide's photo or video is
        // the content itself, so it is drawn either way.
        const opaque = !!scene.options.opaqueBackground
        this.backdrop = scene.slide && (opaque || scene.slide.type === 'media')
            ? backdropFor(scene.slide, scene.backgroundUrl)
            : null
        if (this.backdrop?.kind !== 'video') this.videos.release()
        this.dirty = true
    }

    /** Redraw on the next tick (a font finished loading, say). */
    invalidate(): void {
        this.dirty = true
    }

    /** Start ticking at `fps`. Calling again changes the rate. */
    start(fps: number): void {
        this.stop()
        const tick = () => { void this.tick(performance.now()) }
        if (typeof Worker !== 'undefined') {
            try {
                this.worker = new Worker(new URL('./feedClock.worker.ts', import.meta.url), { type: 'module' })
                this.worker.onmessage = tick
                this.worker.postMessage({ fps })
                return
            } catch {
                this.worker = null
            }
        }
        this.interval = setInterval(tick, 1000 / fps)
    }

    stop(): void {
        this.videos.release()
        this.worker?.postMessage({ fps: 0 })
        this.worker?.terminate()
        this.worker = null
        if (this.interval !== null) clearInterval(this.interval)
        this.interval = null
    }

    /** Draw the current picture into `target` — the in-app preview. */
    paintInto(target: HTMLCanvasElement): void {
        this.draw(target, performance.now())
    }

    /** One tick: draw and push a frame if one is due. */
    async tick(now: number): Promise<void> {
        const scene = this.scene
        if (!scene) return
        const fading = !!this.fadeFrom && fadeProgress(now, this.fadeStart, scene.transitionSeconds) < 1
        if (!this.dirty && !fading && !sceneAnimates(scene.slide, this.backdrop)) return
        const { width, height } = scene.options
        this.frame = sized(this.frame, width, height)
        this.draw(this.frame, now)
        if (!fading) this.fadeFrom = null
        this.dirty = false
        // Busy with the previous frame: skip this one, and draw again next tick.
        if (!(await this.push(this.frame))) this.dirty = true
    }

    private draw(target: HTMLCanvasElement, now: number): void {
        const scene = this.scene
        const ctx = target.getContext('2d', { willReadFrequently: true })
        if (!scene || !ctx) return
        const options: SlideRenderOptions = {
            ...scene.options,
            width: target.width,
            height: target.height,
            backdrop: this.backdrop ?? undefined,
            timeSec: (now - this.clockStart) / 1000,
            images: this.images,
            videos: this.videos,
            motionStates: this.motionStates,
            nowMs: Date.now(),
            countdownStartedAt: scene.slide ? this.firstShown.get(scene.slide.id) : undefined,
        }
        const t = this.fadeFrom ? fadeProgress(now, this.fadeStart, scene.transitionSeconds) : 1
        if (t >= 1 || !this.fadeFrom) {
            renderSlideToCanvas(ctx, scene.slide, options)
            return
        }
        // Crossfade: the frame we left, fading out under the new one fading in.
        this.next = sized(this.next, target.width, target.height)
        const nextCtx = this.next.getContext('2d')
        if (!nextCtx) return
        renderSlideToCanvas(nextCtx, scene.slide, options)
        ctx.clearRect(0, 0, target.width, target.height)
        ctx.globalAlpha = 1 - t
        ctx.drawImage(this.fadeFrom, 0, 0, target.width, target.height)
        ctx.globalAlpha = t
        ctx.drawImage(this.next, 0, 0)
        ctx.globalAlpha = 1
    }
}

function sized(canvas: HTMLCanvasElement | null, width: number, height: number): HTMLCanvasElement {
    const c = canvas ?? document.createElement('canvas')
    if (c.width !== width) c.width = width
    if (c.height !== height) c.height = height
    return c
}

function copyCanvas(source: HTMLCanvasElement, into: HTMLCanvasElement | null): HTMLCanvasElement {
    const copy = sized(into, source.width, source.height)
    const ctx = copy.getContext('2d')
    if (ctx) {
        ctx.clearRect(0, 0, copy.width, copy.height)
        ctx.drawImage(source, 0, 0)
    }
    return copy
}
