import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OfflineIndicator } from '../OfflineIndicator'

vi.mock('../../../providers/ConvexConnectionProvider', () => ({
    useConvexConnection: vi.fn(),
}))

import { useConvexConnection } from '../../../providers/ConvexConnectionProvider'

const mockUseConvexConnection = vi.mocked(useConvexConnection) as any

describe('OfflineIndicator', () => {
    it('renders nothing when online', () => {
        mockUseConvexConnection.mockReturnValue({
            isOffline: false,
            connectionState: 'connected',
            isPlanLimit: false,
            retryConnection: vi.fn(),
        })

        const { container } = render(<OfflineIndicator />)
        expect(container.firstChild).toBeNull()
    })

    it('shows offline badge with retry when disconnected', () => {
        const retry = vi.fn()
        mockUseConvexConnection.mockReturnValue({
            isOffline: true,
            connectionState: 'disconnected',
            isPlanLimit: false,
            retryConnection: retry,
        })

        render(<OfflineIndicator />)
        const btn = screen.getByTitle('Offline — click to retry')
        expect(btn).toBeInTheDocument()
        fireEvent.click(btn)
        expect(retry).toHaveBeenCalledTimes(1)
    })

    it('shows reconnecting badge with spinner', () => {
        mockUseConvexConnection.mockReturnValue({
            isOffline: true,
            connectionState: 'reconnecting',
            isPlanLimit: false,
            retryConnection: vi.fn(),
        })

        render(<OfflineIndicator />)
        expect(screen.getByTitle('Reconnecting...')).toBeInTheDocument()
    })

    it('shows plan limit badge with amber styling', () => {
        mockUseConvexConnection.mockReturnValue({
            isOffline: true,
            connectionState: 'disconnected',
            isPlanLimit: true,
            retryConnection: vi.fn(),
        })

        render(<OfflineIndicator />)
        expect(screen.getByTitle('Server unavailable — click to retry')).toBeInTheDocument()
    })
})
