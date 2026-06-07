/**
 * useDeepLinkOAuth — handles the `selah://...` deep link the OS
 * hands back to the app after the browser OAuth flow completes.
 *
 * Flow on desktop (Tauri):
 *   1. User clicks "Sign in with Google" in the desktop app.
 *   2. Frontend calls `signIn.authenticateWithRedirect({ redirectUrl:
 *      'https://selah.fly.dev/desktop-oauth-callback' })` — this
 *      URL IS allowed by Clerk because selah.fly.dev is the dev
 *      instance's preconfigured origin.
 *   3. The system browser opens at Clerk's hosted sign-in. The
 *      user does OAuth there.
 *   4. Clerk redirects the browser to
 *      `https://selah.fly.dev/desktop-oauth-callback?code=...&state=...`
 *      which the Vite SPA serves as `index.html`. The React app
 *      mounts `<AuthenticateWithRedirectCallback />` on that route,
 *      which finalizes the session in the BROWSER.
 *   5. The React app then navigates to `/desktop-oauth-done`, a
 *      page that shows a "Open Selah Desktop" button. The button's
 *      href is `selah://oauth-complete`.
 *   6. User clicks the button. macOS routes the `selah://` scheme
 *      to the running Selah app (or launches it cold). The deep-link
 *      plugin on the Rust side emits `oauth://deep-link` with the URL.
 *   7. THIS hook catches the event and marks the app as "deep link
 *      received". The frontend can use this signal to refresh
 *      its auth state — though note that the Clerk session lives
 *      in the BROWSER, not the desktop's webview, so the desktop
 *      user still has to sign in within the desktop's webview
 *      (e.g., via email-magic-link or a one-time sign-in token).
 *      See `DesktopAuthPrompt` for the UX that follows this hook.
 *
 * On the web build, this hook is a no-op (no `__TAURI__` in window).
 * The normal Clerk `<AuthenticateWithRedirectCallback />` on the
 * OAuth callback route handles the session.
 */

import { useEffect } from 'react'

const TAURI_DEEP_LINK_EVENT = 'oauth://deep-link'

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

export interface UseDeepLinkOAuthOptions {
    /**
     * Called with the raw `selah://...` URL whenever the OS hands
     * the app a deep link. Default behavior: log it. Components
     * can override to update their state machine (e.g., dismiss a
     * "waiting for OAuth" indicator).
     */
    onDeepLink?: (url: string) => void
}

/**
 * `selah://oauth-complete` — the only deep link we currently
 * emit. Exported so the corresponding web page and the desktop
 * `DesktopAuthPrompt` component can both reference it from a
 * single source of truth.
 */
export const DEEP_LINK_OAUTH_COMPLETE = 'selah://oauth-complete'

export function useDeepLinkOAuth(options: UseDeepLinkOAuthOptions = {}): void {
    const { onDeepLink } = options

    useEffect(() => {
        if (!isTauri()) return
        // The Tauri runtime rejects event.listen when the webview's
        // current URL is not a Tauri origin (e.g., it has navigated
        // to https://selah.fly.dev/... during the OAuth handoff).
        // That's expected — we only need the listener active when
        // the webview is back on the local tauri:// origin. Skip
        // the subscribe on web origins rather than spamming the
        // console with a permission error.
        if (typeof window !== 'undefined' && !window.location.protocol.startsWith('tauri')) {
            return
        }

        let unlisten: (() => void) | null = null
        let cancelled = false

        ;(async () => {
            try {
                // Dynamic import so the web bundle doesn't pull in
                // the Tauri event API (~10KB and the import path
                // can throw outside Tauri).
                const { listen } = await import('@tauri-apps/api/event')
                if (cancelled) return
                const handle = await listen<string>(
                    TAURI_DEEP_LINK_EVENT,
                    (event) => {
                        const url = event.payload
                        if (typeof url !== 'string') return
                        if (!url.startsWith('selah://')) return
                        console.info('[oauth] deep-link received:', url)
                        if (onDeepLink) onDeepLink(url)
                    }
                )
                unlisten = handle
            } catch (err) {
                // Suppress permission errors from the Tauri runtime
                // when the webview's URL doesn't match the
                // capability's allowlist. This is the case during
                // the OAuth handoff (webview is on the fly.io
                // callback URL); the hook is irrelevant there.
                const message = err instanceof Error ? err.message : String(err)
                if (message.includes('not allowed')) return
                console.error('[oauth] failed to subscribe to deep-link event', err)
            }
        })()

        return () => {
            cancelled = true
            if (unlisten) unlisten()
        }
    }, [onDeepLink])
}
