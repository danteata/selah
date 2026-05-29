import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBar } from '../TopBar'

vi.mock('../../../hooks/useUserRole', () => ({
    useUserRole: vi.fn(),
}))

vi.mock('../../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: () => ({ isOffline: false }),
}))

vi.mock('../../../hooks/useSchedules', () => ({
    useSchedules: () => ({
        schedules: [],
        activeSchedule: null,
        setActiveSchedule: vi.fn(),
        createSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
        updateSchedule: vi.fn(),
        isLoading: false,
    }),
}))

vi.mock('convex/react', () => ({
    useQuery: vi.fn().mockReturnValue(null),
}))

vi.mock('../../../../convex/_generated/api', () => ({
    api: { presence: { getPresenceByChurch: {} } },
}))

vi.mock('../../live/LiveSessionControls', () => ({
    LiveSessionControls: () => null,
}))

vi.mock('../../live/PresenceAvatars', () => ({
    PresenceAvatars: () => null,
}))

import { useUserRole } from '../../../hooks/useUserRole'

const mockUseUserRole = vi.mocked(useUserRole) as any

describe('TopBar', () => {
    const baseProps = {
        isDark: false,
        onToggleTheme: vi.fn(),
        user: {
            name: 'Test User',
            onSignOut: vi.fn(),
        },
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders the Selah logo', () => {
        mockUseUserRole.mockReturnValue({
            currentUser: { churchId: 'c1', _id: 'u1' },
            canAccessAdmin: false,
        })

        render(<TopBar {...baseProps} />)
        expect(screen.getByText('Selah')).toBeInTheDocument()
    })

    it('shows admin shield icon when canAccessAdmin is true and onToggleAdminPanel is provided', () => {
        mockUseUserRole.mockReturnValue({
            currentUser: { churchId: 'c1', _id: 'u1' },
            canAccessAdmin: true,
        })

        render(<TopBar {...baseProps} showAdminPanel={false} onToggleAdminPanel={vi.fn()} />)
        expect(screen.getByTitle('Admin Panel')).toBeInTheDocument()
    })

    it('does NOT show admin shield icon when canAccessAdmin is false', () => {
        mockUseUserRole.mockReturnValue({
            currentUser: { churchId: 'c1', _id: 'u1' },
            canAccessAdmin: false,
        })

        render(<TopBar {...baseProps} showAdminPanel={false} onToggleAdminPanel={vi.fn()} />)
        expect(screen.queryByTitle('Admin Panel')).not.toBeInTheDocument()
    })

    it('does NOT show admin shield icon when onToggleAdminPanel is missing', () => {
        mockUseUserRole.mockReturnValue({
            currentUser: { churchId: 'c1', _id: 'u1' },
            canAccessAdmin: true,
        })

        render(<TopBar {...baseProps} showAdminPanel={false} />)
        expect(screen.queryByTitle('Admin Panel')).not.toBeInTheDocument()
    })

    it('calls onToggleAdminPanel when shield icon is clicked', () => {
        const onToggle = vi.fn()
        mockUseUserRole.mockReturnValue({
            currentUser: { churchId: 'c1', _id: 'u1' },
            canAccessAdmin: true,
        })

        render(<TopBar {...baseProps} showAdminPanel={false} onToggleAdminPanel={onToggle} />)

        fireEvent.click(screen.getByTitle('Admin Panel'))
        expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('shows user initials in avatar', () => {
        mockUseUserRole.mockReturnValue({
            currentUser: { churchId: 'c1', _id: 'u1' },
            canAccessAdmin: false,
        })

        render(<TopBar {...baseProps} user={{ name: 'John Doe', onSignOut: vi.fn() }} />)
        expect(screen.getByText('J')).toBeInTheDocument()
    })

    it('calls onToggleTheme when theme button is clicked', () => {
        const onToggle = vi.fn()
        mockUseUserRole.mockReturnValue({
            currentUser: { churchId: 'c1', _id: 'u1' },
            canAccessAdmin: false,
        })

        render(<TopBar {...baseProps} isDark={false} onToggleTheme={onToggle} />)

        fireEvent.click(screen.getByTitle('Dark mode'))
        expect(onToggle).toHaveBeenCalledTimes(1)
    })
})
