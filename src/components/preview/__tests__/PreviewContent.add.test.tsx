import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Slide } from '../../../types'
import { useAppStore } from '../../../store/appStore'

function made(id: string, layout: string): Slide {
    return { id, index: 0, name: id, type: 'text', layout, userId: '', churchId: '', scheduleId: '', contents: [] } as Slide
}

const h = vi.hoisted(() => ({
    createTextSlide: vi.fn(),
    createLowerThirdSlide: vi.fn(),
}))
vi.mock('../../../hooks', () => ({
    useSlideCreation: () => ({ createTextSlide: h.createTextSlide, createLowerThirdSlide: h.createLowerThirdSlide, duplicateSlide: vi.fn() }),
    useLibrary: () => ({ addToLibrary: vi.fn(), isInLibrary: () => false }),
    useScripture: () => ({ fetchScripture: vi.fn() }),
    useLiveSession: () => ({
        isOperator: false, isContributor: false, isConnected: false, isOpen: false, isStrict: false,
        addToQueue: vi.fn(), setLiveSlide: vi.fn(), sessionScheduleId: null,
    }),
    useVerseNavigationShortcuts: () => {},
}))

import { PreviewContent } from '../PreviewContent'

describe('service order Add', () => {
    beforeEach(() => {
        useAppStore.getState().signOut()
        h.createTextSlide.mockReturnValue(made('text-1', 'full-text'))
        h.createLowerThirdSlide.mockReturnValue(made('lt-1', 'lower-third'))
    })
    afterEach(cleanup)

    it('is titled the service order', () => {
        render(<PreviewContent />)
        expect(screen.getByText('Service order')).toBeTruthy()
    })

    it('adds a text slide, stages it and opens the editor', () => {
        render(<PreviewContent />)
        fireEvent.click(screen.getByRole('button', { name: /text slide/i }))
        const state = useAppStore.getState()
        expect(state.activeSlides.map((s) => s.id)).toContain('text-1')
        expect(state.stagedSlideId).toBe('text-1')
        expect(state.editingSlide?.id).toBe('text-1')
        expect(state.modals.editor).toBe(true)
    })

    it('opens a new lower third in its editor, adding it only when saved', () => {
        render(<PreviewContent />)
        fireEvent.click(screen.getByRole('button', { name: /lower third/i }))
        const state = useAppStore.getState()
        expect(state.editingSlide?.id).toBe('lt-1')
        expect(state.modals.lowerThirdEditor).toBe(true)
        expect(state.activeSlides.map((s) => s.id)).not.toContain('lt-1')
    })
})
