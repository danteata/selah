import { describe, it, expect } from 'vitest'
import { paystackEventKey } from '../../convex/lib/paystackEvents'

const charge = {
    event: 'charge.success',
    data: { id: 3021, reference: 'ref_1', status: 'success', paid_at: '2026-09-01T10:00:00Z' },
}

describe('paystackEventKey', () => {
    it('gives a redelivery the same key', () => {
        const raw = JSON.stringify(charge)
        expect(paystackEventKey(charge, raw)).toBe(paystackEventKey(JSON.parse(raw), raw))
    })

    it('tells two charges apart', () => {
        const other = { ...charge, data: { ...charge.data, id: 3022, reference: 'ref_2' } }
        expect(paystackEventKey(charge, '')).not.toBe(paystackEventKey(other, ''))
    })

    it('keeps the same object under different event types apart', () => {
        const invoice = { event: 'invoice.update', data: charge.data }
        expect(paystackEventKey(charge, '')).not.toBe(paystackEventKey(invoice, ''))
    })

    it('does not swallow a later update to the same invoice', () => {
        // Paystack updates one invoice more than once as it gets paid.
        const pending = { event: 'invoice.update', data: { id: 77, status: 'pending' } }
        const paid = { event: 'invoice.update', data: { id: 77, status: 'success', paid_at: '2026-09-02T09:00:00Z' } }
        expect(paystackEventKey(pending, '')).not.toBe(paystackEventKey(paid, ''))
    })

    it('falls back to the body when the event carries no id', () => {
        const a = { event: 'subscription.not_renew', data: {} }
        expect(paystackEventKey(a, '{"a":1}')).toBe(paystackEventKey(a, '{"a":1}'))
        expect(paystackEventKey(a, '{"a":1}')).not.toBe(paystackEventKey(a, '{"a":2}'))
    })
})
