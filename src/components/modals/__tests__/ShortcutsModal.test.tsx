import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ShortcutsModal } from '../ShortcutsModal'

describe('ShortcutsModal', () => {
    const onClose = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders nothing when closed', () => {
        const { container } = render(<ShortcutsModal isOpen={false} onClose={onClose} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders title and shortcut groups when open', () => {
        render(<ShortcutsModal isOpen={true} onClose={onClose} />)
        expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
        expect(screen.getByText('General')).toBeInTheDocument()
        expect(screen.getByText('Slides')).toBeInTheDocument()
        expect(screen.getByText('Navigation')).toBeInTheDocument()
        expect(screen.getByText('Live Presentation')).toBeInTheDocument()
    })

    it('renders specific shortcuts', () => {
        render(<ShortcutsModal isOpen={true} onClose={onClose} />)
        expect(screen.getByText('Focus quick actions search')).toBeInTheDocument()
        expect(screen.getByText('Undo')).toBeInTheDocument()
        expect(screen.getByText('Previous slide')).toBeInTheDocument()
        expect(screen.getByText('Promote to live')).toBeInTheDocument()
    })

    it('renders key labels', () => {
        render(<ShortcutsModal isOpen={true} onClose={onClose} />)
        expect(screen.getAllByText('⌘').length).toBeGreaterThan(0)
        expect(screen.getByText('Esc')).toBeInTheDocument()
        expect(screen.getByText('Space')).toBeInTheDocument()
    })

    it('calls onClose when backdrop is clicked', () => {
        render(<ShortcutsModal isOpen={true} onClose={onClose} />)
        const backdrop = screen.getByText('Keyboard Shortcuts').closest('div')!.parentElement!.parentElement!
        fireEvent.click(backdrop)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when X button is clicked', () => {
        render(<ShortcutsModal isOpen={true} onClose={onClose} />)
        const closeBtn = screen.getByRole('button', { name: '' })
        fireEvent.click(closeBtn)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('shows Windows/Linux hint in footer', () => {
        render(<ShortcutsModal isOpen={true} onClose={onClose} />)
        expect(screen.getByText(/On Windows\/Linux/)).toBeInTheDocument()
        expect(screen.getByText('Ctrl')).toBeInTheDocument()
    })
})
