/**
 * ProGate — gate premium UI behind the Pro entitlement.
 *
 * Usage:
 *   <ProGate>
 *     <SomePremiumPanel />
 *   </ProGate>
 *
 *   // or render-prop / inline check:
 *   const { isPro } = useEntitlements()
 *   if (!isPro) return <ProUpsell />
 *
 * While entitlements are still loading we render children optimistically to
 * avoid a flash of the upsell on every launch; the gate settles once the
 * license/subscription resolves.
 */

import { useState, type ReactNode } from 'react'
import { useEntitlements } from '../../providers/LicenseProvider'

interface ProGateProps {
    children: ReactNode
    /** What to show when the user is not entitled. Defaults to <ProUpsell/>. */
    fallback?: ReactNode
    /** Feature name shown in the default upsell copy. */
    feature?: string
}

export function ProGate({ children, fallback, feature }: ProGateProps) {
    const { isPro, loading } = useEntitlements()
    if (isPro || loading) return <>{children}</>
    return <>{fallback ?? <ProUpsell feature={feature} />}</>
}

export function ProUpsell({ feature }: { feature?: string }) {
    const { startProCheckout } = useEntitlements()
    const [busy, setBusy] = useState(false)

    async function upgrade() {
        setBusy(true)
        try {
            await startProCheckout()
        } catch (e) {
            console.error('[licensing] checkout failed', e)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/40 dark:bg-amber-900/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Selah Pro
            </span>
            <p className="text-sm text-gray-700 dark:text-gray-200">
                {feature ? `${feature} is a Pro feature.` : 'This is a Pro feature.'} Upgrade to
                unlock it.
            </p>
            <button
                onClick={upgrade}
                disabled={busy}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
            >
                {busy ? 'Opening checkout…' : 'Upgrade to Pro'}
            </button>
        </div>
    )
}
