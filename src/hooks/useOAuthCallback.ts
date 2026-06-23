/**
 * useOAuthCallback — drives the desktop (Tauri) Google OAuth flow.
 *
 * Why this hook exists
 * --------------------
 * Clerk's API only accepts `http(s)` redirect URLs, never custom
 * schemes, and the Tauri webview can't host Clerk's hosted sign-in.
 * So the OAuth happens in the SYSTEM browser against a Rust loopback
 * listener on `http://localhost:19888` (see
 * `src-tauri/src/oauth_listener.rs`):
 *
 *   1. On mount we `invoke('start_oauth_listener')` so the loopback
 *      server is bound before the user clicks.
 *   2. The user clicks "Continue with Google"
 *      (`useClerkAuth.handleGoogleSignIn`), which calls
 *      `signIn.create({ strategy, redirectUrl })` to mint an OAuth URL
 *      and opens it in the OS browser. Crucially, the webview itself
 *      does NOT navigate — the live in-memory `SignIn` stays on the
 *      welcome screen.
 *   3. The system browser completes the OAuth and Clerk redirects it
 *      to the loopback listener.
 *   4. Rust focuses the app window and emits `oauth://callback`. It
 *      does NOT reload the webview.
 *   5. The listener below completes the sign-in IN PLACE: it reloads
 *      the live `SignIn`/`SignUp` (whose first-factor verification was
 *      completed server-side via the OAuth `state`) and calls
 *      `setActive`. No page reload, no handshake redirect, no detour
 *      through Clerk's hosted Account Portal.
 *
 * The earlier approach reloaded the webview to
 * `/?__clerk_handshake=...` and let clerk-js process the handshake.
 * On the packaged `tauri://localhost` origin that consistently
 * redirected the webview to Clerk's hosted "Start building" portal
 * instead of completing in-app, which is why we complete in place now.
 *
 * On the web build the hook is a no-op. Mount it once at the app
 * shell, inside <ClerkProvider>.
 */

import { useEffect, useState } from 'react'
import { useClerk } from '@clerk/clerk-react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { isTauri } from '../platform'

const OAUTH_CALLBACK_EVENT = 'oauth://callback'

export interface UseOAuthCallbackReturn {
    /** True once the Rust loopback listener is bound and ready. */
    isReady: boolean
}

export function useOAuthCallback(): UseOAuthCallbackReturn {
    const clerk = useClerk()
    const upsertUser = useMutation(api.users.upsertUser)
    const [isReady, setIsReady] = useState(false)

    // Bind the loopback listener once on mount.
    useEffect(() => {
        if (!isTauri()) return
        let cancelled = false
        ;(async () => {
            try {
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

    // Complete the OAuth in place when the system-browser flow returns.
    //
    // We trigger on TWO signals for robustness:
    //   - the Rust `oauth://callback` Tauri event (fires the instant the
    //     loopback listener receives Clerk's redirect), and
    //   - the window `focus` event (a plain DOM signal that fires when the
    //     app regains the foreground after the browser — works regardless
    //     of whether Tauri events are delivered on the current origin).
    // `completeOAuthInPlace` is idempotent and a no-op unless there's a
    // freshly-completed OAuth attempt to activate, so firing on both (and
    // on incidental focus changes) is harmless.
    useEffect(() => {
        if (!isTauri()) return
        let unlisten: (() => void) | null = null
        let cancelled = false

        const complete = () =>
            void completeOAuthInPlace(clerk, async (clerkId, fullname, email) => {
                await upsertUser({ clerkId, fullname, email })
            })

        window.addEventListener('focus', complete)
        ;(async () => {
            try {
                const { listen } = await import('@tauri-apps/api/event')
                if (cancelled) return
                unlisten = await listen<string>(OAUTH_CALLBACK_EVENT, complete)
            } catch (err) {
                console.error('[oauth] failed to subscribe to callback event', err)
            }
        })()

        return () => {
            cancelled = true
            window.removeEventListener('focus', complete)
            if (unlisten) unlisten()
        }
    }, [clerk, upsertUser])

    return { isReady }
}

type Clerk = ReturnType<typeof useClerk>

/**
 * Finalize a desktop OAuth sign-in/up using the live in-memory
 * resource. The webview never reloaded, so `clerk.client.signIn` /
 * `signUp` is still the attempt created by `signIn.create(...)`; the
 * OAuth completed its first-factor verification server-side, so a
 * `reload()` surfaces a `complete` status with a session to activate.
 */
async function completeOAuthInPlace(
    clerk: Clerk,
    upsert: (clerkId: string, fullname: string, email: string) => Promise<void>,
): Promise<void> {
    // Already signed in — nothing to finalize. Keeps the `focus`
    // listener cheap (it fires on every foreground gain). Guard on a
    // boolean snapshot so `clerk.user`'s type isn't narrowed for the
    // re-read below (it becomes populated after `setActive`).
    const alreadySignedIn = clerk.user != null
    if (alreadySignedIn) return

    const client = clerk.client
    if (!client) return
    // Only act when there's an in-flight auth attempt; otherwise this is
    // just an incidental focus event with no OAuth to complete.
    const hasPendingSignIn = !!client.signIn?.status && client.signIn.status !== 'complete'
    const hasPendingSignUp = !!client.signUp?.status && client.signUp.status !== 'complete'
    const hasCompletedSignIn = client.signIn?.status === 'complete'
    const hasCompletedSignUp = client.signUp?.status === 'complete'
    if (!hasPendingSignIn && !hasPendingSignUp && !hasCompletedSignIn && !hasCompletedSignUp) {
        return
    }

    const tryComplete = async (
        resource: { status: string | null; createdSessionId: string | null; reload: () => Promise<unknown> } | null | undefined,
    ): Promise<boolean> => {
        if (!resource || !resource.status) return false
        if (resource.status !== 'complete') {
            try {
                await resource.reload()
            } catch (err) {
                console.error('[oauth] failed to reload auth resource', err)
            }
        }
        if (resource.status === 'complete' && resource.createdSessionId) {
            await clerk.setActive({ session: resource.createdSessionId })
            return true
        }
        return false
    }

    const completed =
        (await tryComplete(client.signIn)) || (await tryComplete(client.signUp))

    if (!completed) {
        console.warn(
            '[oauth] resource not complete after reload — the OAuth attempt may have expired',
        )
        return
    }

    // Persist the Convex user row keyed by the Clerk USER id (matches
    // `getUserIdentity().subject` on the backend).
    const user = clerk.user
    const clerkUserId = user?.id
    if (clerkUserId) {
        const email = user?.primaryEmailAddress?.emailAddress ?? ''
        await upsert(clerkUserId, user?.fullName || email.split('@')[0] || 'User', email)
    }
}
