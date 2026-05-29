import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashboardHeader } from '../DashboardHeader'

vi.mock('../../layout/ChurchContext', () => ({
    ChurchContext: function ChurchContext() { return null },
}))

describe('DashboardHeader', () => {
    const baseProps = {
        isDark: false,
        onToggleTheme: vi.fn(),
        showSermonListener: false,
        onToggleSermonListener: vi.fn(),
        user: { name: 'John Doe', onSignOut: vi.fn() },
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders Selah logo', () => {
        render(<DashboardHeader {...baseProps} />)
        expect(screen.getByText('Selah')).toBeInTheDocument()
    })

    it('renders active schedule name when provided', () => {
        render(
            <DashboardHeader
                {...baseProps}
                activeSchedule={{ _id: 's1', name: 'Sunday Service', updatedAt: '', churchId: '', authorId: '', editorIds: [] }}
            />
        )
        expect(screen.getByText('Sunday Service')).toBeInTheDocument()
    })

    it('does not show schedule badge when no active schedule', () => {
        render(<DashboardHeader {...baseProps} />)
        expect(screen.queryByText('Sunday Service')).not.toBeInTheDocument()
    })

    it('calls onToggleSermonListener when mic button is clicked', () => {
        render(<DashboardHeader {...baseProps} />)
        const micBtn = screen.getByTitle('Sermon Listener')
        fireEvent.click(micBtn)
        expect(baseProps.onToggleSermonListener).toHaveBeenCalledTimes(1)
    })

    it('shows active mic indicator when showSermonListener is true', () => {
        const { container } = render(
            <DashboardHeader {...baseProps} showSermonListener={true} />
        )
        const micBtn = screen.getByTitle('Sermon Listener')
        expect(micBtn.className).toContain('bg-')
    })

    it('calls onToggleTheme when theme button is clicked', () => {
        render(<DashboardHeader {...baseProps} />)
        const themeBtn = screen.getByTitle('Switch to dark mode')
        fireEvent.click(themeBtn)
        expect(baseProps.onToggleTheme).toHaveBeenCalledTimes(1)
    })

    it('shows admin shield when canAccessAdmin and onToggleAdminPanel are provided', () => {
        render(
            <DashboardHeader
                {...baseProps}
                canAccessAdmin={true}
                onToggleAdminPanel={vi.fn()}
            />
        )
        expect(screen.getByTitle('Admin Panel')).toBeInTheDocument()
    })

    it('does not show admin shield when canAccessAdmin is false', () => {
        render(<DashboardHeader {...baseProps} />)
        expect(screen.queryByTitle('Admin Panel')).not.toBeInTheDocument()
    })

    it('shows user initials in avatar', () => {
        render(<DashboardHeader {...baseProps} />)
        expect(screen.getByText('J')).toBeInTheDocument()
    })

    it('opens user menu on click', () => {
        render(<DashboardHeader {...baseProps} />)
        const userBtn = screen.getByText('John Doe')
        fireEvent.click(userBtn)
        expect(screen.getByText('Profile')).toBeInTheDocument()
        expect(screen.getByText('Settings')).toBeInTheDocument()
        expect(screen.getByText('Sign Out')).toBeInTheDocument()
    })

    it('calls user.onSignOut when sign out is clicked', () => {
        render(<DashboardHeader {...baseProps} />)
        fireEvent.click(screen.getByText('John Doe'))
        fireEvent.click(screen.getByText('Sign Out'))
        expect(baseProps.user.onSignOut).toHaveBeenCalledTimes(1)
    })
})
