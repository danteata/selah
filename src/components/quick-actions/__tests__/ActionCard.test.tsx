import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionCard } from '../ActionCard'

describe('ActionCard', () => {
    const baseAction = {
        name: 'New Bible Slide',
        desc: 'Create a scripture slide',
        action: 'bible:1',
        icon: 'i-bx-bible',
        type: 'bible' as const,
    }

    it('renders action name and description', () => {
        render(
            <ActionCard
                action={baseAction}
                dataActionIndex={0}
                isFocused={false}
                onClick={vi.fn()}
            />
        )
        expect(screen.getByText('New Bible Slide')).toBeInTheDocument()
        expect(screen.getByText('Create a scripture slide')).toBeInTheDocument()
    })

    it('renders icon for the action', () => {
        const { container } = render(
            <ActionCard
                action={baseAction}
                dataActionIndex={0}
                isFocused={false}
                onClick={vi.fn()}
            />
        )
        // The icon is rendered as an SVG inside the button
        expect(container.querySelector('svg')).toBeTruthy()
    })

    it('calls onClick when clicked', () => {
        const onClick = vi.fn()
        render(
            <ActionCard
                action={baseAction}
                dataActionIndex={0}
                isFocused={false}
                onClick={onClick}
            />
        )
        fireEvent.click(screen.getByText('New Bible Slide').closest('button')!)
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('shows focused styling when isFocused is true', () => {
        const { container } = render(
            <ActionCard
                action={baseAction}
                dataActionIndex={0}
                isFocused={true}
                onClick={vi.fn()}
            />
        )
        const button = container.querySelector('button')
        expect(button?.className).toContain('bg-blue-50')
    })

    it('does not show focused styling when isFocused is false', () => {
        const { container } = render(
            <ActionCard
                action={baseAction}
                dataActionIndex={0}
                isFocused={false}
                onClick={vi.fn()}
            />
        )
        const button = container.querySelector('button')
        expect(button?.className).not.toContain('bg-blue-50')
    })

    it('shows Pro badge for pro tier actions', () => {
        render(
            <ActionCard
                action={{ ...baseAction, tier: 'pro' }}
                dataActionIndex={0}
                isFocused={false}
                onClick={vi.fn()}
            />
        )
        expect(screen.getByText('Pro')).toBeInTheDocument()
    })

    it('does not show Pro badge for non-pro actions', () => {
        render(
            <ActionCard
                action={baseAction}
                dataActionIndex={0}
                isFocused={false}
                onClick={vi.fn()}
            />
        )
        expect(screen.queryByText('Pro')).not.toBeInTheDocument()
    })

    it('renders with correct data-action-index', () => {
        const { container } = render(
            <ActionCard
                action={baseAction}
                dataActionIndex={5}
                isFocused={false}
                onClick={vi.fn()}
            />
        )
        const button = container.querySelector('button')
        expect(button).toHaveAttribute('data-action-index', '5')
    })

    it('uses FileText icon as fallback for unknown icon names', () => {
        const { container } = render(
            <ActionCard
                action={{ ...baseAction, icon: 'i-unknown-icon' }}
                dataActionIndex={0}
                isFocused={false}
                onClick={vi.fn()}
            />
        )
        // FileText is the default fallback icon
        expect(container.querySelector('svg')).toBeTruthy()
    })
})
