import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ListeningChip } from '../ListeningChip'

vi.mock('../SermonListenerContext', () => ({
    useSermonListenerContext: vi.fn(),
}))

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn(),
}))

import { useSermonListenerContext } from '../SermonListenerContext'
import { useAppStore } from '../../../store/appStore'

const mockUseSermonListenerContext = vi.mocked(useSermonListenerContext) as any
const mockUseAppStore = vi.mocked(useAppStore) as any

describe('ListeningChip', () => {
    it('renders nothing when not listening', () => {
        mockUseSermonListenerContext.mockReturnValue({ isListening: false })
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = { activeNavSection: null, setActiveNavSection: vi.fn() }
            return selector ? selector(state) : state
        })
        const { container } = render(<ListeningChip />)
        expect(container.firstChild).toBeNull()
    })

    it('renders nothing when sermon panel is active', () => {
        mockUseSermonListenerContext.mockReturnValue({ isListening: true })
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = { activeNavSection: 'sermon', setActiveNavSection: vi.fn() }
            return selector ? selector(state) : state
        })
        const { container } = render(<ListeningChip />)
        expect(container.firstChild).toBeNull()
    })

    it('renders listening chip when active and panel hidden', () => {
        mockUseSermonListenerContext.mockReturnValue({ isListening: true })
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = { activeNavSection: 'bible', setActiveNavSection: vi.fn() }
            return selector ? selector(state) : state
        })
        render(<ListeningChip />)
        expect(screen.getByText(/Listening/)).toBeInTheDocument()
    })

    it('opens sermon panel on click', () => {
        const setActiveNavSection = vi.fn()
        mockUseSermonListenerContext.mockReturnValue({ isListening: true })
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = { activeNavSection: 'bible', setActiveNavSection }
            return selector ? selector(state) : state
        })
        render(<ListeningChip />)
        fireEvent.click(screen.getByText(/Listening/))
        expect(setActiveNavSection).toHaveBeenCalledWith('sermon')
    })
})
