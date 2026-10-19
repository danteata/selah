import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const h = vi.hoisted(() => ({ isAdmin: true }))
vi.mock('../../../providers/LicenseProvider', () => ({
    useEntitlements: () => ({
        plan: 'pro', isPro: true, isTrial: true, trialDaysLeft: 14, inGrace: false,
        expiresAt: null, status: 'trialing', manageSubscription: vi.fn(), startProCheckout: vi.fn(),
    }),
}))
vi.mock('../../../hooks/useUserRole', () => ({ useUserRole: () => ({ isAdmin: h.isAdmin }) }))

import { SubscriptionBanner } from '../SubscriptionBanner'

describe('SubscriptionBanner', () => {
    beforeEach(() => {
        h.isAdmin = true
        localStorage.clear()
    })

    it("tells an admin about the trial", () => {
        render(<SubscriptionBanner />)
        expect(screen.getByText(/14 days left in your free Pro trial/)).toBeInTheDocument()
    })

    it("doesn't take a member's screen with an upgrade they can't make", () => {
        h.isAdmin = false
        render(<SubscriptionBanner />)
        expect(screen.queryByText(/free Pro trial/)).toBeNull()
    })

    it('stays closed for the rest of the day once closed', () => {
        const { unmount } = render(<SubscriptionBanner />)
        fireEvent.click(screen.getByRole('button', { name: /dismiss|close/i }))
        expect(screen.queryByText(/free Pro trial/)).toBeNull()
        unmount()
        render(<SubscriptionBanner />)
        expect(screen.queryByText(/free Pro trial/)).toBeNull()
    })
})
