import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileStudioWorkspace } from '../MobileStudioWorkspace'
import type { Slide } from '../../../types'

// vi.mock factories are hoisted above imports — any state they reference must live
// inside vi.hoisted() so the closure captures the hoisted binding, not the runtime one.
const mocks = vi.hoisted(() => {
    return {
        store: {
            current: {
                activeSlides: [] as Slide[],
                liveSlideId: '',
                setLiveSlide: vi.fn(),
                liveOutputSlidesId: [] as string[],
                openModal: vi.fn(),
                workspaceMode: 'studio',
            },
        },
        session: {
            isOperator: true,
            isContributor: false,
            isConnected: false,
            isOpen: false,
            isStrict: false,
            addToQueue: vi.fn(),
            setLiveSlide: vi.fn(),
            sessionScheduleId: undefined as string | undefined,
        },
    }
})

vi.mock('../../../store/appStore', () => ({
    useAppStore: (selector: any) =>
        selector ? selector(mocks.store.current) : mocks.store.current,
}))

vi.mock('../../../hooks/useLiveSession', () => ({
    useLiveSession: () => mocks.session,
}))

const bibleSlide: Slide = {
    id: 'b1',
    index: 0,
    scheduleId: '',
    userId: '',
    churchId: '',
    name: 'Psalm 24',
    type: 'bible',
    layout: 'standard',
    contents: [
        '<p class="scripture-content"><sup>5</sup> He shall receive the blessing from the LORD.</p>',
        '<p class="scripture-label"><b>Psalm 24:5</b> · KJV</p>',
    ],
    background: '#1f2937',
    slideStyle: { font: 'Inter' },
}

function setStore(slides: Slide[], liveSlideId: string) {
    mocks.store.current = {
        activeSlides: slides,
        liveSlideId,
        setLiveSlide: vi.fn(),
        liveOutputSlidesId: slides.map(s => s.id),
        openModal: vi.fn(),
        workspaceMode: 'studio',
    }
}

describe('MobileStudioWorkspace', () => {
    beforeEach(() => {
        // jsdom has no layout — AutoFitText reads clientWidth/scrollWidth. Returning
        // a positive width lets fit() proceed without throwing.
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get() { return 320 },
        })
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get() { return 200 },
        })
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
            configurable: true,
            get() { return 100 },
        })
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get() { return 100 },
        })
    })

    it('renders bible verse reference label as parsed HTML, not raw markup', () => {
        setStore([bibleSlide], bibleSlide.id)

        render(<MobileStudioWorkspace />)

        // The label string from the slide is "<p class="scripture-label"><b>Psalm 24:5</b> · KJV</p>".
        // If the bug regresses, this exact string leaks into the DOM as a text node.
        expect(screen.queryByText(/^<p class="scripture-label"/)).toBeNull()

        // The label must be parsed — find a <p> carrying the scripture-label class with
        // a <b> child holding the reference text.
        const label = document.querySelector('p.scripture-label')
        expect(label).not.toBeNull()
        expect(label?.querySelector('b')?.textContent).toBe('Psalm 24:5')
        // Trailing " · KJV" should be in the same label, not floating text.
        expect(label?.textContent).toContain('KJV')
    })

    it('does not render a ref label node when the live slide has no contents[1]', () => {
        const noRefSlide: Slide = {
            ...bibleSlide,
            id: 'b2',
            contents: ['<p>plain verse text</p>'],
        }
        setStore([noRefSlide], noRefSlide.id)

        render(<MobileStudioWorkspace />)

        expect(document.querySelector('p.scripture-label')).toBeNull()
    })

    it('dispatches the quick-actions focus event when search button is tapped', () => {
        setStore([bibleSlide], bibleSlide.id)

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        render(<MobileStudioWorkspace />)
        const searchButton = screen.getByRole('button', { name: /search and add slides/i })
        fireEvent.click(searchButton)

        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'selah:focus-quick-actions' })
        )
    })
})
