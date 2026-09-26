/**
 * BillingReturn — the page Paystack redirects the browser to after checkout.
 *
 * This is a PUBLIC, self-contained confirmation screen. It is deliberately not
 * auth-gated: on desktop the checkout opens in the system browser (which isn't
 * signed into Clerk), so this page loads in a fresh browser context and only
 * needs to reassure the user and send them back to the app.
 *
 * It does NOT grant entitlements — the Paystack webhook is the source of truth
 * (convex/http.ts → applyPaystackEvent). The app reflects the new plan on its
 * own: desktop re-checks the license on window focus, web via Convex reactivity.
 *
 * It does check what happened, though (paystack.verifyCheckout). It used to
 * announce "Payment received" whatever had happened: after a declined card,
 * or on a plain visit with no payment at all.
 */

import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useAction } from 'convex/react'
import { api } from '../../convex/_generated/api'

type Outcome = 'checking' | 'paid' | 'failed' | 'pending' | 'unknown'

const COPY: Record<Outcome, { title: string; body: string }> = {
    checking: { title: 'Confirming your payment…', body: 'Checking with Paystack. This takes a moment.' },
    paid: {
        title: 'Payment received',
        body: 'Thank you — your Selah\u00a0Pro subscription is being activated. This usually takes just a few seconds.',
    },
    pending: {
        title: 'Payment processing',
        body: 'Paystack is still processing this payment. Your Pro plan will appear once it clears.',
    },
    failed: {
        title: "The payment didn't go through",
        body: 'Nothing was charged. You can try again from Billing in Selah.',
    },
    unknown: {
        title: 'Checkout closed',
        body: "We couldn't confirm a payment from this page. If you did pay, your Pro plan will still appear in Selah shortly.",
    },
}

export default function BillingReturn() {
    const [params] = useSearchParams()
    // Paystack appends both on success; either may be the human-facing one.
    const reference = params.get('reference') || params.get('trxref')
    // This page always runs in a plain browser (desktop checkout opens in the
    // system browser), so isDesktop() can't tell us the origin. The checkout
    // tags the callback with ?src=desktop|web instead.
    const cameFromDesktop = params.get('src') === 'desktop'

    const verifyCheckout = useAction(api.paystack.verifyCheckout)
    const [outcome, setOutcome] = useState<Outcome>(reference ? 'checking' : 'unknown')
    useEffect(() => {
        if (!reference) return
        let cancelled = false
        verifyCheckout({ reference })
            .then((result) => { if (!cancelled) setOutcome(result.outcome) })
            .catch(() => { if (!cancelled) setOutcome('unknown') })
        return () => { cancelled = true }
    }, [reference, verifyCheckout])

    const copy = COPY[outcome]
    const succeeded = outcome === 'paid'

    return (
        <div
            className="min-h-screen flex items-center justify-center px-4"
            style={{ background: '#08090c', color: '#fff' }}
        >
            <div
                className="w-full max-w-md rounded-3xl p-8 md:p-10 text-center"
                style={{
                    background:
                        'linear-gradient(180deg, rgba(20,184,166,0.08) 0%, rgba(255,255,255,0.02) 100%)',
                    border: '1px solid rgba(20,184,166,0.25)',
                    boxShadow: '0 40px 80px -20px rgba(0,0,0,0.5), 0 0 80px -20px rgba(20,184,166,0.2)',
                }}
            >
                <div
                    className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full"
                    style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)' }}
                >
                    {succeeded ? (
                    <svg
                        className="h-8 w-8 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                    >
                        <path d="M5 13l4 4L19 7" />
                    </svg>
                    ) : outcome === 'checking' ? (
                        <span className="h-7 w-7 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
                    ) : (
                        <span className="text-2xl font-bold text-white" aria-hidden>{outcome === 'failed' ? '!' : 'i'}</span>
                    )}
                </div>

                <h1 className="mb-3 text-2xl font-bold" style={{ fontFamily: 'Crimson Pro, serif' }} aria-live="polite">
                    {copy.title}
                </h1>
                <p className="mb-2 text-sm leading-relaxed text-zinc-400">{copy.body}</p>

                {(succeeded || outcome === 'pending') && (
                <div className="my-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
                    {cameFromDesktop ? (
                        <p>
                            You can close this tab and <strong>return to the Selah app</strong> — your
                            Pro plan will appear automatically.
                        </p>
                    ) : (
                        <p>
                            You can close this tab and head back to Selah — your Pro plan will appear
                            automatically.
                        </p>
                    )}
                </div>
                )}

                {reference && (
                    <p className="mb-6 text-xs text-zinc-600">
                        Reference: <span className="font-mono text-zinc-500">{reference}</span>
                    </p>
                )}

                {!cameFromDesktop && (
                    <Link
                        to="/"
                        className="group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-[#08090c] transition-all hover:-translate-y-px"
                        style={{
                            background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                            boxShadow:
                                '0 8px 32px -4px rgba(20,184,166,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                        }}
                    >
                        Back to Selah
                    </Link>
                )}

                <p className="mt-6 text-xs text-zinc-600">
                    If your plan doesn’t update within a minute, reopen Selah or contact support with
                    the reference above.
                </p>
            </div>
        </div>
    )
}
