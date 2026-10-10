import { beforeAll, describe, it } from 'vitest'
import { expectGolden, goldenCanvas, GOLDEN_HEIGHT, GOLDEN_WIDTH, requireFont } from '../../../test/golden/golden'
import type { Slide, SlideStyle } from '../../../types'
import type { TemplateItem } from '../../../hooks/useTemplates'
import { renderSlideToCanvas, type SlideRenderOptions } from '../renderSlide'
import { withTemplateStyle } from '../templateStyle'
import { backdropFor, BackdropImages } from '../renderBackdrop'

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

const options: SlideRenderOptions = {
    width: GOLDEN_WIDTH,
    height: GOLDEN_HEIGHT,
    defaultFont: 'Inter',
    opaqueBackground: true,
}

function render(s: Slide | null, extra: Partial<SlideRenderOptions> = {}): HTMLCanvasElement {
    const canvas = goldenCanvas(extra.width ?? GOLDEN_WIDTH, extra.height ?? GOLDEN_HEIGHT)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    renderSlideToCanvas(ctx, s, { ...options, ...extra })
    return canvas
}

function template(name: string, slideStyle: SlideStyle): TemplateItem {
    return {
        id: name,
        name,
        category: 'worship',
        isCustom: true,
        slideId: { slideStyle },
    } as unknown as TemplateItem
}

// The canvas renderer feeds the alternate NDI output. Text rasterises a
// little differently between Chromium builds, hence the `render` tolerance.
describe('canvas slide renderer', () => {
    beforeAll(async () => {
        await requireFont('Inter')
        await requireFont('Playfair Display')
        await requireFont('Source Sans Pro')
    })

    it('a lyric slide', async () => {
        await expectGolden('slide-lyric', render(slide({
            contents: ['<p>Amazing grace, how <strong>sweet</strong> the sound</p><p>That saved a wretch like me</p>'],
        })), 'render')
    })

    it('a scripture slide with its reference', async () => {
        await expectGolden('slide-scripture', render(slide({
            type: 'bible',
            contents: ['<p>For God so loved the world, that he gave his only begotten Son</p>', 'John 3:16 · KJV'],
        })), 'render')
    })

    it('a lower third', async () => {
        await expectGolden('slide-lower-third', render(slide({
            layout: 'lower-third',
            contents: ['<p>Pastor Ama Mensah</p>', '<p>Guest speaker</p>'],
            slideStyle: { lowerThirdStyle: 'accent-bar', lowerThirdAccentColor: '#0d9488' } as SlideStyle,
        })), 'render')
    })

    it('a transparent frame for a keyed feed', async () => {
        await expectGolden('slide-transparent', render(slide(), { opaqueBackground: false }), 'render')
    })

    it('Twi characters in a self-hosted font', async () => {
        await expectGolden('slide-twi', render(slide({
            contents: ['<p>Ɛyɛ me dɛ sɛ Ɔsoro Nyankopɔn</p>'],
            slideStyle: { font: 'Source Sans Pro' } as SlideStyle,
        })), 'render')
    })

    it('a slide styled by a serif template', async () => {
        const styled = withTemplateStyle(slide(), template('Serif', { font: 'Playfair Display' } as SlideStyle))
        await expectGolden('template-serif', render(styled), 'render')
    })

    it('a slide styled by a lower-third template', async () => {
        const styled = withTemplateStyle(
            slide({ contents: ['<p>Welcome to Selah Chapel</p>'] }),
            template('Bar', { lowerThirdStyle: 'gradient-bar', lowerThirdAccentColor: '#7c3aed' } as SlideStyle),
        )
        await expectGolden('template-lower-third', render(styled, { forceLowerThird: true }), 'render')
    })

    // A program feed (no alpha) paints the slide's backdrop, as the projector does.
    describe('program feed backdrops', () => {
        const program = (sl: Slide, extra: Partial<SlideRenderOptions> = {}) =>
            render(sl, { backdrop: backdropFor(sl, null), ...extra })

        it('a gradient, dimmed by the slide\'s brightness', async () => {
            const sl = slide({ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', slideStyle: { brightness: 80 } as SlideStyle })
            // Quarter size: smooth gradients compress badly.
            await expectGolden('program-gradient', program(sl, { width: 320, height: 180 }), 'render')
        })

        it('a motion background at t = 12 s', async () => {
            const sl = slide({ background: 'motion:light-rays' })
            await expectGolden('program-motion', program(sl, { timeSec: 12, motionStates: new Map(), width: 320, height: 180 }), 'render')
        })

        it('an image, covering the frame', async () => {
            // A small striped picture, wider than the frame's aspect, so cover crops it.
            const src = goldenCanvas(400, 100)
            const sctx = src.getContext('2d')
            if (!sctx) throw new Error('no 2d context')
            for (let i = 0; i < 8; i++) {
                sctx.fillStyle = i % 2 ? '#0d9488' : '#f59e0b'
                sctx.fillRect(i * 50, 0, 50, 100)
            }
            let loaded = () => {}
            const ready = new Promise<void>((r) => { loaded = r })
            const images = new BackdropImages(() => loaded())
            const url = src.toDataURL('image/png')
            images.get(url)
            await ready
            const sl = slide({ background: url, slideStyle: { brightness: 100 } as SlideStyle })
            await expectGolden('program-image', render(sl, { backdrop: backdropFor(sl, url), images }), 'render')
        })

        it('a countdown, mid-way', async () => {
            const sl = slide({ type: 'countdown', contents: ['Service starts in', '00:05:00'], background: '#1e293b' })
            // Not started (no end time), shown 83 s ago: 3:37 left.
            await expectGolden('program-countdown', program(sl, { nowMs: 100_000, countdownStartedAt: 17_000 }), 'render')
        })

        it('left-aligned text, as the slide asks', async () => {
            await expectGolden('slide-left-aligned', render(slide({ slideStyle: { alignment: 'left' } as SlideStyle })), 'render')
        })
    })
})
