import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LibraryContent } from '../LibraryContent'

vi.mock('../../../hooks/useLibrary', () => ({
    useLibrary: vi.fn(() => ({
        librarySlides: [],
        removeFromLibrary: vi.fn(),
        useSlide: vi.fn(),
        getSlidesByCategory: vi.fn(() => []),
        libraryCount: 0,
    })),
}))

vi.mock('../modals/ConfirmDialog', () => ({
    useConfirmDialog: vi.fn(() => ({
        confirm: vi.fn(),
        ConfirmDialog: () => null,
    })),
}))

describe('LibraryContent', () => {
    it('renders search input', () => {
        render(<LibraryContent />)
        expect(screen.getByPlaceholderText(/search library/i)).toBeInTheDocument()
    })

    it('renders category tabs', () => {
        render(<LibraryContent />)
        expect(screen.getByText('All')).toBeInTheDocument()
        expect(screen.getByText('Scripture')).toBeInTheDocument()
        expect(screen.getByText('Songs')).toBeInTheDocument()
    })

    it('shows empty state when no slides', () => {
        render(<LibraryContent />)
        expect(screen.getByText('No slides found')).toBeInTheDocument()
    })

    it('updates search query on input', () => {
        render(<LibraryContent />)
        const input = screen.getByPlaceholderText(/search library/i)
        fireEvent.change(input, { target: { value: 'test' } })
        expect(input).toHaveValue('test')
    })

    it('applies compact class when compact prop is true', () => {
        const { container } = render(<LibraryContent compact={true} />)
        const containerDiv = container.firstChild as HTMLElement
        expect(containerDiv.querySelector('.p-2')).toBeTruthy()
    })
})
