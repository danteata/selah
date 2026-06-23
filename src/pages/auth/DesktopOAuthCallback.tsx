/**
 * DesktopOAuthCallback — the screen shown while a desktop Google
 * sign-in is being finalized.
 *
 * Flow recap (see `src/hooks/useClerkAuth.ts` and
 * `src-tauri/src/oauth_listener.rs` for the full picture):
 *   1. The user clicks "Continue with Google" in the Tauri webview.
 *   2. We mint a Clerk OAuth URL and open it in the SYSTEM browser.
 *   3. The system browser completes the OAuth and Clerk redirects to
 *      the Rust loopback listener at `localhost:19888` with the
 *      callback params (`__clerk_handshake=...`).
 *   4. The Rust listener navigates the webview to `/?<params>` and
 *      `App.tsx` mounts this screen.
 *
 * `<AuthenticateWithRedirectCallback />` calls
 * `clerk.handleRedirectCallback()` under the hood. That's what
 * redeems the handshake against the webview's own Clerk client and
 * completes the in-progress sign-in created by `signIn.create(...)`.
 * It MUST be mounted unconditionally — the handshake param is exactly
 * the case we get on desktop, and gating it out leaves nothing to
 * complete the sign-in. Once the session lands, `App.tsx` (watching
 * `isSignedIn`) unmounts this screen and routes to the dashboard.
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

export default function DesktopOAuthCallback() {
    const [timedOut, setTimedOut] = useState(false)

    useEffect(() => {
        // Visibility for debugging which params actually arrived in the
        // webview after the Rust listener's navigation.
        if (typeof window !== 'undefined') {
            const params = Array.from(
                new URLSearchParams(window.location.search).keys(),
            )
            console.info('[oauth] callback screen mounted; params:', params)
        }
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

            {/* Redeems the handshake / OAuth callback against the
                webview's Clerk client and completes the sign-in. Mounted
                unconditionally — this is the only thing that finalizes
                the session. */}
            <AuthenticateWithRedirectCallback
                signInFallbackRedirectUrl="/"
                signUpFallbackRedirectUrl="/"
            />
        </div>
    )
}
