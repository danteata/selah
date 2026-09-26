import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const verify = vi.fn()
vi.mock('convex/react', () => ({ useAction: () => verify }))

import BillingReturn from '../BillingReturn'

function renderAt(url: string) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <BillingReturn />
        </MemoryRouter>,
    )
}

describe('BillingReturn', () => {
    beforeEach(() => verify.mockReset())

    it('confirms a payment Paystack reports as paid', async () => {
        verify.mockResolvedValue({ outcome: 'paid' })
        renderAt('/billing/return?reference=ref_12345')
        expect(await screen.findByText('Payment received')).toBeInTheDocument()
        expect(verify).toHaveBeenCalledWith({ reference: 'ref_12345' })
    })

    it('does not claim success for a failed payment', async () => {
        verify.mockResolvedValue({ outcome: 'failed' })
        renderAt('/billing/return?reference=ref_12345')
        expect(await screen.findByText("The payment didn't go through")).toBeInTheDocument()
        expect(screen.queryByText('Payment received')).not.toBeInTheDocument()
    })

    it('stays neutral with no payment reference at all', () => {
        renderAt('/billing/return')
        expect(screen.getByText('Checkout closed')).toBeInTheDocument()
        expect(verify).not.toHaveBeenCalled()
    })
})
