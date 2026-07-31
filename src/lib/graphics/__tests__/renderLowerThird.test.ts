import { describe, it, expect } from 'vitest'
import { layoutLowerThird, plainTextFromHtml, renderLowerThird, type Canvas2DLike } from '../renderLowerThird'
import type { Slide, SlideStyle } from '../../../types'
import { resolveVerseRefPx, VERSE_REF_BOUNDS } from '../../../utils/verseRefStyle'

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

    it("uses a scripture slide's reference as the subtitle", () => {
        // The DOM renderer shows the reference on a lower third; the canvas one
        // dropped it, which on a keyed verse is the part that makes it citable.
        const verse = {
            id: 'v1',
            type: 'bible',
            layout: 'lower-third',
            contents: ['<p>I will be glad and rejoice in thee</p>', '<p>Psalms 9:2 · KJV</p>'],
            slideStyle: {},
        } as unknown as Slide

        expect(layoutLowerThird(verse, HD).subtitle?.text).toContain('Psalms 9:2')
    })

    it("draws the reference in the operator's colour", () => {
        const verse = {
            id: 'v1', type: 'bible', layout: 'lower-third',
            contents: ['<p>Body</p>', '<p>Psalms 9:2 · KJV</p>'],
            slideStyle: {},
        } as unknown as Slide

        // Global setting applies...
        expect(layoutLowerThird(verse, { ...HD, verseRef: { color: '#ffa500' } }).subtitle?.color).toBe('#ffa500')

        // ...and the slide's own value beats it, as in the editor.
        const overridden = { ...verse, slideStyle: { verseRefColor: '#00ff00' } } as unknown as Slide
        expect(layoutLowerThird(overridden, { ...HD, verseRef: { color: '#ffa500' } }).subtitle?.color).toBe('#00ff00')
    })

    it('applies reference bold, italic and size only to a reference', () => {
        const verse = {
            id: 'v1', type: 'bible', layout: 'lower-third',
            contents: ['<p>Body</p>', '<p>Psalms 9:2</p>'],
            slideStyle: { verseRefBold: true, verseRefItalic: true, verseRefSizePercent: 150 },
        } as unknown as Slide
        const ref = layoutLowerThird(verse, HD).subtitle!
        expect(ref.isReference).toBe(true)
        expect(ref.bold).toBe(true)
        expect(ref.italic).toBe(true)

        // A hand-written subtitle is not a citation, so reference styling and
        // colour must not hijack it.
        const named = {
            ...verse,
            slideStyle: { ...verse.slideStyle, lowerThirdSubtitle: 'Guest Speaker', verseRefColor: '#ff0000' },
        } as unknown as Slide
        const subtitle = layoutLowerThird(named, HD).subtitle!
        expect(subtitle.isReference).toBe(false)
        expect(subtitle.bold).toBe(false)
        expect(subtitle.color).not.toBe('#ff0000')
    })

    it('lets an explicit subtitle win over the reference', () => {
        const verse = {
            id: 'v1',
            type: 'bible',
            layout: 'lower-third',
            contents: ['<p>Body</p>', '<p>Psalms 9:2 · KJV</p>'],
            slideStyle: { lowerThirdSubtitle: 'Guest Speaker' },
        } as unknown as Slide

        expect(layoutLowerThird(verse, HD).subtitle?.text).toBe('Guest Speaker')
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

    it('gives a verse two lines in the bar rather than crushing it onto one', () => {
        const long = '<p>' + 'Reverend Doctor '.repeat(4) + 'Mensah</p>'
        const { ctx, calls } = recorder()
        renderLowerThird(ctx, slide([long], { lowerThirdSubtitle: 'Guest Speaker' }), HD)

        const titleCalls = calls.filter((c) => c.startsWith('fillText') && !c.includes('Guest'))
        const lines = new Set(titleCalls.map((c) => /@-?\d+,(-?\d+)/.exec(c)![1]))
        // One line forced the size down until the verse was unreadable.
        expect(lines.size).toBeLessThanOrEqual(2)
        expect(lines.size).toBeGreaterThan(1)
    })

    it('changes the reference size when the percentage changes', () => {
        // The regression this pins: a cap against the body made every percentage
        // above roughly 75% land on the same clamped value, so bumping the number
        // in settings did nothing at all in a bar.
        const verse = (sizePercent: number) => ({
            id: 'v1', type: 'bible', layout: 'lower-third',
            contents: ['<p>If we confess our sins he is faithful and just to forgive us our sins and to cleanse us from all unrighteousness.</p>', '<p>1 John 1:9 · KJV</p>'],
            slideStyle: { verseRefSizePercent: sizePercent },
        } as unknown as Slide)

        const size = (sizePercent: number) => {
            const { ctx, calls } = recorder()
            renderLowerThird(ctx, verse(sizePercent), HD)
            const call = calls.find((c) => c.startsWith('fillText') && c.includes('1 John 1:9'))!
            return Number(/(\d+)px/.exec(call)![1])
        }

        const [small, medium, large] = [100, 150, 200].map(size)
        expect(medium).toBeGreaterThan(small)
        expect(large).toBeGreaterThan(medium)
    })

    it("sizes the reference by the projector's rule, whatever the verse", () => {
        // Frame-relative like the DOM, so it does not follow the body down as a
        // long verse shrinks — and one percentage means one thing on both outputs.
        const verse = (body: string) => ({
            id: 'v1', type: 'bible', layout: 'lower-third',
            contents: [`<p>${body}</p>`, '<p>1 John 1:9</p>'],
            slideStyle: {},
        } as unknown as Slide)

        const size = (body: string) => {
            const { ctx, calls } = recorder()
            renderLowerThird(ctx, verse(body), HD)
            return Number(/(\d+)px/.exec(calls.find((c) => c.includes('1 John 1:9'))!)![1])
        }

        const expected = Math.round(resolveVerseRefPx(undefined, undefined, VERSE_REF_BOUNDS.lowerThird, HD.width))
        expect(size('Short')).toBe(expected)
        expect(size('word '.repeat(40))).toBe(expected)
    })

    it('keeps the reference close under the verse when it wraps', () => {
        // The gap this pins: the reference used to be positioned from a
        // single-line body, so a wrapped verse left a hole between the two and
        // pushed the pair off centre in the bar.
        const verse = {
            id: 'v1', type: 'bible', layout: 'lower-third',
            contents: ['<p>Now I rejoice not that ye were made sorry but that ye sorrowed to repentance</p>', '<p>2 Corinthians 7:9 · KJV</p>'],
            slideStyle: {},
        } as unknown as Slide

        const { ctx, calls } = recorder()
        renderLowerThird(ctx, verse, HD)

        const rows = calls.filter((c) => c.startsWith('fillText')).map((c) => ({
            text: c.slice('fillText('.length).split('@')[0],
            y: Number(/@-?\d+,(-?\d+)/.exec(c)![1]),
            px: Number(/(\d+)px/.exec(c)![1]),
        }))
        const reference = rows.find((r) => r.text.includes('2 Corinthians'))!
        const bodyRows = rows.filter((r) => !r.text.includes('2 Corinthians'))
        const lastBody = Math.max(...bodyRows.map((r) => r.y))

        // Reference below the verse, and within about a line of it.
        expect(reference.y).toBeGreaterThan(lastBody)
        expect(reference.y - lastBody).toBeLessThan(bodyRows[0].px * 1.6)

        // The pair sits inside the bar, centred rather than hugging an edge.
        const bar = layoutLowerThird(verse, HD).bar
        expect(Math.min(...bodyRows.map((r) => r.y))).toBeGreaterThan(bar.y)
        expect(reference.y).toBeLessThan(bar.y + bar.height)
    })

    it('draws nothing but the clear for an empty slide', () => {
        const { ctx, calls } = recorder()
        renderLowerThird(ctx, slide([], { lowerThirdStyle: 'minimalist' }), HD)
        expect(calls.filter((c) => c.startsWith('fillText'))).toHaveLength(0)
        expect(calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(0)
    })
})
