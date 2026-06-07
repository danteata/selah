/**
 * DesktopOAuthCallback — page mounted at `/desktop-oauth-callback`.
 *
 * When the user completes OAuth in the system browser, Clerk
 * redirects the browser to this URL on the live web build
 * (`https://selah.fly.dev/desktop-oauth-callback?code=...&state=...`).
 *
 * This page mounts Clerk's `<AuthenticateWithRedirectCallback />`
 * component, which reads `?code=...&state=...` from the URL and
 * calls `clerk.handleRedirectCallback()` internally. On success,
 * Clerk's component navigates to `redirectUrlComplete` (which we
 * set in Login/Signup to `/desktop-oauth-done`).
 *
 * On failure or no-op (e.g., user lands on this page directly
 * without an in-flight OAuth flow), we show a friendly message
 * with a link back to the dashboard.
 */

import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import { isDesktop } from '../../platform'

export default function DesktopOAuthCallback() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
            {/* The Clerk component renders nothing visible while it
                processes the callback. It either navigates away on
                success or shows nothing on failure. We render a
                loading state around it as a UX safety net. */}
            <div className="w-full max-w-md text-center">
                <div className="mb-6">
                    <div className="w-8 h-8 mx-auto border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    Completing sign-in…
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    {isDesktop()
                        ? "Finishing up your Google sign-in. You'll return to the Selah app in a moment."
                        : 'Finishing up your sign-in. You can close this tab once it completes.'}
                </p>
            </div>

            {/* Clerk's component handles the actual callback. On
                success it navigates to `fallbackRedirectUrl`. The
                AuthenticateWithRedirectCallback accepts the same
                shape as `handleRedirectCallback`: signInUrl,
                signUpUrl, forceRedirectUrl, fallbackRedirectUrl,
                etc. We pass the done page so the user lands on
                the deep-link button after Clerk finalizes the
                session in the browser. */}
            <AuthenticateWithRedirectCallback
                signInFallbackRedirectUrl="/desktop-oauth-done"
                signUpFallbackRedirectUrl="/desktop-oauth-done"
            />

            {/* Fallback for users who land here without an in-flight
                OAuth (e.g., bookmarked the URL). Renders after a
                short delay via Clerk's status, or never if the
                component navigates away. */}
            <noscript>
                <p>
                    JavaScript is required for sign-in.{' '}
                    <Link to="/">Return home</Link>
                </p>
            </noscript>
        </div>
    )
}
