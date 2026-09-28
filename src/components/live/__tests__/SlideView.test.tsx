import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SlideView } from '../SlideView'
import type { Slide } from '../../../types'

// Background resolution reaches Convex and IndexedDB; these slides have none.
vi.mock('../../../hooks/useSlideBackgroundUrl', () => ({ useSlideBackgroundUrl: () => null }))
vi.mock('../AudioReactiveBackground', () => ({ AudioReactiveBackground: () => null }))

const settings = { defaultFont: 'Inter', songAndHymnLabelsVisibility: true }

function slide(over: Partial<Slide>): Slide {
    return { id: 's1', index: 0, name: 'x', type: 'text', layout: 'full-text', contents: ['Hello'], ...over } as Slide
}

describe('SlideView', () => {
    it("shows a countdown's title and its time", () => {
        render(<SlideView slide={slide({ type: 'countdown', contents: ['Service starts in', '00:05:00'] })} settings={settings} />)
        expect(screen.getByText('Service starts in')).toBeInTheDocument()
        expect(screen.getByText('05:00')).toBeInTheDocument()
    })

    it("holds a countdown that isn't live at its full time", () => {
        render(<SlideView slide={slide({ type: 'countdown', contents: ['Soon', '00:05:00'] })} settings={settings} clock={false} />)
        expect(screen.getByText('05:00')).toBeInTheDocument()
    })

    it('shows the song title when labels are on', () => {
        const { rerender } = render(<SlideView slide={slide({ title: 'Amazing Grace' })} settings={settings} />)
        expect(screen.getByText('Amazing Grace')).toBeInTheDocument()
        rerender(<SlideView slide={slide({ title: 'Amazing Grace' })} settings={{ ...settings, songAndHymnLabelsVisibility: false }} />)
        expect(screen.queryByText('Amazing Grace')).toBeNull()
    })

    it('draws the verse reference below the verse by default, above when asked', () => {
        const bible = slide({ type: 'bible', contents: ['For God so loved', 'John 3:16 · KJV'] })
        const { container, rerender } = render(<SlideView slide={bible} settings={settings} />)
        const order = () => {
            const text = container.textContent || ''
            return text.indexOf('John 3:16') > text.indexOf('For God')
        }
        expect(order()).toBe(true)
        rerender(<SlideView slide={bible} settings={{ ...settings, verseRefPosition: 'top' }} />)
        expect(order()).toBe(false)
    })

    it('hides the text but not the frame while the output is cleared', () => {
        const { container } = render(<SlideView slide={slide({ title: 'Song' })} settings={{ ...settings, liveOutputBlanked: true }} />)
        expect(container.textContent).not.toContain('Hello')
        expect(container.textContent).not.toContain('Song')
        expect(container.firstChild).not.toBeNull()
    })

    it("lets a caller position the frame (the projector's full-screen box)", () => {
        const { container } = render(<SlideView slide={slide({})} settings={settings} className="absolute inset-0" />)
        const root = container.firstChild as HTMLElement
        expect(root.className).toContain('absolute')
        // Both classes made it relative, and a relative size container with
        // no height is 0px tall: the projector showed nothing.
        expect(root.className).not.toMatch(/\brelative\b/)
    })

    it('keeps each sung line of a song on one line', () => {
        const { container } = render(<SlideView slide={slide({ type: 'song', contents: ['Amazing grace\nhow sweet the sound'] })} settings={settings} />)
        const body = [...container.querySelectorAll('div')].find((d) => d.innerHTML === 'Amazing grace<br>how sweet the sound')
        expect(body?.parentElement?.style.whiteSpace).toBe('nowrap')
    })

    it('draws operator controls passed as children', () => {
        render(<SlideView slide={slide({})} settings={settings}><button>Pause</button></SlideView>)
        expect(screen.getByText('Pause')).toBeInTheDocument()
    })
})
