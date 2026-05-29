import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RouteErrorBoundary } from '../RouteErrorBoundary'

// Spy on console.error to verify error logging
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

// Spy on window.location.reload
const reloadSpy = vi.fn()
Object.defineProperty(window, 'location', {
    value: { reload: reloadSpy },
    writable: true,
})

// A component that throws when a prop is set
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) {
        throw new Error('💥 Intentional test explosion')
    }
    return <div data-testid="safe">All clear</div>
}

describe('RouteErrorBoundary', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders children when there is no error', () => {
        render(
            <RouteErrorBoundary>
                <div data-testid="child">Hello</div>
            </RouteErrorBoundary>
        )
        expect(screen.getByTestId('child')).toBeInTheDocument()
        expect(screen.getByText('Hello')).toBeInTheDocument()
    })

    it('renders fallback UI when a child throws', () => {
        render(
            <RouteErrorBoundary>
                <Bomb shouldThrow={true} />
            </RouteErrorBoundary>
        )

        expect(screen.getByText('Something went wrong')).toBeInTheDocument()
        expect(screen.getByText(/Selah hit an unexpected error/)).toBeInTheDocument()
        expect(screen.getByText('Reload Selah')).toBeInTheDocument()
    })

    it('displays the error message (truncated to 240 chars)', () => {
        render(
            <RouteErrorBoundary>
                <Bomb shouldThrow={true} />
            </RouteErrorBoundary>
        )

        expect(screen.getByText('💥 Intentional test explosion')).toBeInTheDocument()
    })

    it('logs error to console.error', () => {
        render(
            <RouteErrorBoundary name="TestRoute">
                <Bomb shouldThrow={true} />
            </RouteErrorBoundary>
        )

        expect(consoleErrorSpy).toHaveBeenCalled()
        const call = consoleErrorSpy.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('[RouteErrorBoundary]')
        )
        expect(call).toBeTruthy()
        expect(call![1]).toBe('TestRoute')
    })

    it('reloads the page when reload button is clicked', () => {
        render(
            <RouteErrorBoundary>
                <Bomb shouldThrow={true} />
            </RouteErrorBoundary>
        )

        fireEvent.click(screen.getByText('Reload Selah'))
        expect(reloadSpy).toHaveBeenCalledTimes(1)
    })

    it('uses "app" as default name when none is provided', () => {
        render(
            <RouteErrorBoundary>
                <Bomb shouldThrow={true} />
            </RouteErrorBoundary>
        )

        const call = consoleErrorSpy.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('[RouteErrorBoundary]')
        )
        expect(call![1]).toBe('app')
    })

    it('does not render children after an error has been caught', () => {
        const { rerender } = render(
            <RouteErrorBoundary>
                <Bomb shouldThrow={true} />
            </RouteErrorBoundary>
        )

        expect(screen.queryByTestId('safe')).not.toBeInTheDocument()

        // Even if we re-render with safe props, the boundary keeps showing the error
        rerender(
            <RouteErrorBoundary>
                <Bomb shouldThrow={false} />
            </RouteErrorBoundary>
        )

        expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })
})
