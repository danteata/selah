import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OfflineBanner } from '../OfflineBanner'

vi.mock('../../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: vi.fn(),
}))

import { useConvexConnection } from '../../../providers/ConvexConnectionProvider'

const mockUseConvexConnection = vi.mocked(useConvexConnection) as any

describe('OfflineBanner', () => {
    it('renders nothing when online', () => {
        mockUseConvexConnection.mockReturnValue({
            isOffline: false,
            connectionState: 'connected',
            isPlanLimit: false,
            retryConnection: vi.fn(),
        })

        const { container } = render(<OfflineBanner />)
        expect(container.firstChild).toBeNull()
    })

    it('shows offline message with retry button', () => {
        const retry = vi.fn()
        mockUseConvexConnection.mockReturnValue({
            isOffline: true,
            connectionState: 'disconnected',
            isPlanLimit: false,
            retryConnection: retry,
        })

        render(<OfflineBanner />)
        expect(screen.getByText('Offline')).toBeInTheDocument()
        expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('shows "Reconnecting..." when in reconnecting state', () => {
        mockUseConvexConnection.mockReturnValue({
            isOffline: true,
            connectionState: 'reconnecting',
            isPlanLimit: false,
            retryConnection: vi.fn(),
        })

        render(<OfflineBanner />)
        expect(screen.getByText('Reconnecting...')).toBeInTheDocument()
    })

    it('shows plan limit message when isPlanLimit is true', () => {
        mockUseConvexConnection.mockReturnValue({
            isOffline: true,
            connectionState: 'disconnected',
            isPlanLimit: true,
            retryConnection: vi.fn(),
        })

        render(<OfflineBanner />)
        expect(screen.getByText('Offline — server unavailable')).toBeInTheDocument()
    })

    it('calls retryConnection when retry button is clicked', () => {
        const retry = vi.fn()
        mockUseConvexConnection.mockReturnValue({
            isOffline: true,
            connectionState: 'disconnected',
            isPlanLimit: false,
            retryConnection: retry,
        })

        render(<OfflineBanner />)
        fireEvent.click(screen.getByText('Retry'))
        expect(retry).toHaveBeenCalledTimes(1)
    })
})
