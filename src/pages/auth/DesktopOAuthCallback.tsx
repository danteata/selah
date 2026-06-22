/**
 * DesktopOAuthCallback — the screen shown while a desktop Google
 * sign-in is being finalized.
 *
 * Flow recap (see `src/hooks/useClerkAuth.ts` and
 * `src-tauri/src/oauth_listener.rs` for the full picture):
 *   1. The user clicks "Continue with Google" in the Tauri webview.
 *   2. We mint a Clerk OAuth URL and open it in the SYSTEM browser.
 *   3. The system browser completes the OAuth and Clerk redirects to
 *      the Rust loopback listener at `localhost:19888`.
 *   4. The Rust listener navigates the webview to
 *      `/?<clerk-params>` and `App.tsx` mounts this screen.
 *
 * Completing the sign-in:
 *   - For the handshake architecture (`__clerk_handshake`), the
 *     Clerk SDK processes the param automatically during
 *     `ClerkProvider` load — no component action needed. `App.tsx`
 *     watches `isSignedIn` and unmounts this screen once the session
 *     lands.
 *   - For the older ticket/nonce flow (`rotating_token_nonce` /
 *     `__clerk_ticket` / `code`), we mount
 *     `<AuthenticateWithRedirectCallback />`, which calls
 *     `clerk.handleRedirectCallback()` to finish the exchange.
 *
 * If nothing completes within `TIMEOUT_MS` (network failure, the
 * user closed the browser mid-flow, a misconfigured redirect URL),
 * we surface a clear error with a way back instead of spinning
 * forever.
 */

import { useEffect, useState } from 'react'
import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react'
import { isDesktop } from '../../platform'

const TIMEOUT_MS = 20_000

function hasCodeOrNonceFlow(): boolean {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return (
        params.has('code') ||
        params.has('rotating_token_nonce') ||
        params.has('__clerk_ticket')
    )
}

export default function DesktopOAuthCallback() {
    const [timedOut, setTimedOut] = useState(false)

    useEffect(() => {
        const id = window.setTimeout(() => setTimedOut(true), TIMEOUT_MS)
        return () => window.clearTimeout(id)
    }, [])

    if (timedOut) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
                <div className="w-full max-w-md text-center">
                    <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                        Sign-in didn&apos;t complete
                    </h1>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                        We didn&apos;t hear back from Google. This can happen
                        if the browser tab was closed before finishing. You
                        can try again.
                    </p>
                    <a
                        href="/"
                        className="inline-flex items-center justify-center rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
                    >
                        Back to sign-in
                    </a>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
            <div className="w-full max-w-md text-center">
                <div className="mb-6">
                    <div className="w-8 h-8 mx-auto border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    Completing sign-in…
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    {isDesktop()
                        ? "Finishing up your Google sign-in. You'll land on your dashboard in a moment."
                        : 'Finishing up your sign-in. You can close this tab once it completes.'}
                </p>
            </div>

            {/* Only the code/nonce/ticket flow needs an explicit
                callback exchange. The `__clerk_handshake` flow is
                processed automatically by ClerkProvider, and mounting
                this component without callback params can throw. */}
            {hasCodeOrNonceFlow() && (
                <AuthenticateWithRedirectCallback
                    signInFallbackRedirectUrl="/"
                    signUpFallbackRedirectUrl="/"
                />
            )}
        </div>
    )
}
