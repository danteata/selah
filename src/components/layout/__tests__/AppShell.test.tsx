import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell } from '../AppShell'
import type { NavSection } from '../../../types/studio'

const openModal = vi.fn()
const setActiveNavSection = vi.fn()

let activeNavSection: NavSection | null = null
let contextPanelOpen = false
let panelMode: 'docked' | 'floating' = 'docked'

// NB: three levels up — this file sits in components/layout/__tests__. The
// earlier two-level path silently mocked nothing, so these tests rendered the
// real store and died on the missing Convex provider.
vi.mock('../../../store/appStore', () => ({
    useAppStore: vi.fn((selector?: (state: unknown) => unknown) => {
        const state = {
            openModal,
            setActiveNavSection,
            contextPanelOpen,
            activeNavSection,
            panelMode,
            toggleQuickBibleBar: vi.fn(),
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../NavRail', () => ({ NavRail: () => <nav data-testid="nav-rail" /> }))
vi.mock('../TopBar', () => ({ TopBar: () => <header data-testid="top-bar" /> }))
vi.mock('../StatusBar', () => ({ StatusBar: () => <footer data-testid="status-bar" /> }))
vi.mock('../ContextPanel', () => ({ ContextPanel: () => <aside data-testid="context-panel" /> }))
vi.mock('../MobileBottomNav', () => ({ MobileBottomNav: () => <nav data-testid="mobile-nav" /> }))
vi.mock('../../bible/QuickBibleBar', () => ({ QuickBibleBar: () => <div data-testid="quick-bible" /> }))
vi.mock('../../sermon-listener/SongTrackerBridge', () => ({ SongTrackerBridge: () => null }))
vi.mock('../../sermon-listener/SermonListenerContext', () => ({
    SermonListenerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSermonListenerContext: vi.fn().mockReturnValue(null),
}))

function renderShell() {
    return render(
        <AppShell isDark={false} onToggleTheme={vi.fn()} user={{ name: 'Test', onSignOut: vi.fn() }}>
            <main data-testid="main-content">Hello</main>
        </AppShell>
    )
}

describe('AppShell', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        activeNavSection = null
        contextPanelOpen = false
        panelMode = 'docked'
    })

    it('renders children and shell components', () => {
        renderShell()

        expect(screen.getByTestId('nav-rail')).toBeInTheDocument()
        expect(screen.getByTestId('top-bar')).toBeInTheDocument()
        expect(screen.getByTestId('status-bar')).toBeInTheDocument()
        expect(screen.getByTestId('quick-bible')).toBeInTheDocument()
        expect(screen.getByTestId('main-content')).toBeInTheDocument()
    })

    it('applies dark class when isDark is true', () => {
        const { container } = render(
            <AppShell isDark={true} onToggleTheme={vi.fn()} user={{ name: 'Test', onSignOut: vi.fn() }}>
                <div>Hello</div>
            </AppShell>
        )
        expect(container.querySelector('.dark')).toBeTruthy()
    })

    it('does not apply dark class when isDark is false', () => {
        const { container } = render(
            <AppShell isDark={false} onToggleTheme={vi.fn()} user={{ name: 'Test', onSignOut: vi.fn() }}>
                <div>Hello</div>
            </AppShell>
        )
        expect(container.querySelector('.dark')).toBeFalsy()
    })

    // This is the gate that made the dictionary unreachable: the nav rail set
    // the section and ContextPanel knew how to draw it, but AppShell carried
    // its own allowlist and never mounted the panel.
    describe('context panel mounting', () => {
        it('mounts the panel for an inline section', () => {
            activeNavSection = 'bible'
            contextPanelOpen = true

            renderShell()

            expect(screen.getByTestId('context-panel')).toBeInTheDocument()
        })

        it('mounts the panel for the dictionary section', () => {
            activeNavSection = 'dictionary'
            contextPanelOpen = true

            renderShell()

            expect(screen.getByTestId('context-panel')).toBeInTheDocument()
        })

        it('does not mount the panel when it is collapsed', () => {
            activeNavSection = 'dictionary'
            contextPanelOpen = false

            renderShell()

            expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument()
        })

        it('mounts the panel in floating mode too', () => {
            activeNavSection = 'dictionary'
            contextPanelOpen = true
            panelMode = 'floating'

            renderShell()

            expect(screen.getByTestId('context-panel')).toBeInTheDocument()
        })

        it('opens a modal instead for modal-backed sections', () => {
            activeNavSection = 'settings'
            contextPanelOpen = true

            renderShell()

            expect(openModal).toHaveBeenCalledWith('settings')
            expect(setActiveNavSection).toHaveBeenCalledWith(null)
            expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument()
        })
    })
})
