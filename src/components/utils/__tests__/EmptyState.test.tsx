import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '../EmptyState'

describe('EmptyState', () => {
    it('renders icon and title', () => {
        render(<EmptyState icon="i-bx-file" sub="No items" />)
        expect(screen.getByText('No items')).toBeInTheDocument()
    })

    it('renders description when provided', () => {
        render(<EmptyState icon="i-bx-file" sub="No items" desc="Add something to get started" />)
        expect(screen.getByText('Add something to get started')).toBeInTheDocument()
    })

    it('does not render description when not provided', () => {
        render(<EmptyState icon="i-bx-file" sub="No items" />)
        expect(screen.queryByText('Add something')).not.toBeInTheDocument()
    })

    it('renders action button with text when action provided', () => {
        const onAction = vi.fn()
        render(
            <EmptyState
                icon="i-bx-file"
                sub="No items"
                actionText="Create New"
                action={onAction}
            />
        )
        expect(screen.getByText('Create New')).toBeInTheDocument()
    })

    it('does not render action button when action is missing', () => {
        render(<EmptyState icon="i-bx-file" sub="No items" actionText="Create" />)
        expect(screen.queryByText('Create')).not.toBeInTheDocument()
    })

    it('calls action on button click', () => {
        const onAction = vi.fn()
        render(
            <EmptyState
                icon="i-bx-file"
                sub="No items"
                actionText="Create New"
                action={onAction}
            />
        )
        fireEvent.click(screen.getByText('Create New'))
        expect(onAction).toHaveBeenCalledTimes(1)
    })

    it('shows plus icon for create/add actions', () => {
        const { container } = render(
            <EmptyState icon="i-bx-file" sub="No items" actionText="Add Item" action={vi.fn()} />
        )
        expect(container.querySelector('svg')).toBeTruthy()
    })
})
