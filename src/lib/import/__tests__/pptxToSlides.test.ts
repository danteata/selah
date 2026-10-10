import { describe, it, expect } from 'vitest'
import type { Slide } from '../../../types'
import {
    buildPptxSlides,
    dominantAlignment,
    dominantFont,
    escapeHtml,
    mapPptxFont,
    paragraphsToHtml,
    pptxBackground,
    pptxBoxToPadding,
    pptxSlideToSlide,
    safeColor,
    type PptxImportResult,
    type PptxParagraph,
    type PptxRun,
    type PptxSlide,
} from '../pptxToSlides'

const run = (text: string, extra: Partial<PptxRun> = {}): PptxRun => ({ text, b: false, i: false, u: false, ...extra })
const para = (runs: PptxRun[], extra: Partial<PptxParagraph> = {}): PptxParagraph => ({
    align: 'left',
    level: 0,
    bullet: 'none',
    runs,
    ...extra,
})
const html = (paragraphs: PptxParagraph[], baseAlign = 'left', baseFont?: string) =>
    paragraphsToHtml(paragraphs, { baseAlign, baseFont })

function base(): Slide {
    return {
        id: 'base-id',
        index: 0,
        name: 'Untitled',
        type: 'text',
        layout: 'full-text',
        contents: [],
        userId: '',
        churchId: '',
        scheduleId: 'sched-1',
        backgroundType: 'image',
        background: 'https://example.com/default.jpg',
        slideStyle: { alignment: 'center', fontSizePercent: 100 },
    }
}

function pptxSlide(extra: Partial<PptxSlide> = {}): PptxSlide {
    return { index: 0, hidden: false, paragraphs: [], background: { kind: 'none' }, warnings: [], ...extra }
}

function deck(slides: PptxSlide[]): PptxImportResult {
    return { deckName: 'Sunday', aspect: 1.778, warnings: [], slides }
}

describe('escaping', () => {
    it('escapes the five HTML-significant characters', () => {
        expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;')
    })

    it('never lets markup in run text through', () => {
        const out = html([para([run('<img src=x onerror=alert(1)><script>alert("x")</script>')])])
        expect(out).toBe('<p>&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>')
        const dom = new DOMParser().parseFromString(out, 'text/html')
        expect(dom.querySelector('img, script')).toBeNull()
    })

    it('keeps Twi letters as they are', () => {
        expect(html([para([run('Ɛyɛ me dɛ, Ɔdɔ')])])).toBe('<p>Ɛyɛ me dɛ, Ɔdɔ</p>')
    })

    it('turns line breaks into <br> and tabs into spaces', () => {
        expect(html([para([run('one\ntwo\r\nthree\tfour')])])).toBe('<p>one<br>two<br>three four</p>')
    })
})

describe('the style allowlist', () => {
    it('accepts only #rrggbb colours', () => {
        expect(safeColor('#FFC000')).toBe('#ffc000')
        for (const bad of ['red', '#fff', 'rgb(1,2,3)', '#ffc000; background: url(x)', '', undefined, null]) {
            expect(safeColor(bad as string)).toBeNull()
        }
    })

    it('drops a colour or font that is not on the list', () => {
        const out = html([
            para([run('a', { color: 'red;background:url(javascript:x)', font: 'Inter"; } body { x: "' })]),
        ])
        expect(out).toBe('<p>a</p>')
    })

    it('drops an alignment that is not on the list', () => {
        const out = html([para([run('a')], { align: 'center" onclick="x' as never })], 'center')
        expect(out).toBe('<p style="text-align: left">a</p>')
    })

    it('only ever emits allowed tags and attributes', () => {
        const out = html([
            para([run('Title', { b: true, i: true, u: true, color: '#112233', font: 'Calibri' })], { align: 'center' }),
            para([run('item', { color: '"><script>' })], { bullet: 'bullet' }),
            para([run('sub')], { bullet: 'number', level: 1 }),
        ])
        const dom = new DOMParser().parseFromString(`<div>${out}</div>`, 'text/html')
        const allowed = new Set(['DIV', 'P', 'BR', 'STRONG', 'EM', 'U', 'SPAN', 'UL', 'OL', 'LI'])
        for (const el of Array.from(dom.body.querySelectorAll('*'))) {
            expect(allowed.has(el.tagName)).toBe(true)
            for (const attr of Array.from(el.attributes)) expect(attr.name).toBe('style')
        }
    })
})

describe('runs', () => {
    it('nests bold, italic and underline', () => {
        expect(html([para([run('x', { b: true, i: true, u: true })])])).toBe('<p><strong><em><u>x</u></em></strong></p>')
    })

    it('gives a run its colour, but not the default white', () => {
        expect(html([para([run('gold', { color: '#FFC000' }), run(' white', { color: '#ffffff' })])])).toBe(
            '<p><span style="color: #ffc000">gold</span> white</p>',
        )
    })

    it('gives a run its font only when it differs from the slide font', () => {
        const out = html([para([run('body', { font: 'Calibri' }), run(' heading', { font: 'Montserrat' })])], 'left', 'Lato')
        expect(out).toBe('<p>body<span style="font-family: &quot;Montserrat&quot;, sans-serif"> heading</span></p>')
    })
})

describe('paragraphs and bullets', () => {
    it('marks only the paragraphs whose alignment differs from the slide', () => {
        const out = html([para([run('a')], { align: 'center' }), para([run('b')], { align: 'right' })], 'center')
        expect(out).toBe('<p>a</p><p style="text-align: right">b</p>')
    })

    it('trims empty paragraphs at the ends but keeps them inside', () => {
        const out = html([para([]), para([run('a')]), para([run('  ')]), para([run('b')]), para([])])
        expect(out).toBe('<p>a</p><p>  </p><p>b</p>')
    })

    it('groups bullets into a list in TipTap shape', () => {
        const out = html([
            para([run('Intro')]),
            para([run('one')], { bullet: 'bullet' }),
            para([run('two')], { bullet: 'bullet' }),
            para([run('Outro')]),
        ])
        expect(out).toBe('<p>Intro</p><ul><li><p>one</p></li><li><p>two</p></li></ul><p>Outro</p>')
    })

    it('nests deeper levels inside the item above', () => {
        const out = html([
            para([run('Youth camp')], { bullet: 'bullet' }),
            para([run('Register')], { bullet: 'bullet', level: 1 }),
            para([run('Pay')], { bullet: 'bullet', level: 1 }),
            para([run('Choir')], { bullet: 'bullet' }),
        ])
        expect(out).toBe(
            '<ul><li><p>Youth camp</p><ul><li><p>Register</p></li><li><p>Pay</p></li></ul></li><li><p>Choir</p></li></ul>',
        )
    })

    it('uses <ol> for numbers and starts a new list when the kind changes', () => {
        const out = html([
            para([run('a')], { bullet: 'number' }),
            para([run('b')], { bullet: 'number' }),
            para([run('c')], { bullet: 'bullet' }),
        ])
        expect(out).toBe('<ol><li><p>a</p></li><li><p>b</p></li></ol><ul><li><p>c</p></li></ul>')
    })

    it('climbs out of several levels at once', () => {
        const out = html([
            para([run('1')], { bullet: 'bullet' }),
            para([run('2')], { bullet: 'bullet', level: 1 }),
            para([run('3')], { bullet: 'bullet', level: 2 }),
            para([run('4')], { bullet: 'bullet' }),
        ])
        expect(out).toBe(
            '<ul><li><p>1</p><ul><li><p>2</p><ul><li><p>3</p></li></ul></li></ul></li><li><p>4</p></li></ul>',
        )
    })
})

describe('dominant alignment and font', () => {
    it('weights by characters', () => {
        const ps = [
            para([run('A long centred lyric line')], { align: 'center' }),
            para([run('short')], { align: 'right' }),
        ]
        expect(dominantAlignment(ps)).toBe('center')
        expect(dominantAlignment([para([run('x')], { align: 'justify' })])).toBe('left')
        expect(dominantAlignment([])).toBe('center')
    })

    it('picks the mapped font most of the text uses', () => {
        const ps = [para([run('Lots of body text', { font: 'Calibri' }), run('Title', { font: 'Montserrat' })])]
        expect(dominantFont(ps)).toBe('Lato')
        expect(dominantFont([para([run('mono', { font: 'Consolas' })])])).toBeUndefined()
    })
})

describe('font mapping', () => {
    it('keeps families Selah ships and substitutes the rest', () => {
        expect(mapPptxFont('Montserrat')).toBe('Montserrat')
        expect(mapPptxFont('playfair display')).toBe('Playfair Display')
        expect(mapPptxFont('Calibri')).toBe('Lato')
        expect(mapPptxFont('Calibri Light')).toBe('Lato')
        expect(mapPptxFont('Arial')).toBe('Inter')
        expect(mapPptxFont('Times New Roman')).toBe('Georgia')
        expect(mapPptxFont('Source Sans 3')).toBe('Source Sans Pro')
        expect(mapPptxFont('Century Gothic')).toBe('Montserrat')
    })

    it('leaves fonts with no counterpart unset', () => {
        expect(mapPptxFont('Consolas')).toBeUndefined()
        expect(mapPptxFont('Wingdings')).toBeUndefined()
        expect(mapPptxFont('')).toBeUndefined()
        expect(mapPptxFont(undefined)).toBeUndefined()
    })
})

describe('padding', () => {
    it('maps the text box onto the 1920x1080 frame', () => {
        expect(pptxBoxToPadding({ x: 0.1, y: 0.2, w: 0.8, h: 0.5 })).toEqual({ left: 192, right: 192, top: 216, bottom: 324 })
    })

    it('clamps boxes that spill off the slide', () => {
        expect(pptxBoxToPadding({ x: -0.2, y: 0, w: 1.5, h: 1 })).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
    })

    it('widens a sliver so the text keeps room', () => {
        const p = pptxBoxToPadding({ x: 0.45, y: 0.9, w: 0.02, h: 0.05 })!
        expect(1920 - p.left! - p.right!).toBe(480)
        expect(1080 - p.top! - p.bottom!).toBe(270)
        expect(p.bottom).toBe(0)
    })

    it('ignores a missing or broken box', () => {
        expect(pptxBoxToPadding(undefined)).toBeUndefined()
        expect(pptxBoxToPadding({ x: NaN, y: 0, w: 1, h: 1 })).toBeUndefined()
    })
})

describe('backgrounds', () => {
    it('maps a colour', () => {
        expect(pptxBackground({ kind: 'color', color: '#1F3864' })).toEqual({ backgroundType: 'color', background: '#1f3864' })
        expect(pptxBackground({ kind: 'color', color: 'url(x)' })).toBeNull()
    })

    it('maps a linear gradient, turning DrawingML angles into CSS ones', () => {
        expect(
            pptxBackground({
                kind: 'gradient',
                angle: 90,
                radial: false,
                stops: [{ pos: 0, color: '#0f0c29' }, { pos: 1, color: '#302b63' }],
            }),
        ).toEqual({ backgroundType: 'gradient', background: 'linear-gradient(180deg, #0f0c29 0%, #302b63 100%)' })
        expect(
            pptxBackground({ kind: 'gradient', angle: 0, radial: false, stops: [{ pos: 0, color: '#000000' }, { pos: 0.5, color: '#ffffff' }] })
                ?.background,
        ).toBe('linear-gradient(90deg, #000000 0%, #ffffff 50%)')
    })

    it('maps a radial gradient and drops bad stops', () => {
        expect(
            pptxBackground({
                kind: 'gradient',
                angle: 0,
                radial: true,
                stops: [{ pos: 0, color: '#111111' }, { pos: 0.4, color: 'blue' }, { pos: 1, color: '#222222' }],
            })?.background,
        ).toBe('radial-gradient(circle, #111111 0%, #222222 100%)')
    })

    it('maps an image to a local file', () => {
        expect(pptxBackground({ kind: 'image', path: '/data/media-library/pptx-1/image-7.png' })).toEqual({
            backgroundType: 'image',
            background: '/data/media-library/pptx-1/image-7.png',
            localFilePath: '/data/media-library/pptx-1/image-7.png',
        })
    })

    it('keeps Selah’s default when the deck has none', () => {
        expect(pptxBackground({ kind: 'none' })).toBeNull()
    })
})

describe('slides', () => {
    const lyric = pptxSlide({
        index: 2,
        title: 'Amazing Grace',
        paragraphs: [
            para([run('Amazing Grace', { font: 'Calibri Light', color: '#ffffff' })], { align: 'center' }),
            para([run('Amazing grace, how sweet the sound', { font: 'Calibri', color: '#ffffff' })], { align: 'center' }),
        ],
        box: { x: 0.0625, y: 0.05, w: 0.875, h: 0.8667 },
        background: { kind: 'color', color: '#1f3864' },
        notes: 'Sing twice',
    })

    it('builds one HTML block with the slide-wide style', () => {
        const s = pptxSlideToSlide(lyric, deck([lyric]), 'editable', base())
        expect(s.contents).toEqual(['<p>Amazing Grace</p><p>Amazing grace, how sweet the sound</p>'])
        expect(s.name).toBe('Amazing Grace')
        expect(s.type).toBe('text')
        expect(s.layout).toBe('full-text')
        expect(s.scheduleId).toBe('sched-1')
        expect(s.slideStyle).toEqual({
            alignment: 'center',
            fontSizePercent: 100,
            font: 'Lato',
            windowPadding: { left: 120, right: 120, top: 54, bottom: 90 },
        })
        expect(s.backgroundType).toBe('color')
        expect(s.background).toBe('#1f3864')
        expect(s.data).toEqual({ source: 'pptx', deckName: 'Sunday', slideNumber: 3, notes: 'Sing twice' })
    })

    it('keeps the default background when the deck has none', () => {
        const s = pptxSlideToSlide(pptxSlide({ paragraphs: [para([run('x')])] }), deck([]), 'editable', base())
        expect(s.backgroundType).toBe('image')
        expect(s.background).toBe('https://example.com/default.jpg')
    })

    it('names an untitled slide by its first line, else its number', () => {
        const first = pptxSlideToSlide(pptxSlide({ paragraphs: [para([]), para([run('  Welcome  home ')])] }), deck([]), 'editable', base())
        expect(first.name).toBe('Welcome home')
        expect(pptxSlideToSlide(pptxSlide({ index: 4 }), deck([]), 'editable', base()).name).toBe('Slide 5')
    })

    it('makes a picture slide in images mode', () => {
        const s = pptxSlideToSlide(pptxSlide({ imagePath: '/m/slide-1.png', title: 'Offering' }), deck([]), 'images', base())
        expect(s.type).toBe('media')
        expect(s.layout).toBe('empty')
        expect(s.contents).toEqual([])
        expect(s.backgroundType).toBe('image')
        expect(s.localFilePath).toBe('/m/slide-1.png')
        expect(s.slideStyle?.backgroundFillType).toBe('fit')
    })

    it('skips hidden slides unless asked, and gives each slide a fresh base', () => {
        let n = 0
        const makeBase = () => ({ ...base(), id: `id-${n++}` })
        const result = deck([pptxSlide({ index: 0 }), pptxSlide({ index: 1, hidden: true }), pptxSlide({ index: 2 })])
        const shown = buildPptxSlides(result, { mode: 'editable', includeHidden: false, makeBase })
        expect(shown.map((s) => (s.data as { slideNumber: number }).slideNumber)).toEqual([1, 3])
        expect(new Set(shown.map((s) => s.id)).size).toBe(2)
        expect(buildPptxSlides(result, { mode: 'editable', includeHidden: true, makeBase })).toHaveLength(3)
    })
})
