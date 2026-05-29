import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell } from '../AppShell'

vi.mock('../../store/appStore', () => ({
    useAppStore: vi.fn((selector: any) => {
        const state = {
            openModal: vi.fn(),
            setActiveNavSection: vi.fn(),
            contextPanelOpen: false,
            activeNavSection: null,
            panelMode: 'docked',
            toggleQuickBibleBar: vi.fn(),
        }
        return selector ? selector(state) : state
    }),
}))

vi.mock('../NavRail', () => ({ NavRail: () => <nav data-testid="nav-rail" /> }))
vi.mock('../TopBar', () => ({ TopBar: () => <header data-testid="top-bar" /> }))
vi.mock('../StatusBar', () => ({ StatusBar: () => <footer data-testid="status-bar" /> }))
vi.mock('../ContextPanel', () => ({ ContextPanel: () => <aside data-testid="context-panel" /> }))
vi.mock('../../bible/QuickBibleBar', () => ({ QuickBibleBar: () => <div data-testid="quick-bible" /> }))
vi.mock('../../sermon-listener/SermonListenerContext', () => ({
    SermonListenerProvider: ({ children }: any) => <>{children}</>,
    useSermonListenerContext: vi.fn().mockReturnValue(null),
}))

describe('AppShell', () => {
    it('renders children and shell components', () => {
        render(
            <AppShell isDark={false} onToggleTheme={vi.fn()} user={{ name: 'Test', onSignOut: vi.fn() }}>
                <main data-testid="main-content">Hello</main>
            </AppShell>
        )

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
})
