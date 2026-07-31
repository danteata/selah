import { describe, it, expect } from 'vitest'
import { canRenderOnCanvas, renderSlideToCanvas, renderTextSlide } from '../renderSlide'
import type { Canvas2DLike } from '../renderRuns'
import type { Slide } from '../../../types'

const HD = { width: 1920, height: 1080 }

function slide(overrides: Partial<Slide> = {}): Slide {
    return {
        id: 's1',
        type: 'text',
        layout: 'full_text',
        contents: ['<p>For God so loved the world</p>'],
        slideStyle: {},
        ...overrides,
    } as unknown as Slide
}

function recorder() {
    const calls: string[] = []
    const state = { fillStyle: '' as string | object, font: '', textAlign: 'left' as CanvasTextAlign }
    const ctx: Canvas2DLike = {
        canvas: { width: HD.width, height: HD.height },
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        clearRect: (x, y, w, h) => calls.push(`clearRect(${x},${y},${w},${h})`),
        fillRect: (x, y, w, h) => calls.push(`fillRect(${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}) fill=${String(state.fillStyle)}`),
        fillText: (t, x, y) => calls.push(`fillText(${t}@${Math.round(x)},${Math.round(y)}) font=${state.font}`),
        strokeText: (t, x, y) => calls.push(`strokeText(${t}@${Math.round(x)},${Math.round(y)})`),
        measureText: (t) => {
            const px = Number(/(\d+)px/.exec(state.font)?.[1] ?? 16)
            return { width: t.length * px * 0.5 }
        },
        createLinearGradient: () => ({ addColorStop: () => {} }),
        get fillStyle() { return state.fillStyle },
        set fillStyle(v) { state.fillStyle = v },
        strokeStyle: '',
        lineWidth: 0,
        get font() { return state.font },
        set font(v) { state.font = v },
        get textAlign() { return state.textAlign },
        set textAlign(v) { state.textAlign = v },
        textBaseline: 'middle',
    }
    return { ctx, calls }
}

const drawnText = (calls: string[]) =>
    calls.filter((c) => c.startsWith('fillText')).map((c) => c.slice('fillText('.length).split('@')[0])

describe('canRenderOnCanvas', () => {
    it('is false for slides whose background can only come from the DOM', () => {
        expect(canRenderOnCanvas(slide())).toBe(true)
        expect(canRenderOnCanvas(slide({ background: 'photo.jpg' }))).toBe(false)
        expect(canRenderOnCanvas(slide({ type: 'media' }))).toBe(false)
        expect(canRenderOnCanvas(null)).toBe(true)
    })

    it('is true for a lower third even with a background set', () => {
        // Applying any template sets a background, so a slide built from a
        // lower-third template always has one — and the bar renderer never draws
        // it. Warning "text only" there would be noise in the main workflow.
        expect(canRenderOnCanvas(slide({ layout: 'lower-third', background: 'photo.jpg' }))).toBe(true)
        expect(canRenderOnCanvas(slide({ layout: 'lower_third', background: 'photo.jpg' }))).toBe(true)
    })
})

describe('renderSlideToCanvas', () => {
    it('still draws the text of a slide whose background it cannot draw', () => {
        // The bug this pins: blanking the frame instead meant "Follow main output"
        // sent black for any slide with an image behind it — nearly all of them —
        // so the feed looked broken rather than partial.
        const { ctx, calls } = recorder()
        renderSlideToCanvas(ctx, slide({ background: 'photo.jpg' }), HD)
        expect(drawnText(calls).join(' ')).toContain('God')
    })

    it('sends an empty frame only when there is genuinely nothing to show', () => {
        const { ctx, calls } = recorder()
        renderSlideToCanvas(ctx, null, HD)
        expect(calls).toEqual(['clearRect(0,0,1920,1080)'])
    })

    it('routes a lower third to the bar renderer and others to the text renderer', () => {
        const lower = recorder()
        renderSlideToCanvas(lower.ctx, slide({ layout: 'lower-third' }), HD)
        // The bar is drawn in the lower portion of the frame, not centred.
        const bar = lower.calls.find((c) => c.startsWith('fillRect'))
        expect(bar).toBeTruthy()
        const barY = Number(/fillRect\(\d+,(\d+)/.exec(bar!)![1])
        expect(barY).toBeGreaterThan(HD.height / 2)

        const full = recorder()
        renderSlideToCanvas(full.ctx, slide(), HD)
        // Centred text, and with alpha there is no background fill at all.
        expect(full.calls.some((c) => c.startsWith('fillRect'))).toBe(false)
    })
})

describe('renderTextSlide', () => {
    it('leaves the frame transparent unless an opaque background is asked for', () => {
        const keyed = recorder()
        renderTextSlide(keyed.ctx, slide(), HD)
        expect(keyed.calls[0]).toBe('clearRect(0,0,1920,1080)')
        expect(keyed.calls.some((c) => c.includes('fillRect(0,0,1920,1080)'))).toBe(false)

        const opaque = recorder()
        renderTextSlide(opaque.ctx, slide(), { ...HD, opaqueBackground: true })
        expect(opaque.calls.some((c) => c.startsWith('fillRect(0,0,1920,1080)'))).toBe(true)
    })

    it('wraps long text over several lines and centres the block', () => {
        const { ctx, calls } = recorder()
        renderTextSlide(ctx, slide({ contents: ['<p>' + 'word '.repeat(60) + '</p>'] }), HD)

        const ys = new Set(calls.filter((c) => c.startsWith('fillText')).map((c) => /@-?\d+,(-?\d+)/.exec(c)![1]))
        expect(ys.size).toBeGreaterThan(1)
        // Vertically centred: no line starts at the very top of the frame.
        expect(Math.min(...[...ys].map(Number))).toBeGreaterThan(0)
    })

    it('draws short text large, not at some tiny default', () => {
        // The bug this pins: sizing started from slide.slideStyle.fontSize and
        // only ever shrank, so a verse came out a few pixels tall. The DOM
        // renderer auto-fits between 18 and 160px at 1080p; this must match.
        const { ctx, calls } = recorder()
        renderTextSlide(ctx, slide({ contents: ['<p>Be still.</p>'] }), HD)

        const fontPx = Number(/(\d+)px/.exec(calls.find((c) => c.startsWith('fillText'))!)![1])
        expect(fontPx).toBeGreaterThan(100)
        expect(fontPx).toBeLessThanOrEqual(160)
    })

    it('shrinks a long passage but never below the readable floor', () => {
        const { ctx, calls } = recorder()
        renderTextSlide(ctx, slide({ contents: ['<p>' + 'word '.repeat(200) + '</p>'] }), HD)

        const fontPx = Number(/(\d+)px/.exec(calls.find((c) => c.startsWith('fillText'))!)![1])
        expect(fontPx).toBeLessThan(100)
        expect(fontPx).toBeGreaterThanOrEqual(18)
    })

    it('keeps the body inside the frame it was given', () => {
        const { ctx, calls } = recorder()
        renderTextSlide(ctx, slide({ contents: ['<p>' + 'word '.repeat(80) + '</p>'] }), HD)

        const ys = calls.filter((c) => c.startsWith('fillText')).map((c) => Number(/@-?\d+,(-?\d+)/.exec(c)![1]))
        expect(Math.min(...ys)).toBeGreaterThan(0)
        expect(Math.max(...ys)).toBeLessThan(HD.height)
    })

    it('scales the text with the output format', () => {
        const hd = recorder()
        renderTextSlide(hd.ctx, slide({ contents: ['<p>Be still.</p>'] }), HD)
        const sd = recorder()
        renderTextSlide(sd.ctx, slide({ contents: ['<p>Be still.</p>'] }), { width: 1280, height: 720 })

        const size = (calls: string[]) => Number(/(\d+)px/.exec(calls.find((c) => c.startsWith('fillText'))!)![1])
        expect(size(sd.calls) / 720).toBeCloseTo(size(hd.calls) / 1080, 1)
    })

    it('draws the reference under a bible verse', () => {
        const { ctx, calls } = recorder()
        renderTextSlide(
            ctx,
            slide({ type: 'bible', contents: ['<p>For God so loved the world</p>', '<p>John 3:16 · KJV</p>'] }),
            HD,
        )
        const texts = drawnText(calls).join(' ')
        expect(texts).toContain('John 3:16')
    })
})
