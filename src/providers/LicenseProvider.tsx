/**
 * LicenseProvider — single source of truth for the user's plan entitlements.
 *
 * Desktop (Tauri): entitlements come from a signed license file verified
 * offline by Rust (see src-tauri/src/license.rs). On launch (and periodically)
 * we ask the backend for a fresh license via the Convex `/license` endpoint,
 * passing the Clerk "convex" JWT; if that fails we transparently fall back to
 * the cached license — that offline tolerance is the whole point.
 *
 * Web: there is no offline requirement, so we read the subscription row
 * directly from Convex (`paystack.getMySubscription`).
 *
 * Either way, components consume `useEntitlements()` and gate on `isPro`.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react'
import { useAuth } from '@clerk/clerk-react'
import { entitlementCertainty } from './entitlementState'
import { useAction, useMutation, useQuery, useConvex } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { isDesktop } from '../platform'

// Convex HTTP actions are served from the `.site` origin (the data API uses
// `.convex.cloud`). Mirrors src/hooks/useLatestRelease.ts.
const CONVEX_SITE_URL = (import.meta.env.VITE_CONVEX_URL ?? '').replace(
    /\.convex\.cloud$/,
    '.convex.site'
)

// Re-check the license roughly every 6 hours while the app stays open, so a
// renewal (or cancellation) is picked up without a restart.
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

export type Plan = 'free' | 'pro'

/** Shape returned by the Rust `get_license_status` / `save_license` commands. */
interface RustLicenseStatus {
    valid: boolean
    plan: string
    status: string
    entitled: boolean
    in_grace: boolean
    email: string
    expires_at: string | null
    grace_until: string | null
    reason: string
}

export interface Entitlements {
    plan: Plan
    /** Currently entitled to Pro features (active, or expired-but-in-grace). */
    isPro: boolean
    /** Pro is being conferred by the free trial (status "trialing", still valid). */
    isTrial: boolean
    /** Whole days left in the trial (rounded up), or null when not trialing. */
    trialDaysLeft: number | null
    /** Past `expiresAt` but still inside the offline grace window. */
    inGrace: boolean
    /** End of the paid period (ISO), or null on free. */
    expiresAt: string | null
    /** Raw subscription status string for UI ("active", "past_due", ...). */
    status: string
    loading: boolean
    /** Where the entitlement decision came from. */
    source: 'license' | 'subscription' | 'none'
    /**
     * No licence could be read at all, so "not Pro" here means "couldn't check",
     * not "on the free plan". Gates stay closed either way, but the operator
     * should be offered a retry rather than an upgrade — see `proGateMessage`.
     */
    isUnverified: boolean
    /** Force a re-fetch (e.g. after returning from checkout). */
    refresh: () => Promise<void>
    /** Begin a Pro checkout and open Paystack's hosted page. Pass a discount code. */
    startProCheckout: (promoCode?: string) => Promise<void>
    /** Open Paystack's hosted "manage subscription" page. */
    manageSubscription: () => Promise<void>
    /** Redeem a comp code (free Pro, no payment), then refresh entitlements. */
    redeemComp: (code: string) => Promise<{ success: boolean; expiresAt: string }>
    /** Validate a promo code for the current user (does not redeem). */
    validatePromo: (code: string) => Promise<PromoValidation>
}

export interface PromoValidation {
    valid: boolean
    reason?: string
    kind?: 'comp' | 'discount'
    description?: string
    compDays?: number
    introCycles?: number
}

const DEFAULT: Entitlements = {
    plan: 'free',
    isPro: false,
    isTrial: false,
    trialDaysLeft: null,
    inGrace: false,
    isUnverified: false,
    expiresAt: null,
    status: 'none',
    loading: true,
    source: 'none',
    refresh: async () => {},
    startProCheckout: async () => {},
    manageSubscription: async () => {},
    redeemComp: async () => ({ success: false, expiresAt: '' }),
    validatePromo: async () => ({ valid: false }),
}

const LicenseContext = createContext<Entitlements>(DEFAULT)

export function useEntitlements(): Entitlements {
    return useContext(LicenseContext)
}

/** Whole days from now until `iso` (rounded up, clamped at 0), or null. */
function daysUntil(iso: string | null | undefined): number | null {
    if (!iso) return null
    const ms = new Date(iso).getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

async function openUrl(url: string): Promise<void> {
    if (isDesktop()) {
        // Desktop: hand off to the system browser (keeps the webview/session put).
        const { open } = await import('@tauri-apps/plugin-shell')
        await open(url)
    } else {
        // Web: navigate the current tab. A popup opened via window.open() here
        // would be blocked — it runs after an await (the Convex action), outside
        // the click's user-gesture window. Paystack redirects back to
        // /billing/return when done; the app reloads with the synced plan.
        window.location.assign(url)
    }
}

export function LicenseProvider({ children }: { children: ReactNode }) {
    const { isSignedIn, isLoaded, getToken } = useAuth()
    const convex = useConvex()
    const initializeProCheckout = useAction(api.paystack.initializeProCheckout)
    const getManageLink = useAction(api.paystack.getSubscriptionManageLink)
    const redeemCompAction = useAction(api.promos.redeemComp)
    const ensureTrial = useMutation(api.licensing.ensureTrial)

    // Web path: read the subscription row directly. Skipped on desktop (and
    // when signed out, the query returns null).
    const webSub = useQuery(
        api.paystack.getMySubscription,
        isDesktop() || !isSignedIn ? 'skip' : {}
    )

    const [desktopStatus, setDesktopStatus] = useState<RustLicenseStatus | null>(null)
    const [loading, setLoading] = useState(true)

    // --- desktop: fetch + verify via Rust ---------------------------------
    const refreshDesktop = useCallback(async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        try {
            let status: RustLicenseStatus
            const token = isSignedIn ? await getToken({ template: 'convex' }) : null
            if (token && CONVEX_SITE_URL) {
                status = await invoke<RustLicenseStatus>('fetch_and_store_license', {
                    convexSiteUrl: CONVEX_SITE_URL,
                    token,
                })
            } else {
                // Signed out or no backend configured — evaluate cached license.
                status = await invoke<RustLicenseStatus>('get_license_status')
            }
            setDesktopStatus(status)
        } catch {
            // Last resort: read whatever is cached without crashing the UI.
            try {
                const { invoke: inv } = await import('@tauri-apps/api/core')
                setDesktopStatus(await inv<RustLicenseStatus>('get_license_status'))
            } catch {
                setDesktopStatus(null)
            }
        } finally {
            setLoading(false)
        }
    }, [isSignedIn, getToken])

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    useEffect(() => {
        if (!isDesktop() || !isLoaded) return
        void refreshDesktop()
        intervalRef.current = setInterval(() => void refreshDesktop(), REFRESH_INTERVAL_MS)
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [isLoaded, refreshDesktop])

    // Re-check the license whenever the window regains focus. Checkout opens in
    // the *system browser*, so when the user finishes paying and switches back
    // to the desktop app this picks up the new subscription within seconds
    // (once the Paystack webhook has synced it) — no restart, no 6h wait.
    useEffect(() => {
        if (!isDesktop()) return
        const onFocus = () => void refreshDesktop()
        const onVisible = () => {
            if (document.visibilityState === 'visible') void refreshDesktop()
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            window.removeEventListener('focus', onFocus)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [refreshDesktop])

    // Web loading flips off once the query resolves (undefined → settled).
    useEffect(() => {
        if (!isDesktop()) setLoading(webSub === undefined && !!isSignedIn)
    }, [webSub, isSignedIn])

    // Start (or confirm) the free trial on sign-in. Idempotent server-side, so
    // it's safe to fire on every mount; on desktop we re-fetch the license after
    // so a freshly-granted trial shows up without waiting for the 6h refresh.
    useEffect(() => {
        if (!isLoaded || !isSignedIn) return
        let cancelled = false
        void (async () => {
            try {
                await ensureTrial({})
            } catch {
                // Non-fatal: an existing subscriber or a transient error just
                // means no trial row is created; entitlements resolve as normal.
            }
            if (!cancelled && isDesktop()) await refreshDesktop()
        })()
        return () => {
            cancelled = true
        }
    }, [isLoaded, isSignedIn, ensureTrial, refreshDesktop])

    const refresh = useCallback(async () => {
        if (isDesktop()) await refreshDesktop()
        // Web relies on Convex reactivity; nothing to do.
    }, [refreshDesktop])

    const startProCheckout = useCallback(
        async (promoCode?: string) => {
            // On web, return the user to the origin they started from (prod,
            // a custom domain, or localhost in dev) rather than the fixed
            // PAYSTACK_CALLBACK_URL. On desktop we leave it unset so checkout
            // (in the system browser) falls back to that public return page.
            const callbackUrl = isDesktop()
                ? undefined
                : `${window.location.origin}/#/billing/return?src=web`
            const { authorizationUrl } = await initializeProCheckout({
                ...(promoCode ? { promoCode } : {}),
                ...(callbackUrl ? { callbackUrl } : {}),
            })
            await openUrl(authorizationUrl)
        },
        [initializeProCheckout]
    )

    const manageSubscription = useCallback(async () => {
        const { link } = await getManageLink({})
        if (link) await openUrl(link)
    }, [getManageLink])

    const redeemComp = useCallback(
        async (code: string) => {
            const result = await redeemCompAction({ code })
            await refresh()
            return result
        },
        [redeemCompAction, refresh]
    )

    const validatePromo = useCallback(
        (code: string) => convex.query(api.promos.validatePromo, { code }),
        [convex]
    )

    // --- derive entitlements ----------------------------------------------
    let value: Entitlements
    if (isDesktop()) {
        const s = desktopStatus
        const isPro = !!s && s.plan === 'pro' && s.entitled
        const isTrial = isPro && s?.status === 'trialing'
        value = {
            plan: isPro ? 'pro' : 'free',
            isPro,
            isTrial,
            trialDaysLeft: isTrial ? daysUntil(s?.expires_at) : null,
            inGrace: !!s?.in_grace,
            // No licence file at all — the fetch failed and nothing was cached.
            isUnverified: entitlementCertainty(!!s, loading) === 'unverified',
            expiresAt: s?.expires_at ?? null,
            status: s?.status ?? 'none',
            loading,
            source: s ? 'license' : 'none',
            refresh,
            startProCheckout,
            manageSubscription,
            redeemComp,
            validatePromo,
        }
    } else {
        // Web: Pro while active/non-renewing/past_due and still within period.
        const now = Date.now()
        const withinPeriod =
            !!webSub?.currentPeriodEnd && new Date(webSub.currentPeriodEnd).getTime() > now
        const isPro =
            !!webSub &&
            webSub.plan === 'pro' &&
            webSub.status !== 'cancelled' &&
            (withinPeriod || webSub.status === 'active')
        const isTrial = isPro && webSub?.status === 'trialing'
        value = {
            plan: isPro ? 'pro' : 'free',
            isPro,
            // On the web the subscription query is the only source, and an
            // undefined result means it hasn't answered — the same "couldn't
            // check" as a missing desktop licence.
            isUnverified: entitlementCertainty(webSub !== undefined, loading) === 'unverified',
            isTrial,
            trialDaysLeft: isTrial ? daysUntil(webSub?.currentPeriodEnd) : null,
            inGrace: false,
            expiresAt: webSub?.currentPeriodEnd ?? null,
            status: webSub?.status ?? 'none',
            loading,
            source: webSub ? 'subscription' : 'none',
            refresh,
            startProCheckout,
            manageSubscription,
            redeemComp,
            validatePromo,
        }
    }

    return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>
}
