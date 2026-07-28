import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContextPanel } from '../ContextPanel'

let activeNavSection: string | null = null
let contextPanelOpen = false

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            activeNavSection,
            contextPanelOpen,
            contextPanelWidth: 300,
            panelMode: 'docked',
            panelPosition: { x: 0, y: 0 },
            setActiveNavSection: vi.fn(),
            setContextPanelWidth: vi.fn(),
            setPanelMode: vi.fn(),
            setPanelPosition: vi.fn(),
            appendActiveSlide: vi.fn(),
            updateActiveSlide: vi.fn(),
            activeSchedule: null,
            editingSlide: null,
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../../dictionary/DictionaryPanel', () => ({
    DictionaryPanel: () => <div data-testid="dictionary-panel">Dictionary</div>,
}))

describe('ContextPanel', () => {
    beforeEach(() => {
        activeNavSection = null
        contextPanelOpen = false
    })

    it('renders nothing when panel is closed or no section active', () => {
        const { container } = render(<ContextPanel />)
        expect(container.firstChild).toBeNull()
    })

    // The Studio shell reaches content through the nav rail, so this is the
    // only path to the dictionary on desktop.
    it('renders the dictionary panel for the dictionary section', () => {
        activeNavSection = 'dictionary'
        contextPanelOpen = true

        render(<ContextPanel />)

        expect(screen.getByTestId('dictionary-panel')).toBeInTheDocument()
    })
})
