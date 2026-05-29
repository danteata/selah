import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StatusBar } from '../StatusBar'

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn(),
}))

vi.mock('../../sermon-listener/SermonListenerContext', () => ({
    useSermonListenerContext: vi.fn(),
}))

vi.mock('../../../hooks/useEmbeddingStatus', () => ({
    useEmbeddingStatus: vi.fn(),
}))

vi.mock('../../offline/OfflineIndicator', () => ({
    OfflineIndicator: () => <span data-testid="offline-indicator">Offline</span>,
}))

vi.mock('../../slides/SlideChip', () => ({
    SlideChip: ({ slideType }: { slideType: string }) => <span data-testid={`chip-${slideType}`}>{slideType}</span>,
}))

import { useAppStore } from '../../../store/appStore'
import { useSermonListenerContext } from '../../sermon-listener/SermonListenerContext'
import { useEmbeddingStatus } from '../../../hooks/useEmbeddingStatus'

const mockUseAppStore = vi.mocked(useAppStore) as any
const mockUseSermonListenerContext = vi.mocked(useSermonListenerContext) as any
const mockUseEmbeddingStatus = vi.mocked(useEmbeddingStatus) as any

describe('StatusBar', () => {
    const mockSetActiveNavSection = vi.fn()
    const mockToggleContextPanel = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = {
                activeSlides: [],
                liveSlideId: null,
                activeNavSection: null,
                setActiveNavSection: mockSetActiveNavSection,
                contextPanelOpen: false,
                toggleContextPanel: mockToggleContextPanel,
            }
            return selector ? selector(state) : state
        })
        mockUseSermonListenerContext.mockReturnValue({
            isListening: false,
            isInitializingProvider: false,
            error: null,
        })
        mockUseEmbeddingStatus.mockReturnValue({ status: { stage: 'idle' } })
    })

    it('shows "Not live" when no live slide is active', () => {
        render(<StatusBar />)
        expect(screen.getByText('Not live')).toBeInTheDocument()
    })

    it('shows live slide name when a slide is live', () => {
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = {
                activeSlides: [{ id: 's1', name: 'Test Slide', type: 'text' }],
                liveSlideId: 's1',
                activeNavSection: null,
                setActiveNavSection: mockSetActiveNavSection,
                contextPanelOpen: false,
                toggleContextPanel: mockToggleContextPanel,
            }
            return selector ? selector(state) : state
        })

        render(<StatusBar />)
        expect(screen.getByText('Test Slide')).toBeInTheDocument()
        expect(screen.getByText('Live')).toBeInTheDocument()
        expect(screen.getByTestId('chip-text')).toBeInTheDocument()
    })

    it('shows "Recording" when sermon listener is active and sermon nav is open', () => {
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = {
                activeSlides: [],
                liveSlideId: null,
                activeNavSection: 'sermon',
                setActiveNavSection: mockSetActiveNavSection,
                contextPanelOpen: false,
                toggleContextPanel: mockToggleContextPanel,
            }
            return selector ? selector(state) : state
        })
        mockUseSermonListenerContext.mockReturnValue({
            isListening: true,
            isInitializingProvider: false,
            error: null,
        })

        render(<StatusBar />)
        expect(screen.getByText('Recording')).toBeInTheDocument()
    })

    it('shows "Listening…" when sermon listener is active but nav is closed', () => {
        mockUseSermonListenerContext.mockReturnValue({
            isListening: true,
            isInitializingProvider: false,
            error: null,
        })

        render(<StatusBar />)
        expect(screen.getByText('Listening…')).toBeInTheDocument()
    })

    it('shows "Indexing" when embeddings are generating', () => {
        mockUseEmbeddingStatus.mockReturnValue({ status: { stage: 'generating' } })

        render(<StatusBar />)
        expect(screen.getByText('Indexing')).toBeInTheDocument()
    })

    it('toggles sermon nav section on sermon button click', () => {
        render(<StatusBar />)
        const sermonBtn = screen.getByTitle('Toggle Sermon Listener')
        fireEvent.click(sermonBtn)
        expect(mockSetActiveNavSection).toHaveBeenCalledWith('sermon')
    })

    it('closes sermon nav section when already open', () => {
        mockUseAppStore.mockImplementation((selector: any) => {
            const state = {
                activeSlides: [],
                liveSlideId: null,
                activeNavSection: 'sermon',
                setActiveNavSection: mockSetActiveNavSection,
                contextPanelOpen: false,
                toggleContextPanel: mockToggleContextPanel,
            }
            return selector ? selector(state) : state
        })

        render(<StatusBar />)
        const sermonBtn = screen.getByTitle('Toggle Sermon Listener')
        fireEvent.click(sermonBtn)
        expect(mockSetActiveNavSection).toHaveBeenCalledWith(null)
    })

    it('toggles context panel on panel button click', () => {
        render(<StatusBar />)
        const panelBtn = screen.getByTitle('Show panel (⌘\\)')
        fireEvent.click(panelBtn)
        expect(mockToggleContextPanel).toHaveBeenCalled()
    })

    it('renders keyboard shortcut hints', () => {
        const { container } = render(<StatusBar />)
        // These are inside `hidden lg:flex` so they're not visible in happy-dom's small viewport
        // but they should still exist in the DOM
        expect(container.textContent).toContain('Navigate')
        expect(container.textContent).toContain('Search')
    })
})
