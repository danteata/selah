import { describe, it, expect } from 'vitest'
import { layoutLowerThird, plainTextFromHtml, renderLowerThird, type Canvas2DLike } from '../renderLowerThird'
import type { Slide, SlideStyle } from '../../../types'

const HD = { width: 1920, height: 1080 }

function slide(contents: string[], slideStyle: SlideStyle = {}): Slide {
    return { id: 's1', type: 'text', layout: 'lower-third', contents, slideStyle } as unknown as Slide
}

/** Records what was drawn, so the output can be asserted without a real canvas. */
function recorder() {
    const calls: string[] = []
    const state = { fillStyle: '' as string | object, font: '', textAlign: 'left' as CanvasTextAlign }
    const ctx: Canvas2DLike = {
        canvas: { width: HD.width, height: HD.height },
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        clearRect: (x, y, w, h) => calls.push(`clearRect(${x},${y},${w},${h})`),
        fillRect: (x, y, w, h) => calls.push(`fillRect(${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}) fill=${String(state.fillStyle)}`),
        fillText: (t, x, y) => calls.push(`fillText(${t}@${Math.round(x)},${Math.round(y)}) align=${state.textAlign} font=${state.font}`),
        strokeText: (t, x, y) => calls.push(`strokeText(${t}@${Math.round(x)},${Math.round(y)})`),
        measureText: (t) => {
            const px = Number(/(\d+)px/.exec(state.font)?.[1] ?? 16)
            return { width: t.length * px * 0.5 }
        },
        createLinearGradient: () => ({ addColorStop: (o: number, c: string) => calls.push(`gradientStop(${o},${c})`) }),
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

describe('plainTextFromHtml', () => {
    it('reduces TipTap markup to the words the bar will show', () => {
        expect(plainTextFromHtml('<p>Pastor <strong>John</strong> Mensah</p>')).toBe('Pastor John Mensah')
        expect(plainTextFromHtml('<p>First</p><p>Second</p>')).toBe('First Second')
        expect(plainTextFromHtml('Line<br>Break')).toBe('Line Break')
        expect(plainTextFromHtml('Ampersand &amp; &quot;quotes&quot;')).toBe('Ampersand & "quotes"')
        expect(plainTextFromHtml('&nbsp; spaced &nbsp; out &nbsp;')).toBe('spaced out')
    })
})

describe('layoutLowerThird', () => {
    it('anchors the bar near the bottom of the frame, inset from both edges', () => {
        const { bar } = layoutLowerThird(slide(['<p>Name</p>']), HD)
        expect(bar.height).toBeCloseTo(1080 * 0.18)
        // Sits above the bottom edge — a broadcast lower third is not flush.
        expect(bar.y + bar.height).toBeLessThan(1080)
        expect(bar.x).toBeGreaterThan(0)
        expect(bar.x + bar.width).toBeLessThan(1920)
    })

    it('draws no bar at all for the minimalist style', () => {
        // The DOM version uses `background: transparent`; on a keyed feed that has
        // to mean "nothing drawn", not "black".
        const layout = layoutLowerThird(slide(['<p>Name</p>'], { lowerThirdStyle: 'minimalist' }), HD)
        expect(layout.fill).toBeNull()
        expect(layout.accentBar).toBeNull()
    })

    it('uses the accent colour for the accent-bar and gradient styles', () => {
        const accent = layoutLowerThird(slide(['x'], { lowerThirdStyle: 'accent-bar', lowerThirdAccentColor: '#ff0000' }), HD)
        expect(accent.accentBar?.color).toBe('#ff0000')
        expect(accent.fill).toEqual({ kind: 'solid', color: 'rgba(0, 0, 0, 0.75)' })

        const gradient = layoutLowerThird(slide(['x'], { lowerThirdStyle: 'gradient-bar', lowerThirdAccentColor: '#00ff00' }), HD)
        expect(gradient.fill).toEqual({ kind: 'gradient', from: '#00ff00ee', to: '#00ff0088' })
    })

    it('keeps text clear of the accent bar', () => {
        const plain = layoutLowerThird(slide(['x'], { lowerThirdStyle: 'standard' }), HD)
        const accent = layoutLowerThird(slide(['x'], { lowerThirdStyle: 'accent-bar' }), HD)
        expect(accent.title.x).toBeGreaterThan(plain.title.x)
    })

    it('honours the three text positions', () => {
        expect(layoutLowerThird(slide(['x'], { lowerThirdPosition: 'left' }), HD).title.align).toBe('left')
        const centred = layoutLowerThird(slide(['x'], { lowerThirdPosition: 'center' }), HD)
        expect(centred.title.align).toBe('center')
        expect(centred.title.x).toBe(960)
        expect(layoutLowerThird(slide(['x'], { lowerThirdPosition: 'right' }), HD).title.align).toBe('right')
    })

    it('makes room for a subtitle by shrinking the title', () => {
        const alone = layoutLowerThird(slide(['<p>Name</p>']), HD)
        const withSub = layoutLowerThird(slide(['<p>Name</p>'], { lowerThirdSubtitle: 'Guest Speaker' }), HD)

        expect(withSub.subtitle?.text).toBe('Guest Speaker')
        expect(withSub.title.fontPx).toBeLessThan(alone.title.fontPx)
        // Subtitle below the title, both inside the bar.
        expect(withSub.subtitle!.y).toBeGreaterThan(withSub.title.y)
        expect(withSub.subtitle!.y).toBeLessThan(withSub.bar.y + withSub.bar.height)
        expect(alone.subtitle).toBeNull()
    })

    it('scales with the frame, so a 720p feed is the same design', () => {
        const hd = layoutLowerThird(slide(['<p>Name</p>']), HD)
        const sd = layoutLowerThird(slide(['<p>Name</p>']), { width: 1280, height: 720 })
        expect(sd.bar.height / 720).toBeCloseTo(hd.bar.height / 1080)
        expect(sd.title.fontPx / 720).toBeCloseTo(hd.title.fontPx / 1080)
    })
})

describe('renderLowerThird', () => {
    it('clears to transparent before drawing, so the rest of the frame keys out', () => {
        const { ctx, calls } = recorder()
        renderLowerThird(ctx, slide(['<p>Name</p>']), HD)
        // Must be clearRect, never a fillRect of black over the whole frame.
        expect(calls[0]).toBe('clearRect(0,0,1920,1080)')
        expect(calls.some((c) => c.startsWith('fillRect(0,0,1920,1080)'))).toBe(false)
    })

    it('draws the bar and the title text', () => {
        const { ctx, calls } = recorder()
        renderLowerThird(ctx, slide(['<p>Pastor John</p>'], { lowerThirdSubtitle: 'Guest' }), HD)

        expect(calls.some((c) => c.includes('fillRect') && c.includes('rgba(0, 0, 0, 0.75)'))).toBe(true)
        expect(calls.some((c) => c.startsWith('fillText(Pastor John@'))).toBe(true)
        expect(calls.some((c) => c.startsWith('fillText(Guest@'))).toBe(true)
    })

    it('outlines text only when the slide asks for it', () => {
        const plain = recorder()
        renderLowerThird(plain.ctx, slide(['<p>Name</p>']), HD)
        expect(plain.calls.some((c) => c.startsWith('strokeText'))).toBe(false)

        const outlined = recorder()
        renderLowerThird(outlined.ctx, slide(['<p>Name</p>'], { textOutlined: true }), HD)
        expect(outlined.calls.some((c) => c.startsWith('strokeText'))).toBe(true)
    })

    it('carries bold, italic and colour from the editor into the drawing', () => {
        const { ctx, calls } = recorder()
        renderLowerThird(
            ctx,
            slide(['<p>Pastor <strong>John</strong> <span style="color: #ff0000">Mensah</span></p>']),
            HD,
        )

        const bold = calls.find((c) => c.startsWith('fillText(John@'))
        expect(bold).toContain('font=700')
        const plain = calls.find((c) => c.startsWith('fillText(Pastor @'))
        expect(plain).toContain('font=700') // the title's base weight
        // The coloured run is drawn separately so it can take its own fill.
        expect(calls.some((c) => c.startsWith('fillText(Mensah@'))).toBe(true)
    })

    it('draws each styled run in sequence rather than as one string', () => {
        const { ctx, calls } = recorder()
        renderLowerThird(ctx, slide(['<p>A <em>B</em> C</p>']), HD)

        const texts = calls.filter((c) => c.startsWith('fillText')).map((c) => c.slice('fillText('.length).split('@')[0])
        expect(texts).toEqual(['A ', 'B', ' C'])
        expect(calls.find((c) => c.startsWith('fillText(B@'))).toContain('italic')
    })

    it('advances x across runs so words do not overlap', () => {
        const { ctx, calls } = recorder()
        renderLowerThird(ctx, slide(['<p>A <em>B</em> C</p>']), HD)

        const xs = calls
            .filter((c) => c.startsWith('fillText'))
            .map((c) => Number(/@(-?\d+),/.exec(c)![1]))
        expect(xs[1]).toBeGreaterThan(xs[0])
        expect(xs[2]).toBeGreaterThan(xs[1])
    })

    it('wraps a long name onto a second line when there is room', () => {
        const { ctx, calls } = recorder()
        const long = '<p>' + 'Reverend Doctor '.repeat(4) + 'Mensah</p>'
        renderLowerThird(ctx, slide([long]), HD)

        const ys = new Set(calls.filter((c) => c.startsWith('fillText')).map((c) => /@-?\d+,(-?\d+)/.exec(c)![1]))
        expect(ys.size).toBe(2)
    })

    it('shrinks instead of wrapping when a subtitle leaves only one line', () => {
        const long = '<p>' + 'Reverend Doctor '.repeat(4) + 'Mensah</p>'
        const oneLine = recorder()
        renderLowerThird(oneLine.ctx, slide([long], { lowerThirdSubtitle: 'Guest Speaker' }), HD)

        const titleCalls = oneLine.calls.filter((c) => c.startsWith('fillText') && !c.includes('Guest'))
        const ys = new Set(titleCalls.map((c) => /@-?\d+,(-?\d+)/.exec(c)![1]))
        expect(ys.size).toBe(1)

        // ...and the size actually came down to achieve that.
        const fontPx = Number(/(\d+)px/.exec(titleCalls[0])![1])
        const layout = layoutLowerThird(slide([long], { lowerThirdSubtitle: 'Guest Speaker' }), HD)
        expect(fontPx).toBeLessThan(layout.title.fontPx)
    })

    it('draws nothing but the clear for an empty slide', () => {
        const { ctx, calls } = recorder()
        renderLowerThird(ctx, slide([], { lowerThirdStyle: 'minimalist' }), HD)
        expect(calls.filter((c) => c.startsWith('fillText'))).toHaveLength(0)
        expect(calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(0)
    })
})
