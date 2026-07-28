import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NavRail } from '../NavRail'

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn(),
}))

vi.mock('../../sermon-listener/SermonListenerContext', () => ({
    useSermonListenerContext: vi.fn(),
}))

import { useAppStore } from '../../../store/appStore'
import { useSermonListenerContext } from '../../sermon-listener/SermonListenerContext'

const mockUseAppStore = vi.mocked(useAppStore) as any
const mockUseSermonListenerContext = vi.mocked(useSermonListenerContext) as any

describe('NavRail', () => {
    const mockSetActiveNavSection = vi.fn()
    const mockSetCommandBarOpen = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = {
                activeNavSection: null,
                setActiveNavSection: mockSetActiveNavSection,
                commandBarOpen: false,
                setCommandBarOpen: mockSetCommandBarOpen,
            }
            return selector ? selector(state) : state
        })
        mockUseSermonListenerContext.mockReturnValue({ isListening: false })
    })

    it('renders all navigation sections', () => {
        render(<NavRail />)
        expect(screen.getByLabelText('Bible')).toBeInTheDocument()
        // Dictionary sits beside Bible — the Studio shell is the only way in.
        expect(screen.getByLabelText('Dictionary')).toBeInTheDocument()
        expect(screen.getByLabelText('Music')).toBeInTheDocument()
        expect(screen.getByLabelText('Media')).toBeInTheDocument()
        expect(screen.getByLabelText('Sermon')).toBeInTheDocument()
        expect(screen.getByLabelText('Settings')).toBeInTheDocument()
    })

    it('calls setActiveNavSection when a nav item is clicked', () => {
        render(<NavRail />)
        fireEvent.click(screen.getByLabelText('Bible'))
        expect(mockSetActiveNavSection).toHaveBeenCalledWith('bible')
    })

    it('deselects active section when clicked again', () => {
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = {
                activeNavSection: 'bible',
                setActiveNavSection: mockSetActiveNavSection,
                commandBarOpen: false,
                setCommandBarOpen: mockSetCommandBarOpen,
            }
            return selector ? selector(state) : state
        })

        render(<NavRail />)
        fireEvent.click(screen.getByLabelText('Bible'))
        expect(mockSetActiveNavSection).toHaveBeenCalledWith(null)
    })

    it('shows recording indicator on sermon button when isListening', () => {
        mockUseSermonListenerContext.mockReturnValue({ isListening: true })

        render(<NavRail />)
        const sermonBtn = screen.getByLabelText('Sermon')
        expect(sermonBtn).toBeInTheDocument()
        // The red dot indicator should be present
        expect(sermonBtn.querySelector('span')).toBeTruthy()
    })

    it('does not show recording indicator when not listening', () => {
        mockUseSermonListenerContext.mockReturnValue({ isListening: false })

        render(<NavRail />)
        const sermonBtn = screen.getByLabelText('Sermon')
        // No red dot when not recording
        const redDot = sermonBtn.querySelector('.bg-red-500')
        expect(redDot).toBeFalsy()
    })

    it('toggles command bar on quick add button click', () => {
        render(<NavRail />)
        // Quick Add is the first button in the nav (before the grouped items)
        const quickAdd = screen.getAllByRole('button')[0]
        fireEvent.click(quickAdd)
        expect(mockSetCommandBarOpen).toHaveBeenCalledWith(true)
    })

    it('has correct ARIA role and label', () => {
        render(<NavRail />)
        const nav = screen.getByRole('navigation', { name: 'Main navigation' })
        expect(nav).toBeInTheDocument()
    })

    it('marks active section with aria-pressed=true', () => {
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = {
                activeNavSection: 'settings',
                setActiveNavSection: mockSetActiveNavSection,
                commandBarOpen: false,
                setCommandBarOpen: mockSetCommandBarOpen,
            }
            return selector ? selector(state) : state
        })

        render(<NavRail />)
        expect(screen.getByLabelText('Settings')).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByLabelText('Bible')).toHaveAttribute('aria-pressed', 'false')
    })
})
