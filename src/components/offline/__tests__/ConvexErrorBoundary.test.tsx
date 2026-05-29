import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConvexErrorBoundary } from '../ConvexErrorBoundary'

vi.spyOn(console, 'warn').mockImplementation(() => {})

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) throw new Error('exceeded the free plan')
    return <div>ok</div>
}

describe('ConvexErrorBoundary', () => {
    it('renders children when there is no error', () => {
        render(
            <ConvexErrorBoundary>
                <div data-testid="safe">Safe</div>
            </ConvexErrorBoundary>
        )
        expect(screen.getByTestId('safe')).toBeInTheDocument()
    })

    it('does not catch non-Convex errors', () => {
        expect(() => {
            render(
                <ConvexErrorBoundary>
                    {(() => { throw new Error('some random error') })()}
                </ConvexErrorBoundary>
            )
        }).toThrow('some random error')
    })
})
