import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ContextPanel } from '../ContextPanel'

vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            activeNavSection: null,
            contextPanelOpen: false,
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

describe('ContextPanel', () => {
    it('renders nothing when panel is closed or no section active', () => {
        const { container } = render(<ContextPanel />)
        expect(container.firstChild).toBeNull()
    })
})
