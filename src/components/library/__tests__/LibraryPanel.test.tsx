import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LibraryPanel } from '../LibraryPanel'

vi.mock('../../../hooks/useLibrary', () => ({
    useLibrary: vi.fn().mockReturnValue({ libraryCount: 0 }),
}))

vi.mock('../LibraryContent', () => ({
    LibraryContent: () => <div data-testid="library-content">Library Items</div>,
}))

import { useLibrary } from '../../../hooks/useLibrary'

const mockUseLibrary = vi.mocked(useLibrary) as any

describe('LibraryPanel', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<LibraryPanel isOpen={false} onClose={vi.fn()} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders header when open', () => {
        mockUseLibrary.mockReturnValue({ libraryCount: 12 })
        render(<LibraryPanel isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByText('My Library')).toBeInTheDocument()
        expect(screen.getByText('12 slides')).toBeInTheDocument()
    })

    it('renders library content', () => {
        mockUseLibrary.mockReturnValue({ libraryCount: 0 })
        render(<LibraryPanel isOpen={true} onClose={vi.fn()} />)
        expect(screen.getByTestId('library-content')).toBeInTheDocument()
    })

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn()
        mockUseLibrary.mockReturnValue({ libraryCount: 0 })
        render(<LibraryPanel isOpen={true} onClose={onClose} />)
        const backdrop = screen.getByText('My Library').closest('div')!.parentElement!.previousElementSibling
        expect(backdrop).toBeTruthy()
        fireEvent.click(backdrop!)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when X button is clicked', () => {
        const onClose = vi.fn()
        mockUseLibrary.mockReturnValue({ libraryCount: 0 })
        render(<LibraryPanel isOpen={true} onClose={onClose} />)
        const closeBtn = screen.getByRole('button', { name: '' })
        fireEvent.click(closeBtn)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})
