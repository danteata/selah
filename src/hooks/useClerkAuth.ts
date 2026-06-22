import { useState } from 'react'
import { useSignIn, useSignUp, useClerk } from '@clerk/clerk-react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'

export type AuthMode = 'signin' | 'signup'

// Hardcoded callback URL for Tauri. Must stay in sync with
// `OAUTH_LISTENER_PORT` + `OAUTH_CALLBACK_PATH` in
// `src-tauri/src/oauth_listener.rs`. Clerk requires the redirect
// URL be `http` or `https` (rejects `tauri://` and any other
// custom scheme with `invalid_url_scheme`), so we point it at
// the Rust one-shot listener which then navigates the Tauri
// webview back to the React app with the handshake in the query.
// Exported so other call sites (e.g. `pages/auth/Signup.tsx`,
// which uses Clerk's hooks directly) can reuse it without going
// through this hook.
export const TAURI_OAUTH_REDIRECT_URL = 'http://localhost:19888/oauth-callback'

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
}

function getOAuthRedirectUrl(): string {
    if (isTauri()) {
        return TAURI_OAUTH_REDIRECT_URL
    }
    return `${window.location.origin}/sso-callback`
}

function getOAuthRedirectComplete(): string {
    return '/'
}

// Clerk's SignIn/SignUp responses carry the OAuth URL in
// different fields depending on which resource was created:
//   - signIn: firstFactorVerification.externalVerificationRedirectURL
//   - signUp: verifications.externalAccount.externalVerificationRedirectURL
// We probe both shapes because the Clerk React SDK type union
// only narrows the variant after a `strategy` check that we
// don't have access to here.
// Exported for reuse by other call sites that drive the Tauri
// OAuth flow directly (see `pages/auth/Signup.tsx`).
export function getExternalVerificationRedirectURL(
    result: unknown,
): string | null {
    if (!result || typeof result !== 'object') return null
    const r = result as {
        firstFactorVerification?: { externalVerificationRedirectURL?: unknown }
        verifications?: { externalAccount?: { externalVerificationRedirectURL?: unknown } }
    }
    const fromSignIn = r.firstFactorVerification?.externalVerificationRedirectURL
    const fromSignUp = r.verifications?.externalAccount?.externalVerificationRedirectURL
    const url = fromSignIn ?? fromSignUp
    // Clerk types this field as `URL | null` — it's a `URL`
    // instance, NOT a string. The previous `typeof url === 'string'`
    // check therefore always failed, so this returned `null`, the
    // caller threw "Clerk did not return an OAuth redirect URL", and
    // the click silently did nothing. Accept both shapes.
    if (url instanceof URL) return url.toString()
    if (typeof url === 'string' && url.length > 0) return url
    return null
}

// Opens the system browser to complete the OAuth flow on Tauri.
//
// Why this exists
// ---------------
// The Clerk Account Portal expects the OAuth flow to run in a
// real browser that can hand the result back via
// `window.opener.postMessage(...)`. Inside the Tauri webview,
// `window.opener` resolves to the webview itself, and the
// webview has already navigated to Clerk's domain — so the
// React app / Clerk SDK is unmounted, there's no listener, and
// the `postMessage` is dropped. The user is stuck on Clerk's
// "Welcome" page forever.
//
// The fix is to NOT do the OAuth in the webview at all. Instead
// we use Clerk's low-level `signIn.create({ strategy,
// redirectUrl })` to mint an OAuth URL (no navigation) and hand
// the URL to the OS default browser via
// `@tauri-apps/plugin-shell`'s `open()`. The system browser
// does the OAuth and lands on the Rust listener at
// `http://localhost:19888/oauth-callback?__clerk_handshake=...`.
// The Rust listener then navigates the Tauri webview to the
// React app with the handshake in the query string. `App.tsx`
// reads the query string and renders `<DesktopOAuthCallback />`
// directly, which decodes the handshake against the Tauri
// webview's own Clerk SDK and lands the user on the dashboard.
//
// On the web build, the Tauri branch isn't taken — the
// `isTauri()` check is false and we fall back to the standard
// `signIn.authenticateWithRedirect(...)` flow, which works
// because the browser is the OAuth surface.
async function startTauriOAuth(
    createAttempt: (params: {
        strategy: 'oauth_google'
        redirectUrl: string
    }) => Promise<unknown>,
): Promise<void> {
    // Dynamic imports so the web bundle doesn't pull in the
    // Tauri shell / core APIs.
    const { invoke } = await import('@tauri-apps/api/core')
    const { open } = await import('@tauri-apps/plugin-shell')
    // Ensure the Rust one-shot listener is bound. Idempotent — if
    // a listener is already running, this just returns its URL.
    // `useOAuthCallback` also calls this on App mount, so by the
    // time the user clicks Google the listener is usually
    // already up; this call is the safety net.
    await invoke('start_oauth_listener')
    // Create the sign-in / sign-up attempt. Clerk mints the
    // OAuth URL using the provided `redirectUrl` as the callback
    // target, but does NOT navigate the webview — it just
    // returns the attempt state.
    const result = await createAttempt({
        strategy: 'oauth_google',
        redirectUrl: getOAuthRedirectUrl(),
    })
    const oauthUrl = getExternalVerificationRedirectURL(result)
    if (!oauthUrl) {
        throw new Error(
            'Clerk did not return an OAuth redirect URL. ' +
                'Check that oauth_google is enabled on your Clerk ' +
                'instance and that http://localhost:19888 is on the ' +
                'allowed redirect list.',
        )
    }
    await open(oauthUrl)
}

export function useClerkAuth(mode: AuthMode) {
    const { signIn, isLoaded: signInLoaded } = useSignIn()
    const { signUp, isLoaded: signUpLoaded } = useSignUp()
    const { setActive } = useClerk()

    const upsertUser = useMutation(api.users.upsertUser)
    const createChurch = useMutation(api.churches.createChurch)
    const joinChurch = useMutation(api.churches.joinChurch)

    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    const isLoaded = mode === 'signin' ? signInLoaded : signUpLoaded

    const handleEmailSignIn = async (email: string, password: string) => {
        if (!signIn || !isLoaded) return false
        setIsLoading(true)
        setError('')
        try {
            const result = await signIn.create({ identifier: email, password })
            if (result.status === 'complete' && result.createdSessionId) {
                await setActive({ session: result.createdSessionId })
                await upsertUser({ clerkId: result.createdSessionId, fullname: email.split('@')[0], email })
                return true
            }
            return false
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to sign in. Please check your credentials.'
            setError((err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message || message)
            return false
        } finally {
            setIsLoading(false)
        }
    }

    const handleGoogleSignIn = async () => {
        if (!signIn || !isLoaded) return
        setIsLoading(true)
        setError('')
        try {
            if (isTauri()) {
                // System-browser flow — see `startTauriOAuth` for
                // the full rationale.
                await startTauriOAuth((params) => signIn.create(params))
            } else {
                // Web flow — Clerk's hosted sign-in loads in this
                // same tab and the OAuth callback lands on the
                // same-origin `/sso-callback` route, which the
                // App's <ClerkProvider> handles natively.
                await signIn.authenticateWithRedirect({
                    strategy: 'oauth_google',
                    redirectUrl: getOAuthRedirectUrl(),
                    redirectUrlComplete: getOAuthRedirectComplete(),
                })
            }
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : 'Failed to sign in with Google.'
            setError(
                (err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message || message,
            )
        } finally {
            setIsLoading(false)
        }
    }

    const handleEmailSignUp = async (fullName: string, email: string, password: string) => {
        if (!signUp || !isLoaded) return null
        setIsLoading(true)
        setError('')
        try {
            await signUp.create({
                emailAddress: email,
                password,
                firstName: fullName.split(' ')[0],
                lastName: fullName.split(' ').slice(1).join(' '),
            })
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
            return 'verify'
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create account.'
            setError((err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message || message)
            return null
        } finally {
            setIsLoading(false)
        }
    }

    const handleGoogleSignUp = async () => {
        if (!signUp || !isLoaded) return
        setIsLoading(true)
        setError('')
        try {
            if (isTauri()) {
                // System-browser flow — see `startTauriOAuth` for
                // the full rationale.
                await startTauriOAuth((params) => signUp.create(params))
            } else {
                await signUp.authenticateWithRedirect({
                    strategy: 'oauth_google',
                    redirectUrl: getOAuthRedirectUrl(),
                    redirectUrlComplete: getOAuthRedirectComplete(),
                })
            }
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : 'Failed to sign up with Google.'
            setError(
                (err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message || message,
            )
        } finally {
            setIsLoading(false)
        }
    }

    const handleVerification = async (code: string) => {
        if (!signUp || !isLoaded) return null
        setIsLoading(true)
        setError('')
        try {
            const result = await signUp.attemptEmailAddressVerification({ code })
            if (result.status === 'complete' && result.createdSessionId) {
                await setActive({ session: result.createdSessionId })
                return result.createdSessionId
            }
            return null
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Invalid verification code.'
            setError((err as { errors?: Array<{ message?: string }> }).errors?.[0]?.message || message)
            return null
        } finally {
            setIsLoading(false)
        }
    }

    const handleCreateUser = async (clerkId: string, fullname: string, email: string) => {
        await upsertUser({ clerkId, fullname, email })
    }

    const handleCreateChurch = async (name: string) => {
        await createChurch({ name, type: 'church' })
    }

    const handleJoinChurch = async (inviteCode: string) => {
        await joinChurch({ inviteCode })
    }

    const clearError = () => setError('')

    return {
        isLoaded,
        isLoading,
        error,
        clearError,
        handleEmailSignIn,
        handleGoogleSignIn,
        handleEmailSignUp,
        handleGoogleSignUp,
        handleVerification,
        handleCreateUser,
        handleCreateChurch,
        handleJoinChurch,
    }
}
