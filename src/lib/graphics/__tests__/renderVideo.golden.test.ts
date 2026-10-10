import { describe, expect, it } from 'vitest'
import { expectGolden, goldenCanvas } from '../../../test/golden/golden'
import type { Slide } from '../../../types'
import { backdropFor, BackdropImages, BackdropVideos, paintBackdrop } from '../renderBackdrop'
import { renderSlideToCanvas } from '../renderSlide'

/** A short teal-and-amber WebM, recorded from a canvas in this browser. */
async function recordClip(): Promise<string> {
    const source = goldenCanvas(320, 180)
    const ctx = source.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    const stream = source.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    const done = new Promise<void>((r) => { recorder.onstop = () => r() })
    recorder.start()
    const started = performance.now()
    while (performance.now() - started < 600) {
        ctx.fillStyle = '#0d9488'
        ctx.fillRect(0, 0, 320, 180)
        ctx.fillStyle = '#f59e0b'
        ctx.fillRect(0, 0, 160, 180)
        await new Promise((r) => requestAnimationFrame(r))
    }
    recorder.stop()
    await done
    return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
}

async function frameOf(videos: BackdropVideos, url: string, slide: Slide): Promise<void> {
    // Poll until the element has a frame to draw.
    for (let i = 0; i < 100; i++) {
        if (videos.get(url, { playing: true, loop: true })) return
        await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`video never became drawable (${slide.id})`)
}

describe('video on the canvas feed', () => {
    it('draws a media slide\'s video, fitted as the slide asks', async () => {
        const url = await recordClip()
        const slide = { id: 'v', type: 'media', layout: 'full_text', contents: [], background: url, backgroundType: 'video', slideStyle: { backgroundFillType: 'fit' } } as unknown as Slide
        const videos = new BackdropVideos()
        await frameOf(videos, url, slide)
        const canvas = goldenCanvas()
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        renderSlideToCanvas(ctx, slide, { width: 640, height: 360, backdrop: backdropFor(slide, url), videos, images: new BackdropImages() })
        // Contain-fit 16:9 into 16:9 fills the frame: amber on the left, teal on the right.
        const [r1, g1, b1] = ctx.getImageData(80, 180, 1, 1).data
        const [r2, g2, b2] = ctx.getImageData(560, 180, 1, 1).data
        expect(r1).toBeGreaterThan(200)
        expect(b1).toBeLessThan(80)
        expect(g2).toBeGreaterThan(120)
        expect(r2).toBeLessThan(60)
        expect(b2).toBeGreaterThan(100)
        expect(g1).toBeGreaterThan(100)
        videos.release()
    })

    it('dims a background video behind text, as the projector does', async () => {
        const url = await recordClip()
        const slide = { id: 'b', type: 'text', layout: 'full_text', contents: [], background: url, backgroundType: 'video', slideStyle: { brightness: 50 } } as unknown as Slide
        const videos = new BackdropVideos()
        await frameOf(videos, url, slide)
        const canvas = goldenCanvas(320, 180)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        paintBackdrop(ctx, slide, backdropFor(slide, url), { width: 320, height: 180, timeSec: 0, videos })
        const [r] = ctx.getImageData(40, 90, 1, 1).data
        // Amber's red channel at half brightness.
        expect(r).toBeGreaterThan(90)
        expect(r).toBeLessThan(150)
        await expectGolden('program-video-dimmed', canvas, 'render')
        videos.release()
    })
})
