/**
 * useOAuthCallback — spins up the Rust one-shot OAuth listener
 * and (defensively) navigates the Tauri webview to the React
 * callback route if the Rust side emits the `oauth://callback`
 * event before the webview has been redirected.
 *
 * Why this hook exists
 * --------------------
 * On the web build the browser's normal redirect handling works
 * because `window.location.origin` is already http(s). On Tauri
 * desktop there is no such origin — the webview's URL is
 * `tauri://localhost` and Clerk's API refuses any redirect URL
 * that isn't `http://` or `https://` (custom URL schemes like
 * `app.selah.desktop://` are blocked server-side). So we run a
 * one-shot HTTP server on `http://localhost:19888` (Rust side,
 * see `src-tauri/src/oauth_listener.rs`) and the system browser
 * (NOT the Tauri webview) completes the OAuth against that URL.
 *
 *   1. The Tauri webview calls `invoke('start_oauth_listener')`
 *      on mount to spin up the one-shot server and get its URL
 *      back. The hook stores that URL internally.
 *   2. The user clicks "Continue with Google" in
 *      `useClerkAuth.handleGoogleSignIn`, which calls Clerk's
 *      `signIn.create({ strategy, redirectUrl })` to mint an
 *      OAuth URL, then opens that URL in the OS default browser
 *      via `@tauri-apps/plugin-shell` `open()`.
 *   3. The system browser does the OAuth with Clerk's hosted
 *      sign-in and redirects to
 *      `http://localhost:19888/oauth-callback?__clerk_handshake=...`.
 *   4. The Rust listener captures the request, navigates the
 *      Tauri webview to the configured origin (Vite dev URL or
 *      `tauri://localhost` in production) with the handshake
 *      still in the query string, and emits `oauth://callback`
 *      with the path-and-query.
 *   5. `App.tsx`'s top-level `?__clerk_handshake` check sees the
 *      query string and renders `<DesktopOAuthCallback />`,
 *      which decodes the handshake JWT against the Tauri
 *      webview's own Clerk SDK and navigates to the dashboard.
 *   6. The `oauth://callback` event listener below is a backup
 *      that navigates the webview to the same
 *      `/desktop-oauth-callback` route if, for any reason, the
 *      Rust-side webview navigation didn't happen first.
 *
 * On the web build, the hook is a no-op (no listener is
 * started, no event is subscribed). The web Login/Signup pages
 * use the same-origin `/sso-callback` path which Clerk handles
 * natively.
 *
 * Mount this once at the app shell level. It registers a single
 * Tauri event listener for the lifetime of the app; the listener
 * is auto-cleaned on unmount.
 */

import { useEffect, useState } from 'react'

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

export interface UseOAuthCallbackReturn {
    /**
     * True once the Rust loopback listener is bound and ready to
     * accept Clerk's OAuth redirect. Callers can use this to gate
     * the "Continue with Google" button, though the click path also
     * re-invokes `start_oauth_listener` defensively (it's
     * idempotent), so gating is optional.
     */
    isReady: boolean
}

export function useOAuthCallback(): UseOAuthCallbackReturn {
    const [isReady, setIsReady] = useState(false)

    // On Tauri, bind the loopback listener once on mount so it's
    // ready by the time the user clicks "Continue with Google". The
    // Rust side is idempotent — if a previous call is still bound it
    // just returns the same URL.
    //
    // We intentionally do NOT subscribe to the `oauth://callback`
    // event here. The Rust listener navigates the webview to
    // `/?<clerk-params>` directly (origin-correct in dev and prod),
    // and `App.tsx` renders the callback screen off that. An extra
    // JS-side navigation would only race with the Rust one and, in a
    // packaged build, could send the webview to a path the asset
    // server can't serve.
    useEffect(() => {
        if (!isTauri()) return
        let cancelled = false
        ;(async () => {
            try {
                // Dynamic import so the web bundle never pulls in the
                // Tauri core API (the import path throws outside Tauri).
                const { invoke } = await import('@tauri-apps/api/core')
                if (cancelled) return
                await invoke<string>('start_oauth_listener')
                if (!cancelled) setIsReady(true)
            } catch (err) {
                console.error('[oauth] failed to start listener', err)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    return { isReady }
}
