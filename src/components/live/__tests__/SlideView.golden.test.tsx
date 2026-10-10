import { beforeAll, describe, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { expectGolden, GOLDEN_HEIGHT, GOLDEN_WIDTH, requireFont } from '../../../test/golden/golden'
import { SlideView } from '../SlideView'
import type { Slide, SlideStyle } from '../../../types'

// Background resolution reaches Convex and IndexedDB; these slides have none.
vi.mock('../../../hooks/useSlideBackgroundUrl', () => ({ useSlideBackgroundUrl: () => null }))
vi.mock('../AudioReactiveBackground', () => ({ AudioReactiveBackground: () => null }))

const settings = { defaultFont: 'Inter', songAndHymnLabelsVisibility: true }

function slide(over: Partial<Slide>): Slide {
    return { id: 's1', index: 0, name: 'x', type: 'text', layout: 'full-text', contents: ['Hello'], ...over } as Slide
}

/** The projector's view of a slide, at golden size. */
async function mount(s: Slide): Promise<HTMLElement> {
    const { container } = render(
        <div style={{ width: GOLDEN_WIDTH, height: GOLDEN_HEIGHT, position: 'relative', background: '#000' }}>
            <SlideView slide={s} settings={settings} className="absolute inset-0" clock={false} />
        </div>,
    )
    // AutoFitText fits after fonts are ready and layout has run.
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return container.firstChild as HTMLElement
}

describe('SlideView (DOM, the projector)', () => {
    beforeAll(async () => {
        await requireFont('Inter')
        await requireFont('Playfair Display')
    })

    it('a lyric slide on a gradient', async () => {
        const el = await mount(slide({
            title: 'Amazing Grace',
            contents: ['<p>Amazing grace, how sweet the sound</p><p>That saved a wretch like me</p>'],
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }))
        await expectGolden('slideview-lyric', el, 'render')
    })

    it('a scripture slide in a serif template font', async () => {
        const el = await mount(slide({
            type: 'bible',
            contents: ['<p>The Lord is my shepherd; I shall not want.</p>', 'Psalm 23:1 · KJV'],
            slideStyle: { font: 'Playfair Display' } as SlideStyle,
            background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        }))
        await expectGolden('slideview-scripture', el, 'render')
    })
})
