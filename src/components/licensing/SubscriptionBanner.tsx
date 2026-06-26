/**
 * SubscriptionBanner — non-blocking renewal nudges, per the licensing UX:
 *   - within 7 days of expiry  → soft reminder
 *   - past expiry, in grace    → "expired, reconnect to renew" (app still usable)
 *   - past grace               → hard notice with an Upgrade button
 *
 * Render once near the top of the authenticated app shell. Returns null when
 * there's nothing to say (active Pro with >7 days left, or free tier).
 */

import { useState } from 'react'
import { useEntitlements } from '../../providers/LicenseProvider'

const DAY_MS = 24 * 60 * 60 * 1000

function daysUntil(iso: string | null): number | null {
    if (!iso) return null
    return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS)
}

export function SubscriptionBanner() {
    const { plan, isPro, inGrace, expiresAt, status, manageSubscription, startProCheckout } =
        useEntitlements()
    const [dismissed, setDismissed] = useState(false)
    if (dismissed) return null

    const days = daysUntil(expiresAt)

    // Past grace (or otherwise lost Pro while a subscription exists) → hard notice.
    if (!isPro && status !== 'none' && plan !== 'pro') {
        return (
            <Bar tone="red" onClose={() => setDismissed(true)}>
                <span>Your Selah Pro subscription has ended.</span>
                <Action onClick={startProCheckout}>Renew</Action>
            </Bar>
        )
    }

    if (isPro && inGrace) {
        return (
            <Bar tone="amber" onClose={() => setDismissed(true)}>
                <span>
                    Subscription expired — reconnect to renew. Pro stays on for now
                    {days !== null && days >= 0 ? ` (${days} day${days === 1 ? '' : 's'} of grace left)` : ''}.
                </span>
                <Action onClick={manageSubscription}>Manage</Action>
            </Bar>
        )
    }

    if (isPro && days !== null && days <= 7 && days >= 0) {
        return (
            <Bar tone="blue" onClose={() => setDismissed(true)}>
                <span>
                    Your Pro plan renews in {days} day{days === 1 ? '' : 's'}.
                    {status === 'non-renewing' ? ' Auto-renew is off.' : ''}
                </span>
                <Action onClick={manageSubscription}>Manage</Action>
            </Bar>
        )
    }

    return null
}

const TONES = {
    red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-900/15 dark:text-red-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/15 dark:text-amber-300',
    blue: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/15 dark:text-blue-300',
} as const

function Bar({
    tone,
    children,
    onClose,
}: {
    tone: keyof typeof TONES
    children: React.ReactNode
    onClose: () => void
}) {
    return (
        <div
            className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-sm ${TONES[tone]}`}
        >
            <div className="flex items-center gap-2">{children}</div>
            <button
                onClick={onClose}
                aria-label="Dismiss"
                className="rounded px-2 text-base leading-none opacity-60 hover:opacity-100"
            >
                ×
            </button>
        </div>
    )
}

function Action({ onClick, children }: { onClick: () => Promise<void>; children: React.ReactNode }) {
    const [busy, setBusy] = useState(false)
    return (
        <button
            onClick={async () => {
                setBusy(true)
                try {
                    await onClick()
                } catch (e) {
                    console.error('[licensing] action failed', e)
                } finally {
                    setBusy(false)
                }
            }}
            disabled={busy}
            className="rounded-md bg-black/10 px-2.5 py-1 text-xs font-medium hover:bg-black/20 disabled:opacity-60 dark:bg-white/10 dark:hover:bg-white/20"
        >
            {children}
        </button>
    )
}
