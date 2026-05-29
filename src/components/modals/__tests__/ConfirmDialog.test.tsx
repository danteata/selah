import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog, useConfirmDialog } from '../ConfirmDialog'

describe('ConfirmDialog', () => {
    const baseProps = {
        isOpen: true,
        title: 'Delete item?',
        message: 'This action cannot be undone.',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
    }

    it('renders nothing when closed', () => {
        const { container } = render(<ConfirmDialog {...baseProps} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders title and message when open', () => {
        render(<ConfirmDialog {...baseProps} />)
        expect(screen.getByText('Delete item?')).toBeInTheDocument()
        expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
    })

    it('calls onConfirm when confirm button clicked', () => {
        render(<ConfirmDialog {...baseProps} />)
        fireEvent.click(screen.getByText('Confirm'))
        expect(baseProps.onConfirm).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when cancel button clicked', () => {
        render(<ConfirmDialog {...baseProps} />)
        fireEvent.click(screen.getByText('Cancel'))
        expect(baseProps.onCancel).toHaveBeenCalledTimes(1)
    })

    it('renders custom button text', () => {
        render(
            <ConfirmDialog
                {...baseProps}
                confirmText="Delete"
                cancelText="Keep"
            />
        )
        expect(screen.getByText('Delete')).toBeInTheDocument()
        expect(screen.getByText('Keep')).toBeInTheDocument()
    })

    it('applies danger styling for danger type', () => {
        render(<ConfirmDialog {...baseProps} type="danger" />)
        const confirmBtn = screen.getByText('Confirm')
        expect(confirmBtn.className).toContain('bg-red-600')
    })

    it('applies warning styling for warning type', () => {
        render(<ConfirmDialog {...baseProps} type="warning" />)
        const confirmBtn = screen.getByText('Confirm')
        expect(confirmBtn.className).toContain('bg-yellow-600')
    })

    it('applies success styling for success type', () => {
        render(<ConfirmDialog {...baseProps} type="success" />)
        const confirmBtn = screen.getByText('Confirm')
        expect(confirmBtn.className).toContain('bg-green-600')
    })

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn()
        const { container } = render(<ConfirmDialog {...baseProps} onClose={onClose} />)
        const backdrop = container.querySelector('.bg-black\\/50')
        expect(backdrop).toBeTruthy()
        fireEvent.click(backdrop!)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when X button is clicked', () => {
        const onCancel = vi.fn()
        const { container } = render(<ConfirmDialog {...baseProps} onCancel={onCancel} />)
        const closeBtn = container.querySelector('button[class*="ml-auto"]')
        expect(closeBtn).toBeTruthy()
        fireEvent.click(closeBtn!)
        expect(onCancel).toHaveBeenCalledTimes(1)
    })
})

describe('useConfirmDialog', () => {
    it('returns confirm function and ConfirmDialog component', () => {
        function TestComponent() {
            const { confirm, ConfirmDialog: Dialog } = useConfirmDialog()
            return (
                <div>
                    <button onClick={() => confirm({ title: 'Test', message: 'Are you sure?' })}>
                        Trigger
                    </button>
                    <Dialog />
                </div>
            )
        }

        render(<TestComponent />)
        expect(screen.getByText('Trigger')).toBeInTheDocument()
    })
})
