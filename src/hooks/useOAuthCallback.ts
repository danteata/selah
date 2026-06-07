/**
 * useOAuthCallback — completes Clerk OAuth flow on Tauri desktop.
 *
 * Why this hook exists
 * --------------------
 * On the web build the browser's normal redirect handling works
 * because `window.location.origin` is already http(s). On Tauri
 * desktop there is no such origin — the webview's URL is
 * `tauri://localhost` and Clerk's API refuses any redirect URL that
 * isn't `http://` or `https://` (custom URL schemes like
 * `app.selah.desktop://` are blocked server-side). So we:
 *
 *   1. Call `invoke('start_oauth_listener')` (Rust side, see
 *      `src-tauri/src/oauth_listener.rs`) to spin up a one-shot HTTP
 *      server on `http://localhost:19888` and get the absolute
 *      callback URL back.
 *   2. Expose that URL via `getCallbackUrl()` for the Login/Signup
 *      components to pass to `signIn.authenticateWithRedirect({
 *      redirectUrl })`.
 *   3. Subscribe to the `oauth://callback` Tauri event the Rust
 *      side emits when Clerk's redirect lands on the local server.
 *      The event payload is the path-and-query portion of the
 *      request (`/oauth-callback?code=...&state=...`).
 *   4. Call `clerk.handleRedirectCallback({ redirectUrl: fullUrl })`
 *      to finalize the session and navigate to /dashboard.
 *
 * On the web build, `getCallbackUrl()` returns `null` (no listener
 * is started). The Login/Signup components fall back to the
 * browser-relative `/sso-callback` path, which works in the web
 * build because Clerk's redirect lands on the same origin.
 *
 * Mount this once at the app shell level. It registers a single
 * Tauri event listener for the lifetime of the app; the listener
 * is auto-cleaned on unmount.
 */

import { useCallback, useEffect, useState } from 'react'
import { useClerk } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

const TAURI_OAUTH_CALLBACK_EVENT = 'oauth://callback'
// The Rust side always listens on this port. Must stay in sync
// with OAUTH_LISTENER_PORT in src-tauri/src/oauth_listener.rs.
const OAUTH_LISTENER_PORT = 19888
const OAUTH_CALLBACK_PATH = '/oauth-callback'

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

export interface UseOAuthCallbackReturn {
    /**
     * Absolute callback URL the Login/Signup components should pass
     * to `signIn.authenticateWithRedirect({ redirectUrl })`. Returns
     * `null` on web (use the browser's relative path there) or
     * until the Rust listener has finished binding.
     */
    getCallbackUrl: () => string | null
    /**
     * True if the listener is currently bound and ready to accept
     * a request. Components can disable the "Sign in" button while
     * this is false to avoid handing Clerk a URL the listener isn't
     * listening for.
     */
    isReady: boolean
}

export function useOAuthCallback(): UseOAuthCallbackReturn {
    const clerk = useClerk()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [callbackUrl, setCallbackUrl] = useState<string | null>(null)

    // On Tauri, kick off the listener exactly once. The Rust side
    // is idempotent — if a previous call is still bound, it just
    // returns the same URL.
    useEffect(() => {
        if (!isTauri()) return
        if (callbackUrl !== null) return
        let cancelled = false
        ;(async () => {
            try {
                // Dynamic import so the web bundle doesn't pull in
                // the Tauri event API at all (~10KB savings, and
                // the import path can throw outside Tauri).
                const { invoke } = await import('@tauri-apps/api/core')
                if (cancelled) return
                const url = await invoke<string>('start_oauth_listener')
                if (!cancelled) setCallbackUrl(url)
            } catch (err) {
                console.error('[oauth] failed to start listener', err)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [callbackUrl])

    // Subscribe to the callback event. We register the listener
    // once, regardless of whether the listener is currently bound —
    // if a callback fires from a previous session it'll be a no-op.
    useEffect(() => {
        if (!isTauri()) return
        if (!clerk.loaded) return
        // Skip on web origins — same reason as useDeepLinkOAuth:
        // the Tauri runtime rejects event.listen when the webview
        // is on a non-tauri:// URL (the OAuth handoff state).
        if (typeof window !== 'undefined' && !window.location.protocol.startsWith('tauri')) {
            return
        }
        const clerkInstance = clerk as unknown as {
            handleRedirectCallback: (params: {
                redirectUrl: string
                continueSignIn?: boolean
            }) => Promise<{ status?: string }>
        }

        let unlisten: (() => void) | null = null
        let cancelled = false
        ;(async () => {
            try {
                const { listen } = await import('@tauri-apps/api/event')
                if (cancelled) return
                const handle = await listen<string>(
                    TAURI_OAUTH_CALLBACK_EVENT,
                    async (event) => {
                        const pathAndQuery = event.payload
                        if (typeof pathAndQuery !== 'string') return

                        // Reconstruct the absolute URL Clerk expects.
                        // The Rust side gives us just the path +
                        // query; we prepend the same origin the
                        // callback URL was bound on.
                        const fullUrl = `http://localhost:${OAUTH_LISTENER_PORT}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`

                        console.info('[oauth] callback received:', fullUrl)

                        try {
                            const result = await clerkInstance.handleRedirectCallback({
                                redirectUrl: fullUrl,
                                continueSignIn: true,
                            })
                            const status = (result as { status?: string })?.status
                            if (
                                status === 'complete' ||
                                status === 'signed_in' ||
                                status === 'needs_first_factor' ||
                                status === 'needs_second_factor'
                            ) {
                                queryClient.invalidateQueries()
                                navigate('/dashboard', { replace: true })
                            } else {
                                console.warn(
                                    '[oauth] callback returned unexpected status:',
                                    status
                                )
                            }
                        } catch (err) {
                            console.error(
                                '[oauth] failed to handle callback',
                                err
                            )
                        }
                    }
                )
                unlisten = handle
            } catch (err) {
                // Suppress permission errors from the Tauri runtime
                // when the webview's URL is a non-tauri:// origin
                // (the OAuth handoff state).
                const message = err instanceof Error ? err.message : String(err)
                if (message.includes('not allowed')) return
                console.error('[oauth] failed to subscribe to callback event', err)
            }
        })()

        return () => {
            cancelled = true
            if (unlisten) unlisten()
        }
    }, [clerk, navigate, queryClient])

    const getCallbackUrl = useCallback(() => {
        if (!isTauri()) return null
        return callbackUrl
    }, [callbackUrl])

    // Hardcoded fallback for click handlers that run before this
    // hook has finished its async `invoke()` round-trip. The Rust
    // listener always binds to the same port, so we can hardcode
    // the URL — if the hook's `callbackUrl` hasn't been populated
    // yet, this gives the click handler a guaranteed-correct
    // value instead of falling back to the broken
    // `tauri://localhost/sso-callback` (which Clerk rejects).
    const TAURI_FALLBACK_URL = 'http://localhost:19888/oauth-callback'

    // Expose the URL to non-hook call sites (the Login/Signup click
    // handlers) via a window-level bridge. The fallback initializer
    // above ensures the property exists before this runs.
    useEffect(() => {
        if (typeof window === 'undefined') return
        if (!isTauri()) return
        window.__SELAH_OAUTH_URL__ = getCallbackUrl
        return () => {
            // On unmount restore the no-op so a future non-Tauri
            // call site doesn't get a stale URL.
            window.__SELAH_OAUTH_URL__ = () => null
        }
    }, [getCallbackUrl])

    return {
        getCallbackUrl,
        isReady: callbackUrl !== null,
    }
}

/**
 * Window-side accessor so non-hook call sites (the Login/Signup
 * button onClick handlers) can read the localhost OAuth URL
 * without each one having to call `useOAuthCallback()` separately.
 * The hook writes to this on mount, the click handler reads from
 * it. The web build never writes (the hook is a no-op there) so
 * the value stays `undefined` and the click handler falls back to
 * the same-origin web path.
 */
declare global {
    interface Window {
        __SELAH_OAUTH_URL__?: () => string | null | undefined
    }
}

// Initialize the global accessor to point at our getCallbackUrl.
// The App component calls useOAuthCallback once and sets the
// window-level bridge for descendants. We do this with a tiny
// effect in the hook rather than a side-effect-only module so the
// hook is still the source of truth.
if (typeof window !== 'undefined' && typeof window.__SELAH_OAUTH_URL__ !== 'function') {
    window.__SELAH_OAUTH_URL__ = () => null
}
