import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { Modal } from '../Modal'

describe('Modal', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<Modal isOpen={false} onClose={vi.fn()}>x</Modal>)
        expect(container.firstChild).toBeNull()
    })

    it('moves focus inside, keeps Tab there, and closes on Escape', () => {
        const onClose = vi.fn()
        render(
            <Modal isOpen onClose={onClose} ariaLabel="Test">
                <button>first</button>
                <button>last</button>
            </Modal>,
        )
        const first = screen.getByText('first')
        const last = screen.getByText('last')
        expect(document.activeElement).toBe(first)

        last.focus()
        fireEvent.keyDown(document, { key: 'Tab' })
        expect(document.activeElement).toBe(first)
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
        expect(document.activeElement).toBe(last)

        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes only the top modal on Escape', () => {
        const outer = vi.fn()
        const inner = vi.fn()
        render(
            <>
                <Modal isOpen onClose={outer} ariaLabel="Outer"><button>a</button></Modal>
                <Modal isOpen onClose={inner} ariaLabel="Inner"><button>b</button></Modal>
            </>,
        )
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(inner).toHaveBeenCalledTimes(1)
        expect(outer).not.toHaveBeenCalled()
    })

    it('returns focus to the opener when it closes', () => {
        function Harness() {
            const [open, setOpen] = useState(false)
            return (
                <>
                    <button onClick={() => setOpen(true)}>open</button>
                    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Test">
                        <button>inside</button>
                    </Modal>
                </>
            )
        }
        render(<Harness />)
        const opener = screen.getByText('open')
        opener.focus()
        fireEvent.click(opener)
        expect(document.activeElement).toBe(screen.getByText('inside'))
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(document.activeElement).toBe(opener)
        expect(document.body.style.overflow).toBe('')
    })

    it('returns focus to the opener when a child autofocuses', () => {
        function Harness() {
            const [open, setOpen] = useState(false)
            return (
                <>
                    <button onClick={() => setOpen(true)}>open</button>
                    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Test">
                        <button>first</button>
                        <button autoFocus>chosen</button>
                    </Modal>
                </>
            )
        }
        render(<Harness />)
        const opener = screen.getByText('open')
        opener.focus()
        fireEvent.click(opener)
        expect(document.activeElement).toBe(screen.getByText('chosen'))
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(document.activeElement).toBe(opener)
    })
})
