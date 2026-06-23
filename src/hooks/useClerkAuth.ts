import { useState } from 'react'
import { useSignIn, useSignUp, useClerk } from '@clerk/clerk-react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
// Single source of truth for runtime detection — see `platform/index.ts`.
// Using the shared, call-time `isTauri` avoids the bug where a divergent
// local copy (or an import-time-frozen value) misdetects the packaged
// build as web and routes Google sign-in to Clerk's hosted portal.
import { isTauri } from '../platform'

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

// Turn a Clerk API error into a message that tells the user what to do
// next, rather than surfacing Clerk's raw text. Clerk errors carry a
// machine-readable `code` on each entry in `errors[]`; we key off that
// and fall back to the provided default.
export function friendlyAuthError(err: unknown, fallback: string): string {
    const entry = (err as { errors?: Array<{ code?: string; message?: string }> })
        .errors?.[0]
    switch (entry?.code) {
        case 'strategy_for_user_invalid':
            // The account has no password (e.g. it was created via
            // Google), so the password strategy isn't valid for it.
            return 'This account doesn’t use a password — sign in with “Continue with Google” instead.'
        case 'form_password_incorrect':
        case 'form_identifier_not_found':
            return 'Incorrect email or password.'
        case 'form_identifier_exists':
            return 'An account with this email already exists. Try signing in instead.'
        case 'form_code_incorrect':
        case 'verification_failed':
            return 'That verification code is incorrect or has expired.'
        default:
            return entry?.message || (err instanceof Error ? err.message : fallback)
    }
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
    const clerk = useClerk()

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
                await clerk.setActive({ session: result.createdSessionId })
                // Persist against the Clerk USER id (`user_...`), which is
                // what the Convex backend matches everywhere via
                // `getUserIdentity().subject`. `createdSessionId` is a
                // SESSION id (`sess_...`) and would create an orphan row
                // the rest of the app never reads. `clerk.user` is
                // populated once `setActive` resolves.
                const clerkUserId = clerk.user?.id
                if (clerkUserId) {
                    await upsertUser({ clerkId: clerkUserId, fullname: email.split('@')[0], email })
                }
                return true
            }
            // The attempt was created but isn't complete — the account
            // needs a factor other than the password we supplied (most
            // commonly: it was created via Google and has no password).
            setError(
                "We couldn't sign you in with that password. If you created this account with Google, use “Continue with Google” below.",
            )
            return false
        } catch (err: unknown) {
            setError(friendlyAuthError(err, 'Failed to sign in. Please check your credentials.'))
            return false
        } finally {
            setIsLoading(false)
        }
    }

    // Passwordless sign-in: email the user a one-time code. This is the
    // path for accounts created via Google (which have no password) but
    // who want to sign in by email. Returns true once the code has been
    // sent so the UI can switch to the code-entry step.
    const startEmailCodeSignIn = async (email: string): Promise<boolean> => {
        if (!signIn || !isLoaded) return false
        setIsLoading(true)
        setError('')
        try {
            const attempt = await signIn.create({ identifier: email })
            const emailFactor = attempt.supportedFirstFactors?.find(
                (f) => f.strategy === 'email_code',
            )
            if (!emailFactor || !('emailAddressId' in emailFactor)) {
                setError(
                    'Email-code sign-in isn’t available for this account. Try “Continue with Google”.',
                )
                return false
            }
            await signIn.prepareFirstFactor({
                strategy: 'email_code',
                emailAddressId: emailFactor.emailAddressId,
            })
            return true
        } catch (err: unknown) {
            setError(friendlyAuthError(err, 'Could not send a sign-in code.'))
            return false
        } finally {
            setIsLoading(false)
        }
    }

    // Complete a passwordless sign-in with the emailed code.
    const attemptEmailCodeSignIn = async (code: string): Promise<boolean> => {
        if (!signIn || !isLoaded) return false
        setIsLoading(true)
        setError('')
        try {
            const result = await signIn.attemptFirstFactor({
                strategy: 'email_code',
                code,
            })
            if (result.status === 'complete' && result.createdSessionId) {
                await clerk.setActive({ session: result.createdSessionId })
                const clerkUserId = clerk.user?.id
                if (clerkUserId) {
                    const primaryEmail =
                        clerk.user?.primaryEmailAddress?.emailAddress ?? ''
                    await upsertUser({
                        clerkId: clerkUserId,
                        fullname:
                            clerk.user?.fullName ||
                            primaryEmail.split('@')[0] ||
                            'User',
                        email: primaryEmail,
                    })
                }
                return true
            }
            setError("That code didn't complete sign-in. Please try again.")
            return false
        } catch (err: unknown) {
            setError(friendlyAuthError(err, 'Invalid or expired code.'))
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
            // Diagnostic breadcrumb. The console gets wiped when the web
            // path navigates away, so ALSO persist to localStorage (our
            // origin), which survives. After a failed attempt, relaunch
            // the app and read `selah_oauth_debug` from
            // Storage → Local Storage in the inspector.
            const debug = {
                tauri: isTauri(),
                protocol:
                    typeof window !== 'undefined' ? window.location.protocol : 'n/a',
                host: typeof window !== 'undefined' ? window.location.host : 'n/a',
                hasInternals:
                    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
            }
            console.info('[oauth] Google sign-in decision', debug)
            try {
                window.localStorage.setItem(
                    'selah_oauth_debug',
                    JSON.stringify(debug),
                )
            } catch {
                /* ignore storage failures */
            }
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
            setError(friendlyAuthError(err, 'Failed to sign in with Google.'))
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
            setError(friendlyAuthError(err, 'Failed to create account.'))
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
            setError(friendlyAuthError(err, 'Failed to sign up with Google.'))
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
                await clerk.setActive({ session: result.createdSessionId })
                // Return the Clerk USER id (not the session id) — the
                // caller passes this to `upsertUser` as `clerkId`, which
                // must match `getUserIdentity().subject` on the backend.
                // `createdUserId` is set on a completed sign-up; fall back
                // to the now-active `clerk.user` just in case.
                return result.createdUserId ?? clerk.user?.id ?? null
            }
            return null
        } catch (err: unknown) {
            setError(friendlyAuthError(err, 'Invalid verification code.'))
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
        startEmailCodeSignIn,
        attemptEmailCodeSignIn,
        handleGoogleSignIn,
        handleEmailSignUp,
        handleGoogleSignUp,
        handleVerification,
        handleCreateUser,
        handleCreateChurch,
        handleJoinChurch,
    }
}
