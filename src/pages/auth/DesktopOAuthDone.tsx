/**
 * DesktopOAuthDone — page mounted at `/desktop-oauth-done`.
 *
 * Three execution contexts:
 *
 * 1. **Tauri webview** (the OAuth flow ran inside the desktop's
 *    webview). The Clerk callback has already been processed by
 *    `<AuthenticateWithRedirectCallback />` on
 *    `/desktop-oauth-callback`, so the session IS set in this
 *    webview's Clerk SDK. We auto-redirect to `/` (the dashboard)
 *    and let the existing `<SignedIn>` guard render the dashboard.
 *    This is the "one-step" path the user wants — no button click,
 *    no second sign-in, no server-side exchange.
 *
 * 2. **Tauri webview, late landing** (the OAuth ran in the system
 *    browser, the local Rust listener got the callback, the Rust
 *    side pushed the handshake back into the Tauri webview via the
 *    `oauth://callback` event, and `useOAuthCallback` finalized the
 *    session here). The URL may carry `?__clerk_handshake=...` if
 *    Clerk ever does the in-process handoff instead of the event
 *    path. We auto-redirect to `/` once the session lands.
 *
 * 3. **System browser** (the OAuth flow ran externally, e.g. via
 *    `shell.open()` in the Tauri shell plugin, and the user never
 *    came back through the deep link). The session is in the
 *    system browser, NOT in this webview. The Clerk SDK here
 *    has no session, so we show two paths:
 *      a) "Open Selah Desktop" with a `selah://oauth-complete` deep
 *         link — focuses the desktop app (which the user has to
 *         sign in within separately, e.g., via email magic link).
 *      b) "Continue in this browser" — the standard web sign-in flow.
 *
 * The detection is by `isDesktop()` (which checks `window.__TAURI__`
 * in the global). The auto-navigate waits one tick after mount to
 * give the ClerkProvider a chance to re-render the session state
 * after the callback completed on the previous route.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useClerk, useSession } from '@clerk/clerk-react'
import { isDesktop } from '../../platform'

const DESKTOP_DEEP_LINK = 'selah://oauth-complete'

export default function DesktopOAuthDone() {
    const { session, isLoaded } = useSession()
    const clerk = useClerk()
    const navigate = useNavigate()
    // Tracks whether the Tauri event path (`useOAuthCallback` →
    // `clerk.handleRedirectCallback`) is currently running, so the
    // session-poller doesn't race with it and bounce to the manual
    // UI mid-handshake.
    const [handshakeInFlight, setHandshakeInFlight] = useState(false)

    // Late-landing handler: if Clerk's redirect lands directly on
    // this page with `?__clerk_handshake=...` (which can happen when
    // the Tauri webview follows the OAuth navigation itself, e.g.
    // via a form submit that bypasses our `assign` patch), decode
    // the handshake locally so the session lands in this webview's
    // Clerk SDK. Without this, the spinner polls forever and the
    // user is stuck — exactly the symptom reported after the
    // `shell.open()` refactor.
    useEffect(() => {
        if (!isDesktop()) return
        if (typeof window === 'undefined') return
        const params = new URLSearchParams(window.location.search)
        const handshake = params.get('__clerk_handshake')
        if (!handshake) return
        if (!clerk.loaded) return
        if (session) return
        if (handshakeInFlight) return
        let cancelled = false
        setHandshakeInFlight(true)
        ;(async () => {
            try {
                // Reconstruct the absolute URL Clerk's
                // handleRedirectCallback expects. The handshake
                // token is a JWT — Clerk decodes it locally and
                // finalizes the session without a server round
                // trip, which is exactly what we want here.
                const fullUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`
                const result = await (
                    clerk as unknown as {
                        handleRedirectCallback: (params: {
                            redirectUrl: string
                        }) => Promise<{ status?: string }>
                    }
                ).handleRedirectCallback({ redirectUrl: fullUrl })
                if (cancelled) return
                const status = (result as { status?: string })?.status
                if (status && status !== 'complete' && status !== 'signed_in') {
                    console.warn(
                        '[oauth] DesktopOAuthDone handshake returned unexpected status:',
                        status,
                    )
                }
            } catch (err) {
                console.error('[oauth] DesktopOAuthDone handshake failed', err)
            } finally {
                if (!cancelled) setHandshakeInFlight(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [clerk, session, handshakeInFlight])

    // One-step path: when the OAuth ran inside the Tauri webview
    // (so the session IS here) auto-navigate to the dashboard.
    // The ClerkProvider needs a tick to commit the session after
    // `<AuthenticateWithRedirectCallback />` resolves, so we
    // poll the session state on a 200ms interval until it's
    // populated, then route to `/`. Capped at 5s to avoid
    // infinite spinner if something else went wrong.
    useEffect(() => {
        if (!isDesktop()) return
        if (!isLoaded) return
        if (session) {
            // Session already present — navigate immediately.
            navigate('/', { replace: true })
            return
        }
        // Poll for the session to appear.
        const startedAt = Date.now()
        const interval = window.setInterval(() => {
            if (session) {
                window.clearInterval(interval)
                navigate('/', { replace: true })
            } else if (Date.now() - startedAt > 5000) {
                // Give up after 5s — fall through to the manual UI.
                window.clearInterval(interval)
            }
        }, 200)
        return () => window.clearInterval(interval)
    }, [isLoaded, session, navigate])

    // While the auto-navigate is in flight, show a spinner so the
    // user doesn't think the page is broken. Once `session` is
    // truthy, the navigate above will swap the route.
    if (isDesktop() && (isLoaded || handshakeInFlight) && !session) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
                <div className="text-center">
                    <div className="w-8 h-8 mx-auto border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                        Signing you in…
                    </h1>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Finalizing your Google session in Selah.
                    </p>
                </div>
            </div>
        )
    }

    // After the session is set, the navigate() above has already
    // taken the user to `/`. This code only runs in the brief
    // window between mount and the navigate tick, OR on the
    // system browser (isDesktop() is false).
    if (isDesktop() && session) {
        return null
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:to-gray-900 dark:to-gray-800 p-4">
            <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8 text-center">
                {/* Success icon */}
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <svg
                        className="w-8 h-8 text-green-600 dark:text-green-400"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                    >
                        <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a 1 1 0 01-1.414 0l-4-4a 1 1 0 011.414-1.414L8 12.586l7.293-7.293a 1 1 0 011.414 0z"
                            clipRule="evenodd"
                        />
                    </svg>
                </div>

                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                    You're signed in
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                    Your Google sign-in completed successfully in this browser.
                </p>

                {/* System-browser branch: session is here, so the
                    "Continue in this browser" button is the
                    primary CTA. The deep link is a secondary
                    "open in desktop" affordance. */}
                <Link
                    to="/"
                    className="block w-full bg-primary-500 hover:bg-primary-600 text-white font-medium py-3 px-6 rounded-lg transition-colors mb-3"
                >
                    Continue in this browser
                </Link>

                <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                        <span className="bg-white dark:bg-gray-900 px-2 text-gray-500 dark:text-gray-400">
                            or
                        </span>
                    </div>
                </div>

                <a
                    href={DESKTOP_DEEP_LINK}
                    className="block w-full bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium py-2.5 px-6 rounded-lg border border-gray-300 dark:border-gray-600 transition-colors"
                >
                    Open Selah Desktop
                </a>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                    If the Selah desktop app is installed, clicking
                    the button above will focus it. You'll need to
                    sign in within the desktop app (your Google
                    account will be linked to it).
                </p>

                <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
                    You can safely close this tab once the desktop
                    app is open.
                </p>
            </div>
        </div>
    )
}
