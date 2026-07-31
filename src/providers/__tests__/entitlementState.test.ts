import { describe, it, expect } from 'vitest'
import { entitlementCertainty, proGateMessage } from '../entitlementState'

describe('entitlementCertainty', () => {
    it('is unverified only when no licence could be read', () => {
        // A licence that says "free" is an answer; no licence at all is not.
        expect(entitlementCertainty(true, false)).toBe('verified')
        expect(entitlementCertainty(false, false)).toBe('unverified')
    })

    it('does not call it unverified while still loading', () => {
        // Otherwise every launch would flash "couldn't check your licence" before
        // the first fetch resolves.
        expect(entitlementCertainty(false, true)).toBe('verified')
    })
})

describe('proGateMessage', () => {
    it('offers a retry when the licence could not be checked', () => {
        // The reported symptom: the same account, Pro on one machine and an upgrade
        // prompt on another, because only one had a cached licence.
        const gate = proGateMessage('unverified', 'NDI output')
        expect(gate.retryable).toBe(true)
        expect(gate.title).toContain("Couldn't check")
        expect(gate.description).toContain('NDI output')
        // Must not tell a paying operator to buy what they already have.
        expect(gate.title.toLowerCase()).not.toContain('upgrade')
        expect(gate.description.toLowerCase()).not.toContain('upgrade')
    })

    it('sells Pro only when the plan is actually known', () => {
        const gate = proGateMessage('verified', 'The alternate output')
        expect(gate.retryable).toBe(false)
        expect(gate.title).toContain('The alternate output')
        expect(gate.title).toContain('Pro')
        expect(gate.description).toContain('Upgrade')
    })
})
