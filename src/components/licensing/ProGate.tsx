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
import { useEntitlements, type PromoValidation } from '../../providers/LicenseProvider'

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
    const { startProCheckout, redeemComp, validatePromo } = useEntitlements()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [showPromo, setShowPromo] = useState(false)
    const [code, setCode] = useState('')
    const [checking, setChecking] = useState(false)
    const [promo, setPromo] = useState<PromoValidation | null>(null)

    async function apply() {
        const trimmed = code.trim()
        if (!trimmed) return
        setChecking(true)
        setError(null)
        try {
            setPromo(await validatePromo(trimmed))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not check that code')
        } finally {
            setChecking(false)
        }
    }

    async function act() {
        setBusy(true)
        setError(null)
        try {
            if (promo?.valid && promo.kind === 'comp') {
                await redeemComp(code.trim())
            } else {
                // Pass the code only when it's a valid discount.
                await startProCheckout(promo?.valid && promo.kind === 'discount' ? code.trim() : undefined)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong')
        } finally {
            setBusy(false)
        }
    }

    const isComp = promo?.valid && promo.kind === 'comp'
    const ctaLabel = busy
        ? isComp
            ? 'Activating…'
            : 'Opening checkout…'
        : isComp
          ? `Activate ${promo?.compDays ?? ''} days free`
          : promo?.valid && promo.kind === 'discount'
            ? 'Upgrade with discount'
            : 'Upgrade to Pro'

    return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/40 dark:bg-amber-900/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Selah Pro
            </span>
            <p className="text-sm text-gray-700 dark:text-gray-200">
                {feature ? `${feature} is a Pro feature.` : 'This is a Pro feature.'} Upgrade to
                unlock it.
            </p>

            {showPromo ? (
                <div className="flex w-full max-w-xs flex-col gap-2">
                    <div className="flex gap-2">
                        <input
                            value={code}
                            onChange={(e) => {
                                setCode(e.target.value)
                                setPromo(null)
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && apply()}
                            placeholder="Promo code"
                            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm uppercase tracking-wide text-gray-800 placeholder:normal-case placeholder:tracking-normal dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <button
                            onClick={apply}
                            disabled={checking || !code.trim()}
                            className="rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-60 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                        >
                            {checking ? '…' : 'Apply'}
                        </button>
                    </div>
                    {promo &&
                        (promo.valid ? (
                            <p className="text-xs text-green-600 dark:text-green-400">
                                {promo.kind === 'comp'
                                    ? `Free Pro for ${promo.compDays} days${promo.description ? ` — ${promo.description}` : ''}`
                                    : `Discount applied${promo.introCycles ? ` for ${promo.introCycles} billing cycles` : ''}${promo.description ? ` — ${promo.description}` : ''}`}
                            </p>
                        ) : (
                            <p className="text-xs text-red-600 dark:text-red-400">{promo.reason}</p>
                        ))}
                </div>
            ) : (
                <button
                    onClick={() => setShowPromo(true)}
                    className="text-xs font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
                >
                    Have a promo code?
                </button>
            )}

            <button
                onClick={act}
                disabled={busy}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
            >
                {ctaLabel}
            </button>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
    )
}
