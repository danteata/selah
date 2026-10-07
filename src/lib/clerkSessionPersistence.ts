/**
 * Keep the desktop app signed in across restarts.
 *
 * On a Clerk development instance, which Selah uses, the browser's sign-in
 * lives under a "dev browser" token. clerk-js keeps it in a `__clerk_db_jwt`
 * cookie on the page's own origin. The desktop webview's origin is
 * `tauri://localhost`, and WebKit doesn't write cookies for a custom scheme
 * to disk. The token survives reloads within one run (the Google sign-in
 * reload relies on that) but is gone after a quit. clerk-js then mints a fresh
 * dev browser with no session, and the app asks for a sign-in every launch.
 *
 * localStorage on that origin does persist, so the token is kept there too:
 *  - save: every Frontend API response passes through the global
 *    `__unstable__onAfterResponse` hook clerk-js calls. By then the request
 *    URL carries the current token, and a rotated one arrives in the
 *    `Clerk-Db-Jwt` header.
 *  - restore: before clerk-js loads, the saved token goes into the page URL.
 *    clerk-js reads `__clerk_db_jwt` from the URL ahead of its cookie, then
 *    strips the parameter.
 *
 * Production instances keep the session on Clerk's own domain instead, so
 * this does nothing for a `pk_live_` key.
 */

const STORAGE_KEY = 'selah:clerk-dev-browser'
const PARAM = '__clerk_db_jwt'
const HEADER = 'Clerk-Db-Jwt'

type AfterResponseHook = (
    request: { url?: URL } | undefined,
    response: { headers?: Headers } | undefined,
) => unknown

declare global {
    interface Window {
        __unstable__onAfterResponse?: AfterResponseHook
    }
}

export function persistClerkDevBrowser(publishableKey: string | undefined, win: Window = window): void {
    if (!('__TAURI_INTERNALS__' in win)) return
    if (!publishableKey?.startsWith('pk_test_')) return

    let saved: string | null = null
    try {
        saved = win.localStorage.getItem(STORAGE_KEY)
    } catch {
        // Storage unavailable: clerk-js falls back to its cookie, as before.
    }

    const url = new URL(win.location.href)
    if (saved && !url.searchParams.has(PARAM)) {
        url.searchParams.set(PARAM, saved)
        win.history.replaceState(win.history.state, '', url)
    }

    const previous = win.__unstable__onAfterResponse
    win.__unstable__onAfterResponse = (request, response) => {
        const token = response?.headers?.get(HEADER) || request?.url?.searchParams.get(PARAM)
        if (token && token !== saved) {
            saved = token
            try {
                win.localStorage.setItem(STORAGE_KEY, token)
            } catch {
                // Not fatal: the session still lasts until the app quits.
            }
        }
        return previous?.(request, response)
    }
}
