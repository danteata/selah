import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react'
import { AppLoading } from '../../components/common/AppLoading'

/**
 * Where Google sign-in lands on the web.
 *
 * Clerk sends the browser back to `/sso-callback`; `main.tsx` folds that path
 * into the hash route so HashRouter can see it. Without a component here to
 * redeem the callback, a Google sign-up — or any sign-in needing a further
 * step — never completed: the router rendered the home page and the handshake
 * params were dropped.
 */
export default function SsoCallback() {
    return (
        <>
            <AppLoading label="Signing you in" />
            <AuthenticateWithRedirectCallback
                signInFallbackRedirectUrl="/"
                signUpFallbackRedirectUrl="/"
            />
        </>
    )
}
