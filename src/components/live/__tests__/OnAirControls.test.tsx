import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Slide } from '../../../types'
import { OnAirControls } from '../OnAirControls'
import type { OnAir } from '../useOnAir'

function slide(id: string): Slide {
    return { id, index: 0, name: `Slide ${id}`, type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId: '', contents: [] } as Slide
}

function onAir(patch: Partial<OnAir> = {}): OnAir {
    const deck = [slide('a'), slide('b'), slide('c')]
    return {
        deck,
        liveSlide: deck[1],
        index: 1,
        previous: deck[0],
        nextUp: deck[2],
        canStep: true,
        setOnAir: vi.fn(),
        canSuggest: false,
        suggestionsAreAdded: false,
        suggest: vi.fn(async () => {}),
        ...patch,
    }
}

describe('OnAirControls', () => {
    afterEach(cleanup)

    it('names what is on air and where it sits in the deck', () => {
        render(<OnAirControls onAir={onAir()} />)
        expect(screen.getByText('On air')).toBeTruthy()
        expect(screen.getByText('Slide b')).toBeTruthy()
        expect(screen.getByText('2/3')).toBeTruthy()
    })

    it('steps to the previous and next slides', () => {
        const state = onAir()
        render(<OnAirControls onAir={state} />)
        fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
        fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
        expect(state.setOnAir).toHaveBeenNthCalledWith(1, 'a')
        expect(state.setOnAir).toHaveBeenNthCalledWith(2, 'c')
    })

    it("can't step when this desk may not change what's on air", () => {
        render(<OnAirControls onAir={onAir({ canStep: false })} />)
        expect((screen.getByRole('button', { name: 'Previous slide' }) as HTMLButtonElement).disabled).toBe(true)
        expect((screen.getByRole('button', { name: 'Next slide' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('shows no position when nothing in the deck is on air', () => {
        render(<OnAirControls onAir={onAir({ liveSlide: undefined, index: -1, previous: undefined })} />)
        expect(screen.getByText('None')).toBeTruthy()
        expect(screen.getByText('-/-')).toBeTruthy()
    })

    it('lets a contributor suggest next up, or add it in an open session', () => {
        const state = onAir({ canSuggest: true })
        const { rerender } = render(<OnAirControls onAir={state} />)
        fireEvent.click(screen.getByText('Suggest'))
        expect(state.suggest).toHaveBeenCalledWith('c')
        rerender(<OnAirControls onAir={{ ...state, suggestionsAreAdded: true }} />)
        expect(screen.getByText('Add')).toBeTruthy()
    })
})
