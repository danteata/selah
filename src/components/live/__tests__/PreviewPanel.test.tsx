import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Slide } from '../../../types'
import { useAppStore } from '../../../store/appStore'

const h = vi.hoisted(() => ({
    session: {
        isConnected: false,
        isOperator: false,
        isContributor: false,
        isOpen: false,
        sessionScheduleId: null as string | null,
        setLiveSlide: vi.fn(async () => {}),
    },
}))
vi.mock('../../../hooks/useLiveSession', () => ({ useLiveSession: () => h.session }))
vi.mock('../../../hooks', () => ({ useLiveSession: () => h.session }))
vi.mock('../OutputThumbnail', () => ({
    OutputThumbnail: ({ slide, emptyText }: { slide?: Slide; emptyText: string }) => (
        <div data-testid="thumb">{slide ? slide.id : emptyText}</div>
    ),
}))

import { PreviewPanel } from '../PreviewPanel'

function slide(id: string): Slide {
    return { id, index: 0, name: `Slide ${id}`, type: 'text', layout: 'full-text', userId: '', churchId: '', scheduleId: 'sched', contents: [] } as Slide
}

describe('PreviewPanel', () => {
    beforeEach(() => {
        useAppStore.getState().signOut()
        useAppStore.setState({
            activeSlides: [slide('a'), slide('b'), slide('c')],
            liveOutputSlidesId: ['a', 'b', 'c'],
            activeSchedule: { _id: 'sched' } as never,
            liveSlideId: 'a',
            stagedSlideId: 'c',
        })
        Object.assign(h.session, { isConnected: false, isOperator: false, isContributor: false, isOpen: false, sessionScheduleId: null })
        h.session.setLiveSlide.mockClear()
    })
    afterEach(cleanup)

    it('shows the staged slide and sends it', () => {
        render(<PreviewPanel />)
        expect(screen.getByText('Staged')).toBeTruthy()
        expect(screen.getByTestId('thumb').textContent).toBe('c')
        fireEvent.click(screen.getByRole('button', { name: /send/i }))
        expect(h.session.setLiveSlide).toHaveBeenCalledWith('c')
    })

    it('with nothing staged, shows next up, labelled, with no Send', () => {
        useAppStore.setState({ stagedSlideId: null })
        render(<PreviewPanel />)
        expect(screen.getByText('Next Up')).toBeTruthy()
        expect(screen.getByTestId('thumb').textContent).toBe('b')
        expect(screen.queryByRole('button', { name: /send/i })).toBeNull()
    })

    it('treats a staged slide that is already on air as nothing staged', () => {
        useAppStore.setState({ stagedSlideId: 'a' })
        render(<PreviewPanel />)
        expect(screen.getByText('Next Up')).toBeTruthy()
        expect(screen.getByTestId('thumb').textContent).toBe('b')
    })

    it('says the schedule has ended after the last slide', () => {
        useAppStore.setState({ stagedSlideId: null, liveSlideId: 'c' })
        render(<PreviewPanel />)
        expect(screen.getByTestId('thumb').textContent).toBe('End of Schedule')
    })

    it("offers no Send to a session viewer who can't send to air", () => {
        Object.assign(h.session, { isConnected: true })
        render(<PreviewPanel />)
        expect(screen.getByText('Staged')).toBeTruthy()
        expect(screen.queryByRole('button', { name: /send/i })).toBeNull()
    })
})
